/**
 * Claude agent for resolving git merge conflicts in MDX files.
 * The streaming/tool-loop machinery lives in lib/claude/stream; this module
 * supplies the conflict-resolution prompts, tools, and per-file state.
 */

import { driveClaudeAgent, applyTextEdit, type ToolReply } from '../claude/stream';
import type { ConflictFile } from '../storage/git-store/types';
import { Remediation, CONFIRM_UNCHANGED } from './remediation';

/** One of the alternatives a conflict question offers. */
export interface ConflictChoice {
  label: string;
  description: string;
}

/**
 * Put a conflict the agent cannot settle to the user; resolves with the index
 * of the option they picked, and rejects if nobody is going to answer it.
 */
export type AskConflictQuestion = (
  filePath: string,
  question: string,
  options: ConflictChoice[],
) => Promise<number>;

export type ConflictEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'resolved'; filePath: string; content: string }
  | { type: 'question'; filePath: string; question: string; options: ConflictChoice[] }
  | { type: 'answer'; filePath: string; chosenIndex: number }
  | { type: 'done'; resolvedFiles: Map<string, string> }
  | { type: 'error'; error: string };

export interface ConflictAgentParams {
  files: ConflictFile[];
  apiKey: string;
  /**
   * Called when Claude needs user input. REQUIRED: an earlier version
   * defaulted this to "pick option 0", which silently answered questions the
   * user never saw.
   */
  onQuestion: AskConflictQuestion;
}

const CHOOSE_VERSION_TOOL = {
  name: 'choose_version',
  description:
    'Resolve a conflicted file by taking one side wholesale. Use when one version should win entirely. ' +
    'This replaces the file\'s entire content, discarding any edits you have already applied to it — ' +
    'do not use it to confirm a file you have been merging.',
  input_schema: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string' as const, description: 'Path of the file being resolved' },
      version: { type: 'string' as const, enum: ['ours', 'theirs'], description: '"ours" = the version edited here, "theirs" = the version published meanwhile' },
    },
    required: ['file_path', 'version'],
  },
};

const EDIT_FILE_TOOL = {
  name: 'edit_file',
  description:
    'Apply a targeted edit to a conflicted file. The file starts as the "ours" version with no conflict markers; ' +
    'edit it to incorporate what the other side should contribute. old_string must match the current file content exactly ' +
    'and be unique. Use several edits if the merge has several parts. Never retype the whole file.',
  input_schema: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string' as const, description: 'Path of the file being edited' },
      old_string: { type: 'string' as const, description: 'Exact text to replace in the current (ours-based) content' },
      new_string: { type: 'string' as const, description: 'Replacement text' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
};

const ASK_USER_TOOL = {
  name: 'ask_user',
  description:
    'Ask the user to choose between options when you cannot confidently resolve a conflict. ' +
    'Provide 2-3 concrete options. Always include a merged option when you can suggest one. ' +
    'IMPORTANT: The user is a non-technical content editor. Use plain language — no git terms like "HEAD", "local", "remote", "origin". ' +
    'The question should describe what differs in plain terms. ' +
    'Each option label must be a short, plain-language description of the actual content choice (e.g. "Keep the shorter title" or "Use the version with the tagline"), not a technical source label.',
  input_schema: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string' as const, description: 'Path of the conflicted file' },
      question: { type: 'string' as const, description: 'Plain-language question for the content editor, describing what the difference is without git jargon' },
      options: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            label: { type: 'string' as const, description: 'Short plain-language label describing this content choice — NOT "Local", "Remote", "HEAD", or "origin/main"' },
            description: { type: 'string' as const, description: 'Show the actual content value so the user knows what they are choosing' },
          },
          required: ['label', 'description'],
        },
        description: 'Between 2 and 4 options for the user to choose from',
      },
    },
    required: ['file_path', 'question', 'options'],
  },
};

