/**
 * Content-level operations: documents addressed by their abstract
 * `contentPath` ('page/support', 'staff/anna', 'topbar'), read and written
 * through Obelum, which keeps translations in step.
 *
 * Every language keeps a copy of every language's file as of the last time
 * it looked, under `.obelum/{viewer}/` at the repository root (see
 * `syncedFilePath`). Staleness is whether a copy differs from the real file;
 * nothing is stamped into the documents themselves. The verbs:
 *
 * - editContent  — a real edit: siblings' copies are untouched, so they go stale.
 * - fixContent   — a correction, or deliberate local-only content: merged into
 *                  every sibling's copy so it never reads as news.
 * - syncContent  — a translation landing: the same fan-out, then this
 *                  language's copies snap to the real files.
 */

import { obelum, type Document, type Session, type LangStatus } from '@obelum/core';
import type { Stores } from '../storage';
import { FileNotFoundError, type DirEntry } from '../storage/file-store/types';
import { candidateFilePaths, syncedFilePath } from '../layout';
import type { ResolvedConfig } from '../resolved-config';

export type { Session, Round, LangStatus } from '@obelum/core';

export type StalenessStatus = 'synced' | 'stale' | 'missing';

/** One language's place in a document, as the admin shows it. */
export interface StalenessInfo {
  status: StalenessStatus;
  /** The siblings this language has not caught up with. */
  stale: string[];
}

export interface ContentOpsDeps {
  config: ResolvedConfig;
  stores: Stores;
}

/** MDX: a hunk in the translator's brief is named after the nearest tag above it. */
const MDX_ANCHOR = (line: string) => line.trimStart().startsWith('<');

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

  // ── The document, as Obelum sees it ────────────────────────

  /**
   * One document's languages and copies over this site's stores. Writes are
   * staged as they happen and each verb ends in one commit of them, the way
   * `git add` and `git commit` divide the work.
   *
   * "No file" has to mean exactly that. A transient read failure — a
   * lightning-fs mutex timeout, an aborted IndexedDB transaction — must stop
   * the verb, not read as a missing translation: presented as missing, an
   * existing page would be translated from scratch and written over.
   */
  function document(contentPath: string): Session {
    let staged: string[] = [];
    const file = (path: () => Promise<string>) => ({
      async read() {
        const fileStore = await stores.getFileStore();
        try {
          // Staleness compares bytes, so both sides must agree on line
          // endings. A Windows checkout with autocrlf hands the dev store
          // CRLF while everything the editor writes is LF; a copy and its
          // real file would then differ on every line and read as stale, and
          // a fix fanned into such a copy would conflict on every hunk.
          return (await fileStore.readFile(await path())).replace(/\r\n/g, '\n');
        } catch (err) {
          if (err instanceof FileNotFoundError) return null;
          throw err;
        }
      },
      async write(content: string) {
        const fileStore = await stores.getFileStore();
        const p = await path();
        await fileStore.writeFile(p, content);
        staged.push(p);
      },
    });
    const doc: Document = {
      langs: config.i18n.locales,
      file: lang => file(() => resolveFilePath(contentPath, lang)),
      synced: viewer => ({
        file: lang => file(async () => syncedFilePath(config, await resolveFilePath(contentPath, lang), viewer)),
      }),
      anchor: MDX_ANCHOR,
      async commit(verb, lang) {
        const files = staged;
        staged = [];
        if (files.length === 0) return;
        const gitStore = await stores.getGitStore();
        const message = verb === 'markAsSynced'
          ? `Mark ${contentPath} (${lang}) as synced`
          : `${verb[0].toUpperCase()}${verb.slice(1)} ${contentPath} (${lang})`;
        await gitStore.commitFiles(message, files);
      },
    };
    return obelum(doc);
  }

  // ── Content-level writes ───────────────────────────────────

  function editContent(contentPath: string, lang: string, content: string): Promise<void> {
    return document(contentPath).edit(lang, content);
  }

  async function syncContent(contentPath: string, lang: string, content: string): Promise<void> {
    await document(contentPath).sync(lang, content);
  }

  async function fixContent(contentPath: string, lang: string, content: string): Promise<void> {
    await document(contentPath).fix(lang, content);
  }

  // ── Content-level queries ──────────────────────────────────

  function statusOf(s: LangStatus): StalenessInfo {
    return { status: s.missing ? 'missing' : s.stale.length ? 'stale' : 'synced', stale: s.stale };
  }

  async function getStaleness(contentPath: string): Promise<Record<string, StalenessInfo>> {
    const stale = await document(contentPath).stale();
    return Object.fromEntries(Object.entries(stale).map(([lang, s]) => [lang, statusOf(s)]));
  }

  /**
   * Declare a language up to date with everyone without translating; every
   * existing language when none is given. An ops primitive, and a claim that
   * can be false: the languages genuinely differ on purpose, or a migration
   * is writing the first copies.
   */
  async function markAsSynced(contentPath: string, lang?: string): Promise<void> {
    const session = document(contentPath);
    if (lang) { await session.markAsSynced(lang); return; }
    const stale = await session.stale();
    for (const l of config.i18n.locales) {
      if (!stale[l].missing) await session.markAsSynced(l);
    }
  }

  return {
    getContent,
    listContent,
    resolveFilePath,
    document,
    editContent,
    syncContent,
    fixContent,
    getStaleness,
    markAsSynced,
  };
}
