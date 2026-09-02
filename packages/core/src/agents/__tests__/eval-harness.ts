/**
 * The translation evals' harness: real corpus, real repository, real ops —
 * only the model is replaceable.
 *
 * Each scenario is built from the playground corpus (examples/playground, the
 * publishable fixture site) in a fresh temporary git repository: the shipped
 * documents are seeded with self-consistent vector clocks and committed, the
 * scenario's "edit" is applied through the real `editContent` (so the rev
 * genuinely advances and the base revision genuinely exists in history), and
 * `runTranslation` then runs over the real content ops, the real anchored
 * diff, and the real BrowserGitStore. The single seam is `driveClaudeAgent` —
 * the function whose only job is talking to the API — which the eval test
 * mocks to one of the three drivers below:
 *
 *  - probeDriver:     no model at all. Captures the exact prompts the agent
 *                     would have been sent and finishes cleanly with no
 *                     edits, so the deterministic pipeline — diff gathering,
 *                     staleness, syncContent's stamping — is asserted on
 *                     every `npm test`, key or no key.
 *  - replayDriver:    a recorded transcript of a real API run, replayed
 *                     through the real tool-application loop (applyTextEdit,
 *                     Remediation — none of that is mocked). It refuses a
 *                     stale fixture: the prompts built from the current
 *                     corpus must byte-match the recorded ones, and the tool
 *                     replies the loop produces must match the recorded ones.
 *  - recordingDriver: the real driveClaudeAgent, teed. Used when
 *                     ANTHROPIC_API_KEY is set; writes the transcript that
 *                     replayDriver later runs from.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import git from 'isomorphic-git';
import matter from 'gray-matter';

import { createBrowserGitStore } from '../../storage/git-store/browser';
import { nodeBrowserFs } from '../../test/browser-fs';
import { createContentOps } from '../../ops/content';
import { setSyncMeta } from '../../sync-meta';
import { FileNotFoundError, type FileStore } from '../../storage/file-store/types';
import type { Stores } from '../../storage';
import type { Settings } from '../../settings';
import type { ResolvedConfig } from '../../resolved-config';
import type { TranslationHost, RunTranslationCallbacks, LogItem, TranslationStatus } from '../translate';
import type { AgentStreamEvent, ToolReply, ClaudeAgentOptions, DriveFn } from '@obelum/translator-claude';

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** Found by walking up to the directory that holds `examples/`, not by
 *  counting `..` — the sibling corpus tests have already moved once. */
const repoRoot = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url));
  while (!fs.existsSync(path.join(dir, 'examples'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error('translation evals: no repository root above ' + import.meta.url);
    dir = up;
  }
  return dir;
})();

export const playgroundDir = path.join(repoRoot, 'examples', 'playground');

/** A shipped playground document, exact bytes. */
export function shippedDoc(relPath: string): string {
  return fs.readFileSync(path.join(playgroundDir, relPath), 'utf8');
}

/** The playground's resolved config — examples/playground/astro.config.mjs,
 *  as the integration would resolve it, with the site at the repo root. */
export const playgroundConfig: ResolvedConfig = {
  i18n: {
    locales: ['en', 'sv', 'de'],
    defaultLocale: 'en',
    labels: { en: 'English', sv: 'Svenska', de: 'Deutsch' },
    prefixDefaultLocale: true,
  },
  content: {
    pagesDir: 'src/pages',
    partialsDir: 'src/partials',
    collectionsDir: 'content',
    mediaDir: 'public/media',
    siteSubdir: '',
  },
  git: {
    corsProxy: 'https://proxy.invalid',
    defaultBranch: 'main',
    defaultAuthorName: 'Eval',
  },
  storage: {
    keyPrefix: 'eval',
    fsDbName: 'eval-fs',
    lfsDbName: 'eval-lfs',
    repoDir: '/repo',
  },
  partials: [
    { name: 'topbar', file: 'TopBar.mdx', label: 'Top Bar' },
    { name: 'footer', file: 'Footer.mdx', label: 'Footer' },
  ],
};

// ---------------------------------------------------------------------------
// Real stores over a temp directory
// ---------------------------------------------------------------------------