const SYSTEM_PROMPT = `You are resolving git merge conflicts in MDX content files for a multilingual CMS.

Each file is shown in two versions:
- OURS — the version edited in this browser
- THEIRS — the version published from elsewhere in the meantime

Resolve every file with the cheapest tool that works:
- choose_version when one side should simply win.
- edit_file for real merges: each file's working copy starts as the clean OURS version, so you only edit in what the other side contributes. Small, targeted edits — never retype whole files.

Rules:
- NEVER change or duplicate component id props (e.g. id="hero-abc123") — preserve them exactly as they are in either version
- For frontmatter fields rev, base, lang: always take the THEIRS value
- For human-readable content (titles, text, descriptions): merge both sides' intent when possible
- If you can merge confidently, do it silently — do NOT call ask_user for obvious cases
- Only call ask_user when two sides have completely different content with no clear merge (e.g. two entirely different hero titles with different meaning)
- When you call ask_user, always provide a third "merged" option if you can suggest one
- After the user answers, apply their choice with choose_version or edit_file
- When writing ask_user questions and option labels: use plain language a content editor understands. Never use git terms like HEAD, local, remote, origin, branch. Write the question like "The hero title was also edited elsewhere. Which version should be used?" and write option labels like "Keep the published version", "Keep your own version", "Combine both" with the actual content shown in the description field
- Every file must be resolved before you stop: either choose_version, or edit_file calls whose LAST call for that file succeeded. If an edit_file fails, the file counts as unresolved until you land a successful edit on it — a file left failed aborts the whole publish. If the change turns out to be present already, confirm it with an edit_file whose old_string and new_string are both the text exactly as it stands. Do NOT reach for choose_version to clear a failed edit: it replaces the whole file and would throw away the merging you have already done.`;

function buildUserMessage(files: ConflictFile[]): string {
  return files.map(f => `## File: ${f.path}

### OURS (edited here):
\`\`\`
${f.ours}
\`\`\`

### THEIRS (published meanwhile):
\`\`\`
${f.theirs}
\`\`\``).join('\n\n---\n\n');
}

export async function* resolveConflictsWithAgent(
  params: ConflictAgentParams,
): AsyncGenerator<ConflictEvent> {
  const { files, apiKey, onQuestion } = params;
  // Per-file working state: content starts as the clean "ours" version and is
  // mutated by choose_version / edit_file. Only files marked resolved make it
  // into the final result — unresolved files must never be written back, since
  // they'd silently drop the remote's changes. Each file carries its own
  // Remediation for the other half of that promise: a file whose last edit
  // failed is only half-merged.
  const fileState = new Map<string, { content: string; resolved: boolean; attempted: Remediation; file: ConflictFile }>(
    files.map(f => [f.path, { content: f.ours, resolved: false, attempted: new Remediation(), file: f }]),
  );
  let unknownToolCall = false;
  const collectResolved = () =>
    new Map([...fileState].filter(([, s]) => s.resolved).map(([path, s]) => [path, s.content]));

  const driver = driveClaudeAgent({
    apiKey,
    system: SYSTEM_PROMPT,
    userMessage: buildUserMessage(files),
    tools: [CHOOSE_VERSION_TOOL, EDIT_FILE_TOOL, ASK_USER_TOOL],
    maxTurns: 30,
  });

  let reply: ToolReply | undefined;
  while (true) {
    const { value: ev, done } = await driver.next(reply);
    reply = undefined;
    if (done) break;

    switch (ev.type) {
      case 'thinking':
        break;
      case 'text':
        yield { type: 'reasoning', text: ev.text };
        break;
      case 'error':
        yield { type: 'error', error: ev.error };
        break;
      case 'tool_use': {
        const filePath = ev.input.file_path as string;
        const state = fileState.get(filePath);

        if (ev.name === 'choose_version') {
          if (!state) {
            reply = { content: `Unknown file: ${filePath}`, isError: true };
            break;
          }
          const version = ev.input.version as 'ours' | 'theirs';
          state.content = version === 'theirs' ? state.file.theirs : state.file.ours;
          state.resolved = true;
          state.attempted.succeeded(ev.turn); // taking a side wholesale supersedes any failed edit
          yield { type: 'resolved', filePath, content: state.content };
          reply = { content: `File resolved with the ${version} version.` };
        } else if (ev.name === 'edit_file') {
          if (!state) {
            reply = { content: `Unknown file: ${filePath}`, isError: true };
            break;
          }
          const result = applyTextEdit(state.content, ev.input.old_string as string, ev.input.new_string as string);
          if (result.ok) {
            state.content = result.content;
            state.attempted.succeeded(ev.turn);
            state.resolved = state.attempted.settled;
            if (state.resolved) yield { type: 'resolved', filePath, content: state.content };
            reply = { content: 'Edit applied.' };
          } else {
            // A failed edit un-resolves the file: committing it now would
            // silently drop whatever this edit was meant to merge in. No
            // error event here — the caller treats those as fatal, and the
            // model usually retries; a file still failed at the end surfaces
            // through the unresolved check below.
            state.attempted.failed(ev.turn);
            state.resolved = false;
            reply = { content: `${result.error} ${CONFIRM_UNCHANGED}`, isError: true };
          }
        } else if (ev.name === 'ask_user') {
          const question = ev.input.question as string;
          const options = ev.input.options as { label: string; description: string }[];
          yield { type: 'question', filePath, question, options };
          // Suspend: wait for the caller to provide the answer.
          const chosenIndex = await onQuestion(filePath, question, options);
          yield { type: 'answer', filePath, chosenIndex };
          reply = { content: `User chose option ${chosenIndex}: ${options[chosenIndex]?.label ?? 'unknown'}` };
        } else {
          // An unknown tool was still an attempted change. Without a file to
          // pin it to, refuse the run rather than let the stop handler call
          // whatever is resolved so far complete.
          unknownToolCall = true;
          reply = { content: `Unknown tool: ${ev.name}. Use choose_version, edit_file or ask_user.`, isError: true };
        }
        break;
      }
      case 'stop': {
        if (ev.reason === 'end_turn') {
          const unresolved = [...fileState].filter(([, s]) => !s.resolved).map(([path]) => path);
          if (unresolved.length > 0) {
            yield { type: 'error', error: `Conflict resolution incomplete — unresolved: ${unresolved.join(', ')}` };
          } else if (unknownToolCall) {
            yield { type: 'error', error: 'Conflict resolution called an unknown tool; its change may be missing.' };
          }
        }
        yield { type: 'done', resolvedFiles: collectResolved() };
        return;
      }
    }
  }
}

