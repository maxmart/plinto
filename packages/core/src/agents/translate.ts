/**
 * Translation, bound to Plinto's documents.
 *
 * The runner and the save rule are `@obelum/core`'s; the translating is
 * `@obelum/translator-claude`'s. Neither knows about MDX, frontmatter,
 * content paths or git. This module is the adapter between them and the ops
 * layer: it answers the runner's per-document questions (the current version
 * of a language, the version at an older revision, which lines are
 * bookkeeping, how to save) out of content ops and the git store, and tells
 * the translator the rules that are specific to an MDX site.
 */
import {
  resolveRevToContent,
  runTranslation as run,
  type CommitReader,
  type TranslationDeps,
  type RunTranslationCallbacks,
} from '@obelum/core';
import { claude, type DriveFn } from '@obelum/translator-claude';
import { parseSyncMeta, stripSyncMetadataLines } from '../sync-meta';
import { FileNotFoundError } from '../storage/file-store/types';

export {
  mergeLogItem,
  type LogItem,
  type TranslationStatus,
  type RunTranslationCallbacks,
} from '@obelum/core';

/**
 * What a translation needs from the layers below it: the site's languages, the
 * three content operations it reads and writes through, and a reader for the
 * history the anchored diff walks back into.
 *
 * Named here rather than imported, so the agent layer depends on nothing but
 * the shape of what it uses — it is a layer on top of ops, and this is the
 * only place that says so.
 */
export interface TranslationHost {
  locales: readonly string[];
  getContent(file: string): Promise<string>;
  syncContent(contentPath: string, lang: string, content: string): Promise<void>;
  resolveFilePath(contentPath: string, lang: string): Promise<string>;
  commits(): Promise<CommitReader>;
}

export interface RunTranslationOptions {
  contentPath: string;    // e.g. 'page/support' or 'news/summer-cup'
  targetLang: string;
  apiKey: string;
  /** Replace the model with a script or a recording (evals). */
  drive?: DriveFn;
}

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

/** The runner's view of one document, over this host. */
export function translationDeps(host: TranslationHost, contentPath: string): TranslationDeps {
  const { locales, getContent, syncContent, resolveFilePath, commits } = host;
  return {
    locales,

    async read(lang) {
      const file = await resolveFilePath(contentPath, lang);
      try {
        const content = await getContent(file);
        return { content, meta: parseSyncMeta(content) };
      } catch (err) {
        // Only a file that genuinely is not there reads as "no translation
        // yet". A transient read failure — a lightning-fs mutex timeout, an
        // aborted transaction — would otherwise present an existing
        // translation as empty, and the run would write over it.
        if (err instanceof FileNotFoundError) return null;
        throw err;
      }
    },

    async readAtRev(lang, rev) {
      const file = await resolveFilePath(contentPath, lang);
      return resolveRevToContent(await commits(), file, rev, c => parseSyncMeta(c).rev);
    },

    dropLines: stripSyncMetadataLines,

    write: (lang, content) => syncContent(contentPath, lang, content),

    async instructions() {
      const glossary = await loadGlossary(getContent);
      return glossary
        ? `${MDX_RULES}\n\nThe site has a translation glossary. Its term choices are binding:\n\n${glossary}`
        : MDX_RULES;
    },
  };
}

/**
 * Run a single translation over this host's documents, with Claude.
 * Returns 'done' on success, 'error' on failure, 'cancelled' if cancelled.
 */
export function runTranslation(
  host: TranslationHost,
  opts: RunTranslationOptions,
  callbacks: RunTranslationCallbacks,
): Promise<'done' | 'error' | 'cancelled'> {
  const { contentPath, targetLang, apiKey, drive } = opts;
  return run(translationDeps(host, contentPath), claude({ apiKey, drive }), { targetLang }, callbacks);
}
