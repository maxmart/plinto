/**
 * Translation, bound to Plinto's documents.
 *
 * What changed comes from the document's brief (`@obelum/core`); the
 * translating is `@obelum/translator-claude`'s; the save is the document's
 * `sync`, so the agent's output is what a sync is. Neither library knows
 * about MDX, content paths or git. This module is the adapter: it opens the
 * document through content ops, tells the translator the rules that are
 * specific to an MDX site, and turns the translator's events into the log a
 * screen shows.
 */
import type { Session } from '@obelum/core';
import { claude, type DriveFn, type TranslationEvent } from '@obelum/translator-claude';

/**
 * What a translation needs from the layers below it: a document by content
 * path, and a file read for the glossary.
 *
 * Named here rather than imported, so the agent layer depends on nothing but
 * the shape of what it uses — it is a layer on top of ops, and this is the
 * only place that says so.
 */
export interface TranslationHost {
  document(contentPath: string): Session;
  getContent(file: string): Promise<string>;
}

export interface RunTranslationOptions {
  contentPath: string;    // e.g. 'page/support' or 'news/summer-cup'
  targetLang: string;
  apiKey: string;
  /** Replace the model with a script or a recording (evals). */
  drive?: DriveFn;
  /** Where the result is saved: the document's own `sync` by default, or a
   *  round's, when the run is one of several after an edit. */
  sync?: (lang: string, content: string) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// What the run reports
// ---------------------------------------------------------------------------

/** One entry in the running log a translation shows on screen. */
export type LogItem =
  | { type: 'thinking' }
  | { type: 'text'; content: string }
  | { type: 'edit'; old_string: string; new_string: string }
  | { type: 'error'; content: string };

export type TranslationStatus =
  | 'pending' | 'translating' | 'saving' | 'done' | 'error' | 'skipped';

/**
 * Add a streaming item to a log.
 *
 * Two rules, both about what a reader wants to see: "thinking" is a spinner,
 * not history, so it is replaced rather than appended; and consecutive text
 * is one paragraph arriving in pieces, so it is concatenated.
 */
export function mergeLogItem(log: LogItem[], item: LogItem): LogItem[] {
  const withoutThinking = log.filter(l => l.type !== 'thinking');
  if (item.type === 'thinking') return [...withoutThinking, item];
  if (item.type === 'text') {
    const last = withoutThinking[withoutThinking.length - 1];
    if (last?.type === 'text') {
      return [...withoutThinking.slice(0, -1), { type: 'text', content: last.content + item.content }];
    }
  }
  return [...withoutThinking, item];
}

export interface RunTranslationCallbacks {
  onLogItem: (item: LogItem) => void;
  onStatusChange: (status: TranslationStatus) => void;
  /** Polled between steps and stream events; a true return aborts the run. */
  isCancelled: () => boolean;
}

function logItemOf(event: TranslationEvent): LogItem | null {
  switch (event.type) {
    case 'thinking': return { type: 'thinking' };
    case 'reasoning': return { type: 'text', content: event.text };
    case 'edit': return { type: 'edit', ...event.edit };
    // Not necessarily fatal: the translator may recover from a failed edit.
    // Whether the run succeeded rides on what `run` returns.
    case 'error': return { type: 'error', content: event.error };
    case 'done': return null;
  }
}

// ---------------------------------------------------------------------------
// The rules an MDX site adds
// ---------------------------------------------------------------------------

/**
 * Where a site keeps its translation glossary. Optional by construction: a
 * site without the file simply translates without one.
 */
const GLOSSARY_FILE = 'src/translation-glossary.md';

/**
 * What is code in an MDX page. The translator's prompts are format-agnostic;
 * this is the one rule an MDX site has to add, and it is load-bearing — a
 * page whose import line got translated does not build.
 */
const MDX_RULES =
  'The frontmatter\'s `layout` and the `import` statements below it are code, not content: ' +
  'never translate them. If you add a component the target file did not use before, add its ' +
  'import too, copied exactly from whichever language already has it — the page will not build without it.';

async function loadGlossary(getContent: TranslationHost['getContent']): Promise<string | undefined> {
  try {
    return await getContent(GLOSSARY_FILE);
  } catch {
    return undefined;
  }
}

/** The MDX rules, and the site's glossary when it has one. */
export async function instructions(host: TranslationHost): Promise<string> {
  const glossary = await loadGlossary(host.getContent);
  return glossary
    ? `${MDX_RULES}\n\nThe site has a translation glossary. Its term choices are binding:\n\n${glossary}`
    : MDX_RULES;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Bring one language of a document up to date with the others, with Claude:
 * brief, translate, sync. A run the translator did not finish is never
 * saved. Returns 'done' on success, 'error' on failure, 'cancelled' if
 * cancelled.
 */
export async function runTranslation(
  host: TranslationHost,
  opts: RunTranslationOptions,
  callbacks: RunTranslationCallbacks,
): Promise<'done' | 'error' | 'cancelled'> {
  const { contentPath, targetLang, apiKey, drive } = opts;
  const { onLogItem, onStatusChange, isCancelled } = callbacks;

  try {
    if (isCancelled()) return 'cancelled';
    onStatusChange('translating');

    const session = host.document(contentPath);
    const sync = opts.sync ?? session.sync;
    const translator = claude({ apiKey, drive, instructions: await instructions(host) });
    const brief = await session.brief(targetLang);
    if (isCancelled()) return 'cancelled';

    const content = await translator.run(brief, {
      isCancelled,
      onEvent: event => { const item = logItemOf(event); if (item) onLogItem(item); },
    });
    if (isCancelled()) return 'cancelled';

    // A run that produced nothing must not be saved: a partial result
    // stamped as synced would hide that anything went wrong.
    if (content === null) {
      onLogItem({ type: 'error', content: 'Translation did not complete' });
      onStatusChange('error');
      return 'error';
    }

    onStatusChange('saving');
    await sync(targetLang, content);
    onStatusChange('done');
    return 'done';
  } catch (err) {
    onLogItem({ type: 'error', content: err instanceof Error ? err.message : String(err) });
    onStatusChange('error');
    return 'error';
  }
}
