/**
 * The one Claude agent loop.
 *
 * Both of plinto's agents — translation sync and merge-conflict resolution —
 * are the same machine: ask the model, surface its text as it arrives, run
 * the tools it calls, replay the conversation with the results, repeat until
 * it stops. This module is that machine, once; the agents supply the prompt,
 * the tools, and what to do when a tool is called.
 *
 * Everything below the loop — streaming, message assembly, retries, typed
 * errors — belongs to @anthropic-ai/sdk. What stays here is the one shape
 * plinto needs that the SDK's own tool runner deliberately does not offer: a
 * two-way generator that yields AgentStreamEvents and takes a ToolReply back
 * through next(). The runner wants tools as callbacks it owns; plinto's tools
 * have to run in the caller, where the domain state lives, where each call
 * also emits a UI event, and where ask_user suspends until a human answers.
 */

import type AnthropicClient from '@anthropic-ai/sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { claudeClient, claudeErrorMessage } from './client';

export type AgentStreamEvent =
  | { type: 'thinking' }
  | { type: 'text'; text: string }
  /** `turn` matters when judging tool failures: calls batched in one turn
   *  were authored before the model saw each other's results, so only an
   *  action in a LATER turn is an informed response to a failure. */
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; turn: number }
  | { type: 'error'; error: string }
  /** Always the last event. 'end_turn' is the clean finish; everything else
   *  was preceded by an error event saying why. */
  | { type: 'stop'; reason: 'end_turn' | 'max_tokens' | 'max_turns' | 'error' };

export interface ToolReply {
  content: string;
  isError?: boolean;
}

