/**
 * The one way the UI runs translations: a sequential queue over
 * (contentPath, targetLang) pairs, reporting the whole task list after every
 * event so a modal can render it live. Shared by Save & Sync, Quick Publish
 * and Sync All, which used to carry three copies of this loop.
 */
import { mergeLogItem, type LogItem, type TranslationStatus } from '@plinto/core/agents/translate';
import type { AdminRuntime } from '../runtime';

/**
 * What the queue needs from the configured plinto. Passed in rather than
 * imported: this module is not a component, so it cannot read the context —
 * and every caller is one.
 */
export type QueueDeps = Pick<AdminRuntime, 'settings' | 'config' | 'ops' | 'agents'>;

/** Get the Claude API key from localStorage, prompting the user if needed. */
export function getOrPromptApiKey({ settings }: Pick<QueueDeps, 'settings'>): string | null {
  let apiKey: string | null = settings.apiKey() || null;
  if (!apiKey) {
    apiKey = window.prompt('Enter your Claude API key for translation:');
    if (!apiKey) return null;
    settings.setApiKey(apiKey);
  }
  return apiKey;
}

export interface QueueItem {
  contentPath: string;
  targetLang: string;
}

/**
 * One row of the task list a translation modal shows.
 *
 * Declared here, with the queue that builds it, rather than in lib/translation
 * — a screen's view of a run is not part of a vector clock.
 */
export interface TranslationTask {
  targetLang: string;
  /** Set when the task list spans several documents (Sync All). */
  contentPath?: string;
  status: TranslationStatus;
  error?: string;
  log: LogItem[];
  editCount: number;
}

/** Where a save-and-sync run has got to. */
export type SavePhase = 'saving' | 'checking-translations' | 'translating';

/** How it ended. `no-key` means the editor declined to supply one. */
export type SaveOutcome = 'done' | 'cancelled' | 'no-key';

/**
 * Save a document, then bring every stale sibling language up to date.
 *
 * Save & Sync and Quick Publish are the same flow — Quick Publish continues
 * into a push. They carried a copy each, forty near-identical lines with the
 * same four cancellation checks and the same staleness filter, and the copies
 * drifted: the same bug had to be fixed in both of them twice in one day, and
 * the second copy was missing a fix the first had for a month.
 *
 * `onSaved` fires the moment the commit lands, not when the caller finishes.
 * From then on the editor holds nothing the file does not, however the rest of
 * the run ends — cancelling a translation does not un-save what was saved.
 */
export async function saveAndSync(plinto: QueueDeps, opts: {
  contentPath: string;
  lang: string;
  mdxContent: string;
  isCancelled: () => boolean;
  onPhase: (phase: SavePhase) => void;
  onSaved: () => void;
  onTasks: (tasks: TranslationTask[]) => void;
}): Promise<SaveOutcome> {
  const { config, ops } = plinto;
  const { editContent, getStaleness } = ops;
  const { contentPath, lang, mdxContent, isCancelled, onPhase, onSaved, onTasks } = opts;

  onPhase('saving');
  await editContent(contentPath, lang, mdxContent);
  onSaved();
  if (isCancelled()) return 'cancelled';

  onPhase('checking-translations');
  const staleness = await getStaleness(contentPath);
  // 'missing' counts as needing sync: a freshly created page has no
  // translations at all, which is the stalest a locale can be.
  const targets = config.i18n.locales
    .filter(l => l !== lang && (staleness[l]?.status === 'stale' || staleness[l]?.status === 'missing'))
    .map(targetLang => ({ contentPath, targetLang }));
  if (isCancelled()) return 'cancelled';
  if (targets.length === 0) return 'done';

  onPhase('translating');
  const apiKey = getOrPromptApiKey(plinto);
  if (!apiKey) return 'no-key';

  return await runTranslationQueue(plinto, targets, apiKey, { isCancelled, onTasks });
}

/** The initial task list for a queue — all pending. */
export function pendingTasks(items: QueueItem[]): TranslationTask[] {
  return items.map(({ contentPath, targetLang }) => ({
    contentPath,
    targetLang,
    status: 'pending' as const,
    log: [],
    editCount: 0,
  }));
}

/**
 * Run the queue front to back. A failed item is recorded and the queue
 * continues; cancellation stops between events. `onTasks` receives the full
 * task array on every change.
 */
export async function runTranslationQueue(
  plinto: Pick<QueueDeps, 'agents'>,
  items: QueueItem[],
  apiKey: string,
  opts: {
    isCancelled: () => boolean;
    onTasks: (tasks: TranslationTask[]) => void;
  },
): Promise<'done' | 'cancelled'> {
  const { runTranslation } = plinto.agents;
  let tasks = pendingTasks(items);
  const publish = () => opts.onTasks(tasks);
  const update = (index: number, change: Partial<TranslationTask>) => {
    tasks = tasks.map((t, i) => (i === index ? { ...t, ...change } : t));
    publish();
  };
  publish();

  for (let i = 0; i < items.length; i++) {
    if (opts.isCancelled()) return 'cancelled';

    update(i, { status: 'translating', log: [], editCount: 0 });

    const result = await runTranslation(
      { contentPath: items[i].contentPath, targetLang: items[i].targetLang, apiKey },
      {
        isCancelled: opts.isCancelled,
        onStatusChange: status => update(i, { status }),
        onLogItem: item => {
          const log = mergeLogItem(tasks[i].log, item);
          update(i, {
            log,
            editCount: log.filter(l => l.type === 'edit').length,
            // Keep the latest error visible on the collapsed row too.
            ...(item.type === 'error' ? { error: item.content } : {}),
          });
        },
      },
    );

    if (result === 'cancelled') return 'cancelled';
    // 'error': recorded by the runner via onStatusChange — continue with the
    // remaining items rather than abandoning the whole queue.
  }

  return 'done';
}