/** Live progress line — the agent's reasoning tail, or what it is waiting on. */
export type OnConflictProgress = (message: string) => void;

export interface ResolveConflictsOptions {
  /** Surfaces the agent's ask_user question as a real dialog. Without one,
   *  questions fail loudly instead of being silently self-answered. */
  onQuestion?: AskConflictQuestion;
  onProgress?: OnConflictProgress;
}

/**
 * The `onConflict` a pull or push takes, backed by Claude.
 *
 * It lives here rather than in ops because the agent layer sits above ops:
 * `pull` and `push` take conflict resolution as a parameter and know nothing
 * about who does it. This used to be a function inside ops/repo.ts that
 * dynamically imported this module, which made the bottom layer depend on the
 * top one and hid it behind an import Vite could not see.
 */
export async function resolveConflictsWithClaude(
  conflicts: ConflictFile[],
  apiKey: string,
  opts: ResolveConflictsOptions = {},
): Promise<{ path: string; content: string }[]> {
  const onQuestion = opts.onQuestion ?? (async () => {
    throw new Error('This merge needs a decision, but no dialog is available here. Resolve it from the admin page.');
  });

  let reasoningTail = '';
  const resolved: { path: string; content: string }[] = [];
  for await (const event of resolveConflictsWithAgent({ files: conflicts, apiKey, onQuestion })) {
    if (event.type === 'reasoning') {
      reasoningTail = (reasoningTail + event.text).slice(-120);
      opts.onProgress?.(reasoningTail);
    } else if (event.type === 'question') {
      opts.onProgress?.('Waiting for your answer…');
    } else if (event.type === 'resolved') {
      opts.onProgress?.(`Resolved ${event.filePath}`);
    } else if (event.type === 'done') {
      for (const [path, content] of event.resolvedFiles) {
        resolved.push({ path, content });
      }
    } else if (event.type === 'error') {
      throw new Error(event.error);
    }
  }
  return resolved;
}