/** `Settings` is a port; the evals answer it in memory. */
function memorySettings(): Settings {
  const store: Record<string, string> = {};
  const get = (k: string) => store[k] ?? '';
  return {
    adminName: () => get('name'), setAdminName: v => { store.name = v; },
    githubToken: () => get('token') || null, setGithubToken: v => { store.token = v; },
    apiKey: () => get('key'), setApiKey: v => { store.key = v; },
    repoUrl: () => get('repo'), setRepoUrl: v => { store.repo = v; },
    proxyUrl: () => '',
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
}

/**
 * A FileStore over node's real filesystem. Not BrowserFileStore over the node
 * shim: that class navigates paths with '/', which `path.join` on Windows has
 * already turned into '\', and the evals must run where the repo's tests run.
 */
function evalFileStore(repoDir: () => string): FileStore {
  const full = (p: string) => path.join(repoDir(), p);
  const store: FileStore = {
    async readFile(repoPath) {
      try {
        return await fs.promises.readFile(full(repoPath), 'utf8');
      } catch (err) {
        if ((err as { code?: string })?.code === 'ENOENT') throw new FileNotFoundError(repoPath);
        throw err;
      }
    },
    async writeFile(repoPath, body) {
      await fs.promises.mkdir(path.dirname(full(repoPath)), { recursive: true });
      await fs.promises.writeFile(full(repoPath), body);
    },
    async readDir(repoPath) {
      let names: fs.Dirent[];
      try {
        names = await fs.promises.readdir(full(repoPath), { withFileTypes: true });
      } catch {
        return [];
      }
      return names.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' as const : 'file' as const, size: 0, mtime: 0 }));
    },
    async readManyFrontmatter(paths) {
      const out: Record<string, Record<string, unknown> | null> = {};
      for (const p of paths) {
        try {
          out[p] = matter(await store.readFile(p)).data as Record<string, unknown>;
        } catch {
          out[p] = null;
        }
      }
      return out;
    },
    async deleteFile(repoPath) {
      await fs.promises.unlink(full(repoPath));
    },
    async getMediaUrl(p) {
      return '/' + p;
    },
  };
  return store;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface ScenarioSpec {
  /** Fixture name; also the transcript file's basename. */
  name: string;
  /** Page slug under src/pages/{lang}/. */
  page: string;
  /** The locale runTranslation targets. */
  target: string;
  /** Locales seeded from the shipped corpus. Unless overridden, each is
   *  seeded at rev 1 with the other seeded locales synced at 1 — parity, so
   *  every structural difference between them is *accepted editorial drift*,
   *  which is precisely what the agent must not undo. */
  seed: string[];
  seedOverrides?: Record<string, { rev: number; synced: Record<string, number> }>;
  /** The one edit whose translation is being evaluated, applied through the
   *  real editContent so its base revision exists in real history. */
  edit?: { lang: string; find: string; replace: string };
}

export interface Scenario {
  spec: ScenarioSpec;
  contentPath: string;
  config: ResolvedConfig;
  deps: TranslationHost;
  filePath(lang: string): string;
  /** Current bytes of a locale's file, or null when it does not exist. */
  read(lang: string): string | null;
  /** The bytes each seeded locale had after the seed commit. */
  seeded: Record<string, string>;
  /** Shorthands for the checker's four corners (edit scenarios). */
  targetBefore: string | null;
  sourceBase: string | null;
  sourceCurrent: string | null;
  dispose(): void;
}

export async function buildScenario(spec: ScenarioSpec): Promise<Scenario> {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinto-eval-'));
  const config = playgroundConfig;
  const contentPath = `page/${spec.page}`;
  const filePath = (lang: string) => `src/pages/${lang}/${spec.page}.mdx`;
  const read = (lang: string): string | null => {
    try {
      return fs.readFileSync(path.join(repoDir, filePath(lang)), 'utf8');
    } catch {
      return null;
    }
  };

  await git.init({ fs, dir: repoDir, defaultBranch: 'main' });

  // Seed: shipped corpus bytes, restamped to the scenario's clocks by the one
  // frontmatter writer, committed as real history.
  const author = { name: 'Eval', email: 'eval@plinto.local' };
  const seeded: Record<string, string> = {};
  for (const lang of spec.seed) {
    // Parity includes the self entry, because that is what production files
    // carry: syncContent's buildSyncedMap stamps every language's current
    // rev, the document's own included. Without it, the pipeline reads the
    // target as never-synced-with-itself and offers its whole file as a diff.
    const clocks = spec.seedOverrides?.[lang]
      ?? { rev: 1, synced: Object.fromEntries(spec.seed.map(l => [l, 1])) };
    const stamped = setSyncMeta(shippedDoc(filePath(lang)), clocks.rev, clocks.synced);
    const target = path.join(repoDir, filePath(lang));
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, stamped);
    seeded[lang] = stamped;
  }
  for (const lang of spec.seed) await git.add({ fs, dir: repoDir, filepath: filePath(lang) });
  await git.commit({ fs, dir: repoDir, message: 'seed', author });

  // The real stores and ops over that repository.
  const bfs = nodeBrowserFs(() => repoDir);
  const gitStore = createBrowserGitStore({ git: config.git, fs: bfs, settings: memorySettings() });
  await gitStore.checkInitialized();
  const fileStore = evalFileStore(() => repoDir);
  const stores: Stores = {
    dev: false,
    getFileStore: async () => fileStore,
    getGitStore: async () => gitStore,
  };
  const ops = createContentOps({ config, stores });

  // The edit under evaluation, through the front door: rev 1 → 2, committed.
  if (spec.edit) {
    const before = read(spec.edit.lang);
    if (!before) throw new Error(`scenario ${spec.name}: no ${spec.edit.lang} file to edit`);
    const first = before.indexOf(spec.edit.find);
    if (first === -1 || before.indexOf(spec.edit.find, first + 1) !== -1) {
      throw new Error(`scenario ${spec.name}: edit.find must appear exactly once in ${filePath(spec.edit.lang)}`);
    }
    await ops.editContent(contentPath, spec.edit.lang, before.replace(spec.edit.find, spec.edit.replace));
  }

  const deps: TranslationHost = {
    locales: config.i18n.locales,
    getContent: ops.getContent,
    syncContent: ops.syncContent,
    resolveFilePath: ops.resolveFilePath,
    commits: async () => gitStore,
  };

  return {
    spec,
    contentPath,
    config,
    deps,
    filePath,
    read,
    seeded,
    targetBefore: read(spec.target),
    sourceBase: spec.edit ? seeded[spec.edit.lang] : null,
    sourceCurrent: spec.edit ? read(spec.edit.lang) : null,
    dispose: () => fs.rmSync(repoDir, { recursive: true, force: true, maxRetries: 3 }),
  };
}

// ---------------------------------------------------------------------------
// Drivers — what stands in for driveClaudeAgent
// ---------------------------------------------------------------------------

export type EvalDriver = (real: DriveFn, opts: ClaudeAgentOptions) =>
  AsyncGenerator<AgentStreamEvent, void, ToolReply | undefined>;

export interface TranscriptStep {
  event: AgentStreamEvent;
  /** The tool reply the agent loop produced, recorded for tool_use events. */
  reply?: ToolReply;
}

export interface Transcript {
  scenario: string;
  recordedAt: string;
  system: string;
  userMessage: string;
  steps: TranscriptStep[];
}

/** Captures the prompts and finishes with no edits: the deterministic mode. */
export function probeDriver(captured: { system?: string; userMessage?: string }): EvalDriver {
  return async function* (_real, opts) {
    captured.system = opts.system;
    captured.userMessage = opts.userMessage;
    yield { type: 'stop', reason: 'end_turn' };
  };
}

/**
 * Replays a recorded run. Two honesty guards, both hard failures rather than
 * soft skips: the prompts the harness builds *now* must byte-match the ones
 * the transcript was recorded against (otherwise the corpus or the prompt
 * code moved and the fixture proves nothing about it), and the tool replies
 * the real application loop produces must match the recorded ones (otherwise
 * the loop's semantics moved under the transcript).
 */
export function replayDriver(transcript: Transcript): EvalDriver {
  return async function* (_real, opts) {
    if (opts.system !== transcript.system || opts.userMessage !== transcript.userMessage) {
      throw new Error(
        `stale fixture for ${transcript.scenario}: the prompts built from the current corpus no longer ` +
        `match the recorded run. Re-record: ANTHROPIC_API_KEY=… PLINTO_EVAL_RECORD=1 npx vitest run translation-evals`,
      );
    }
    for (const step of transcript.steps) {
      const reply = yield step.event;
      if (step.event.type === 'tool_use') {
        const got = JSON.stringify(reply ?? null);
        const want = JSON.stringify(step.reply ?? null);
        if (got !== want) {
          throw new Error(
            `replay of ${transcript.scenario} diverged: the ${step.event.name} call produced ${got} ` +
            `where the recorded run produced ${want}. Re-record the fixture.`,
          );
        }
      }
    }
  };
}

/** The real driveClaudeAgent, teed into a transcript. */
export function recordingDriver(sink: (t: Omit<Transcript, 'scenario' | 'recordedAt'>) => void): EvalDriver {
  return async function* (real, opts) {
    const steps: TranscriptStep[] = [];
    const gen = real(opts);
    let sent: ToolReply | undefined;
    for (;;) {
      const r = await gen.next(sent);
      if (r.done) break;
      const ev = r.value;
      sent = yield ev;
      const last = steps[steps.length - 1];
      if (ev.type === 'text' && last?.event.type === 'text') {
        // Streamed text arrives in deltas; a transcript wants the paragraph.
        last.event = { type: 'text', text: last.event.text + ev.text };
        continue;
      }
      steps.push({ event: ev, ...(ev.type === 'tool_use' ? { reply: sent } : {}) });
    }
    sink({ system: opts.system, userMessage: opts.userMessage, steps });
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixturesDir = path.join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'translation-evals');

export const fixturePath = (name: string) => path.join(fixturesDir, `${name}.json`);
export const hasFixture = (name: string) => fs.existsSync(fixturePath(name));

export function loadTranscript(name: string): Transcript {
  return JSON.parse(fs.readFileSync(fixturePath(name), 'utf8')) as Transcript;
}

export function saveTranscript(name: string, t: Omit<Transcript, 'scenario' | 'recordedAt'>): void {
  fs.mkdirSync(fixturesDir, { recursive: true });
  const full: Transcript = { scenario: name, recordedAt: new Date().toISOString(), ...t };
  fs.writeFileSync(fixturePath(name), JSON.stringify(full, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Callback plumbing
// ---------------------------------------------------------------------------

export interface RunLog {
  callbacks: RunTranslationCallbacks;
  items: LogItem[];
  statuses: TranslationStatus[];
}

export function runLog(): RunLog {
  const items: LogItem[] = [];
  const statuses: TranslationStatus[] = [];
  return {
    items,
    statuses,
    callbacks: {
      onLogItem: item => { items.push(item); },
      onStatusChange: status => { statuses.push(status); },
      isCancelled: () => false,
    },
  };
}
