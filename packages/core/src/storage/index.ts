/**
 * The storage layer, as one object per site.
 *
 * Two modes behind one abstraction: dev mode talks to the Astro dev server's
 * API routes against the real working tree, browser mode clones the repository
 * into lightning-fs and runs isomorphic-git over it. Which one is in play is
 * decided once, here, by whoever builds the object — `dev` is the caller's
 * fact, not something this layer sniffs for itself.
 *
 * Both stores are created lazily and then kept: BrowserFileStore caches blob
 * URLs, and two GitStores over one repository means two merge sessions, where
 * the one holding a pending merge may not be the one everything else is
 * talking to and nobody can finish it.
 */

import '../buffer-polyfill';
import type { ResolvedConfig } from '../resolved-config';
import type { Settings } from '../settings';
import type { FileStore } from './file-store/types';
import type { GitStore } from './git-store/types';

export type { FileStore } from './file-store/types';
export type { GitStore } from './git-store/types';
export type { CommitInfo, FileChange, MergeResult, ConflictFile, ProgressFn } from './git-store/types';

export interface Stores {
  /** True when reads and writes go to the real working tree through the dev server. */
  readonly dev: boolean;
  getFileStore(): Promise<FileStore>;
  getGitStore(): Promise<GitStore>;
}

export interface StorageDeps {
  /**
   * Dev mode: the Astro dev server is running and its API routes are
   * available, so files are read live from disk over HTTP. Otherwise this is
   * the static export, where browser storage is the only option.
   */
  dev: boolean;
  /** Where the browser store finds the editor's credentials. Unused in dev mode. */
  settings: Settings;
}

export function createStores(config: ResolvedConfig, { dev, settings }: StorageDeps): Stores {
  let filePromise: Promise<FileStore> | null = null;
  let gitPromise: Promise<GitStore> | null = null;

  /**
   * Memoized on the promise, not on the result: there are awaits between the
   * guard and the assignment, so two callers arriving together would each
   * build a store — `AdminPage` alone fires
   * `Promise.all([getRepoInfo(), getSyncState()])`.
   *
   * A failed construction is forgotten, or the admin never recovers from one
   * bad load.
   */
  const once = <T>(slot: () => Promise<T> | null, set: (p: Promise<T> | null) => void, build: () => Promise<T>) => {
    let p = slot();
    if (!p) {
      p = build().catch(err => { set(null); throw err; });
      set(p);
    }
    return p;
  };

  const browserFs = async () => {
    const { createBrowserFs } = await import('./browser-fs');
    const bfs = createBrowserFs({
      fsDbName: config.storage.fsDbName,
      repoDir: config.storage.repoDir,
      siteSubdir: config.content.siteSubdir,
    });
    await bfs.ensureHealthy();
    return bfs;
  };

  return {
    dev,

    getFileStore: () => once(() => filePromise, p => { filePromise = p; }, async () => {
      if (dev) {
        const { HttpFileStore } = await import('./file-store/http');
        return new HttpFileStore();
      }
      const { BrowserFileStore } = await import('./file-store/browser');
      return new BrowserFileStore(await browserFs(), config.content.mediaDir);
    }),

    getGitStore: () => once(() => gitPromise, p => { gitPromise = p; }, async () => {
      if (dev) {
        const { HttpGitStore } = await import('./git-store/http');
        return new HttpGitStore();
      }
      const { createBrowserGitStore } = await import('./git-store/browser');
      return createBrowserGitStore({ git: config.git, fs: await browserFs(), settings });
    }),
  };
}
