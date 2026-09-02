/**
 * Content-level operations: documents addressed by their abstract
 * `contentPath` ('page/support', 'staff/anna', 'topbar'), read and written
 * with their rev/synced vector clocks maintained. This is where the
 * translation-sync bookkeeping actually happens on every save:
 *
 * - editContent  — a real edit: rev increments, staleness spreads.
 * - syncContent  — a translation landing: rev stays, synced map updates.
 * - fixContent   — a minor fix: rev AND synced stay exactly as they were.
 */

import type { Stores } from '../storage';
import { FileNotFoundError, type DirEntry } from '../storage/file-store/types';
import { parseSyncMeta, setSyncMeta, syncMetaFromData, type SyncMeta } from '../sync-meta';
import { computeStaleness, type StalenessInfo } from '@obelum/core';
import { candidateFilePaths } from '../layout';
import type { ResolvedConfig } from '../resolved-config';

export type { StalenessInfo } from '@obelum/core';

export interface ContentOpsDeps {
  config: ResolvedConfig;
  stores: Stores;
}

/** The content operations, bound to one site's configuration and storage. */
export function createContentOps({ config, stores }: ContentOpsDeps) {

  // ── File-level (read-only) ─────────────────────────────────

  async function getContent(file: string): Promise<string> {
    const fileStore = await stores.getFileStore();
    return fileStore.readFile(file);
  }

  async function listContent(dir: string): Promise<DirEntry[]> {
    const fileStore = await stores.getFileStore();
    return fileStore.readDir(dir);
  }

  async function batchFrontmatter(paths: string[]): Promise<Record<string, Record<string, unknown> | null>> {
    const fileStore = await stores.getFileStore();
    return fileStore.readManyFrontmatter(paths);
  }

  async function writeFile(file: string, content: string): Promise<void> {
    const fileStore = await stores.getFileStore();
    await fileStore.writeFile(file, content);
  }

  interface LangMeta { meta: SyncMeta; file: string }

  /**
   * The file a contentPath actually lives in for a language, trying every layout
   * the slug can collapse from (docs/foo.mdx, then docs/foo/index.mdx). Falls
   * back to the flat form when none exists — that is where a new file belongs.
   *
   * Any code that goes on to *write* must resolve first: writing to the flat
   * guess when the page lives at …/index.mdx would fork the page into two files
   * that Astro routes to the same URL.
   */
  async function resolveFilePath(contentPath: string, lang: string): Promise<string> {
    const candidates = candidateFilePaths(config, contentPath, lang);
    if (candidates.length > 1) {
      const fms = await batchFrontmatter(candidates);
      const found = candidates.find(f => fms[f]);
      if (found) return found;
    }
    return candidates[0];
  }

  async function readAllSyncMeta(contentPath: string): Promise<Record<string, LangMeta | null>> {
    const perLang = config.i18n.locales.map((lang: string) => ({ lang, candidates: candidateFilePaths(config, contentPath, lang) }));
    const frontmatters = await batchFrontmatter(perLang.flatMap(p => p.candidates));
    return Object.fromEntries(
      perLang.map(({ lang, candidates }) => {
        // The resolved file rides along so writers stamp the file that was
        // actually read instead of re-guessing the flat form.
        const file = candidates.find(f => frontmatters[f]);
        if (!file) return [lang, null];
        return [lang, { meta: syncMetaFromData(frontmatters[file]!), file }];
      })
    );
  }

  function buildSyncedMap(metas: Record<string, LangMeta | null>): Record<string, number> {
    const synced: Record<string, number> = {};
    for (const [lang, entry] of Object.entries(metas)) {
      if (entry) synced[lang] = entry.meta.rev;
    }
    return synced;
  }

  // ── Content-level writes ───────────────────────────────────

  /**
   * The revision and vector clock the file already carries, or a fresh pair if
   * there is no file yet.
   *
   * "No file yet" has to mean exactly that. A blanket catch here read a
   * lightning-fs mutex timeout or an aborted IndexedDB transaction — failure
   * modes this storage layer defends against elsewhere — as a new document, and
   * stamped `rev: 1, synced: {}` over a page that had a history. Every other
   * language then looked newer than the one just edited, so the next sync
   * translated over the save. A transient read failure must stop the write, not
   * silently restart the clock.
   */
  async function existingSyncMeta(file: string): Promise<SyncMeta> {
    try {
      return parseSyncMeta(await getContent(file));
    } catch (err) {
      if (err instanceof FileNotFoundError) return { rev: 0, synced: {} };
      throw err;
    }
  }

  async function editContent(contentPath: string, lang: string, content: string): Promise<void> {
    const gitStore = await stores.getGitStore();
    const file = await resolveFilePath(contentPath, lang);

    const { rev, synced } = await existingSyncMeta(file);
    const stamped = setSyncMeta(content, rev + 1, synced);
    await writeFile(file, stamped);
    await gitStore.commitFiles(`Edit ${contentPath} (${lang})`, [file]);
  }

  async function syncContent(contentPath: string, lang: string, content: string): Promise<void> {
    const gitStore = await stores.getGitStore();

    const metas = await readAllSyncMeta(contentPath);
    const file = metas[lang]?.file ?? candidateFilePaths(config, contentPath, lang)[0];
    const synced = buildSyncedMap(metas);

    let currentRev = 0;
    const existing = metas[lang];
    if (existing) currentRev = existing.meta.rev;

    const stamped = setSyncMeta(content, currentRev, synced);
    await writeFile(file, stamped);
    await gitStore.commitFiles(`Sync ${contentPath} (${lang})`, [file]);
  }

  async function fixContent(contentPath: string, lang: string, content: string): Promise<void> {
    const gitStore = await stores.getGitStore();
    const file = await resolveFilePath(contentPath, lang);

    // Re-stamp the sync metadata from the file on disk rather than trusting what
    // the caller passed. A minor fix means "content changed, revision did not",
    // so rev and synced must survive it verbatim.
    //
    // Writing the caller's content unchanged used to be enough to corrupt them:
    // an editor that round-tripped frontmatter through String() turned rev into
    // a quoted string and synced into "[object Object]", both of which parse
    // back as rev 0 / no synced map. That made the language you had just edited
    // look older than every other one, so it was reported stale and the next
    // sync overwrote your fix with a translation of the others.
    const meta = await existingSyncMeta(file);

    await writeFile(file, setSyncMeta(content, meta.rev, meta.synced));
    await gitStore.commitFiles(`Fix ${contentPath} (${lang})`, [file]);
  }

  // ── Content-level queries ──────────────────────────────────

  async function getStaleness(contentPath: string): Promise<Record<string, StalenessInfo>> {
    const metas = await readAllSyncMeta(contentPath);
    const syncMetas: Record<string, SyncMeta | null> = {};
    for (const [lang, entry] of Object.entries(metas)) {
      syncMetas[lang] = entry ? entry.meta : null;
    }
    return computeStaleness(syncMetas, config.i18n.locales);
  }

  /**
   * Declare every stale language up to date without translating: stamp each
   * one's synced map with all current revs. The escape hatch for "the languages
   * genuinely differ on purpose".
   */
  async function markAsSynced(contentPath: string): Promise<void> {
    const gitStore = await stores.getGitStore();
    const metas = await readAllSyncMeta(contentPath);
    const syncMetas: Record<string, SyncMeta | null> = {};
    for (const [lang, entry] of Object.entries(metas)) {
      syncMetas[lang] = entry ? entry.meta : null;
    }
    const staleness = computeStaleness(syncMetas, config.i18n.locales);

    const updatedFiles: string[] = [];
    const synced = buildSyncedMap(metas);

    for (const [lang, entry] of Object.entries(metas)) {
      if (!entry || staleness[lang]?.status !== 'stale') continue;

      const raw = await getContent(entry.file);
      const stamped = setSyncMeta(raw, entry.meta.rev, synced);
      await writeFile(entry.file, stamped);
      updatedFiles.push(entry.file);
    }

    if (updatedFiles.length > 0) {
      await gitStore.commitFiles(`Mark ${contentPath} as synced`, updatedFiles);
    }
  }

  return {
    getContent,
    listContent,
    resolveFilePath,
    editContent,
    syncContent,
    fixContent,
    getStaleness,
    markAsSynced,
  };
}