export interface ClaudeAgentOptions {
  apiKey: string;
  system: string;
  tools: Anthropic.Tool[];
  userMessage: string;
  maxTurns: number;
  /** Adaptive thinking at this effort; omit for the model's default. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 16000;

export async function* driveClaudeAgent(
  opts: ClaudeAgentOptions,
): AsyncGenerator<AgentStreamEvent, void, ToolReply | undefined> {
  // Inside the generator's own error reporting, not before it: a 'stop' event
  // is documented as always last, and both agents emit their terminal `done`
  // only from one. Constructing the client outside this — a missing key, a
  // chunk that will not load — rejected the very first next() instead, and
  // the agent above ended with no `done` at all.
  let client: AnthropicClient;
  try {
    client = await claudeClient(opts.apiKey);
  } catch (err) {
    yield { type: 'error', error: claudeErrorMessage(err) };
    yield { type: 'stop', reason: 'error' };
    return;
  }

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.userMessage }];

  // Abandoning the generator — the queue is cancelled, the user closed the
  // modal — runs this. The SDK pumps the response in a task of its own, so
  // simply not asking for more events leaves the whole turn being generated,
  // downloaded and billed with nobody reading it.
  let live: { controller: AbortController } | null = null;
  try {
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    let message: Anthropic.Message;
    try {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        ...(opts.effort
          ? {
              // Adaptive thinking: the model decides how much to think,
              // steered by effort.
              thinking: { type: 'adaptive' as const },
              output_config: { effort: opts.effort },
            }
          : {}),
        // Top-level automatic caching: the API caches the request prefix
        // (tools + system + history), so replay turns stay cheap.
        cache_control: { type: 'ephemeral' },
        system: opts.system,
        tools: opts.tools,
        messages,
      });
      live = stream;

      // Deltas only drive the live UI. Assembling them back into a message —
      // thinking signatures, redacted blocks, partial tool JSON — is the
      // SDK's job, and finalMessage() is what gets replayed.
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const kind = event.content_block.type;
          if (kind === 'thinking' || kind === 'redacted_thinking') yield { type: 'thinking' };
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }
      message = await stream.finalMessage();
      live = null;
    } catch (err) {
      yield { type: 'error', error: `Claude API error: ${claudeErrorMessage(err)}` };
      yield { type: 'stop', reason: 'error' };
      return;
    }

    // Tools run once the turn is complete, never mid-stream. ask_user
    // suspends on a human clicking a button; draining the response body
    // first means nobody's deliberation holds an HTTP connection open.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue;
      // Hand the call to the agent; its reply comes back through next().
      const reply = yield {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
        turn,
      };
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: reply?.content ?? 'No result.',
        ...(reply?.isError ? { is_error: true } : {}),
      });
    }

    switch (message.stop_reason) {
      case 'end_turn':
        yield { type: 'stop', reason: 'end_turn' };
        return;

      case 'tool_use':
        // 'tool_use' with nothing to reply to would mean an empty user
        // message; let it fall through and be reported rather than sent.
        if (toolResults.length === 0) break;
        // All results go back in ONE user message. Splitting them across
        // messages teaches the model to stop batching calls.
        messages.push({ role: 'assistant', content: message.content });
        messages.push({ role: 'user', content: toolResults });
        continue;

      case 'pause_turn':
        // The model paused a long turn and can carry on if the paused
        // assistant message is handed straight back. Unreachable while plinto
        // declares only its own tools, but "unreachable" and "discards a
        // translation" are a bad pair to bet on, and the fix is one push.
        messages.push({ role: 'assistant', content: message.content });
        if (toolResults.length > 0) messages.push({ role: 'user', content: toolResults });
        continue;

      case 'max_tokens':
      case 'model_context_window_exceeded':
        yield { type: 'error', error: `Incomplete: the response hit the ${message.stop_reason} limit.` };
        yield { type: 'stop', reason: 'max_tokens' };
        return;

      case 'refusal': {
        const category = message.stop_details?.category;
        yield { type: 'error', error: `Claude declined this request${category ? ` (${category})` : ''}.` };
        yield { type: 'stop', reason: 'error' };
        return;
      }
    }

    yield { type: 'error', error: `Unexpected stop reason: ${message.stop_reason}` };
    yield { type: 'stop', reason: 'error' };
    return;
  }

  yield { type: 'error', error: `Agent loop exceeded ${opts.maxTurns} turns.` };
  yield { type: 'stop', reason: 'max_turns' };
  } finally {
    live?.controller.abort();
  }
}

/**
 * Apply an exact-match text edit, the way both agents' edit_file tools do.
 *
 * CRLF-tolerant: Claude always produces \n line endings, so when the file
 * uses \r\n the needle and replacement are normalized to match. An empty
 * old_string on an empty file reads as "create the file" — without the
 * special case, ''.indexOf('', 1) is 0 and reads as "appears multiple times".
 */
export function applyTextEdit(
  content: string,
  oldStr: string,
  newStr: string,
): { ok: true; content: string } | { ok: false; error: string } {
  // A tool call can arrive with a field missing: the SDK parses partial JSON,
  // so a turn cut short by max_tokens yields a plausible object rather than a
  // parse failure. Unchecked, a missing new_string wrote the literal word
  // "undefined" into the page, and a missing old_string threw a TypeError
  // that killed the run instead of telling the model to try again.
  if (typeof oldStr !== 'string' || typeof newStr !== 'string') {
    return { ok: false, error: 'edit_file needs both old_string and new_string, as strings.' };
  }
  if (oldStr === '') {
    if (content === '') return { ok: true, content: newStr };
    return { ok: false, error: 'old_string must not be empty when the file has content.' };
  }

  const hasCrlf = content.includes('\r\n');
  const needle = hasCrlf ? oldStr.replace(/(?<!\r)\n/g, '\r\n') : oldStr;
  const replacement = hasCrlf ? newStr.replace(/(?<!\r)\n/g, '\r\n') : newStr;

  const first = content.indexOf(needle);
  if (first === -1) {
    const preview = oldStr.length > 100 ? oldStr.slice(0, 100) + '...' : oldStr;
    return { ok: false, error: `Text not found: "${preview}"` };
  }
  // Searched from first+1, not past the needle: a self-overlapping match
  // (delimiter runs, repeated markers) is just as ambiguous as a disjoint one.
  if (content.indexOf(needle, first + 1) !== -1) {
    return { ok: false, error: 'Text appears multiple times. Include more context to make it unique.' };
  }
  return { ok: true, content: content.slice(0, first) + replacement + content.slice(first + needle.length) };
}
