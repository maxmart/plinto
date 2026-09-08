/**
 * The shared lightning-fs plumbing for browser mode: the filesystem, its
 * health checks, directory helpers, and the site↔repo path mapping. Both
 * browser stores (files and git) sit on top of this.
 *
 * A factory rather than a module of constants, because the three names it
 * needs — the IndexedDB database, the directory the clone lands in, and where
 * the site sits inside its repository — are the site's configuration, and a
 * module that imports its own configuration is a module nothing can lift out.
 * The filesystem itself is still one per database: lightning-fs serializes
 * through an internal mutex and two instances contend for it, so the instance
 * is memoized by name here rather than left to the discipline of importing
 * this module only once.
 */

import LightningFS from '@isomorphic-git/lightning-fs';
import { collapseDots } from './path-normalize';

export interface BrowserFsOptions {
  /** IndexedDB database backing the filesystem. */
  fsDbName: string;
  /** Absolute lightning-fs path the repository is cloned into. */
  repoDir: string;
  /**
   * Where the site sits inside its git repository, '' when site === repo.
   *
   * The whole repo is cloned into lightning-fs at repoDir, so the site's files
   * land at repoDir/siteSubdir/… All FileStore/GitStore paths are
   * site-relative; every path crossing into lightning-fs or isomorphic-git
   * needs to be translated.
   */
  siteSubdir: string;
}

export interface BrowserFs {
  readonly REPO_DIR: string;
  getFs(): LightningFS;
  /** Site-relative → repo-relative. Empty subdir is a no-op. */
  toRepoPath(siteRelative: string): string;
  /** Repo-relative → site-relative. Empty subdir is a no-op. */
  toSitePath(repoRelative: string): string;
  /** Site-relative → absolute lightning-fs path under REPO_DIR. */
  fsPath(siteRelative: string): string;
  /** mkdir -p over lightning-fs, tolerating already-existing directories. */
  mkdirp(dirPath: string): Promise<void>;
  /** Write a repo-relative file, creating parent directories as needed. */
  writeRepoFile(repoPath: string, data: Uint8Array | string): Promise<void>;
  /** Run the one-time database health checks. Safe to await repeatedly. */
  ensureHealthy(): Promise<void>;
}

/**
 * One LightningFS per database name, for the whole page.
 *
 * lightning-fs serializes through an internal mutex, and separate instances
 * over the same database contend for it.
 */
const instances = new Map<string, LightningFS>();
const healthChecks = new Map<string, Promise<void>>();

export function createBrowserFs({ fsDbName, repoDir, siteSubdir }: BrowserFsOptions): BrowserFs {
  // Paths coming FROM callers are site-relative — prepend the subdir. They may
  // climb with '../' (shared collections live outside the site directory),
  // which neither lightning-fs nor iso-git resolves itself, hence collapseDots.
  //
  // Paths coming FROM iso-git (log file entries) are repo-relative — strip the
  // subdir before returning to callers, or spell paths outside it with a '../'
  // climb so they round-trip through toRepoPath and match how the site's config
  // spells them. Nothing is filtered: this clone is only ever written by this
  // site's CMS, so there are no foreign changes to hide.
  const subdir = (siteSubdir ?? '').replace(/^\/+|\/+$/g, '');
  const withSlash = subdir ? `${subdir}/` : '';
  const climb = subdir ? subdir.split('/').map(() => '..').join('/') + '/' : '';

  const getFs = (): LightningFS => {
    let fs = instances.get(fsDbName);
    if (!fs) {
      fs = new LightningFS(fsDbName);
      instances.set(fsDbName, fs);
    }
    return fs;
  };

  const toRepoPath = (siteRelative: string): string =>
    subdir ? collapseDots(`${withSlash}${siteRelative.replace(/^\/+/, '')}`) : siteRelative;

  const toSitePath = (repoRelative: string): string => {
    if (!subdir) return repoRelative;
    if (repoRelative.startsWith(withSlash)) return repoRelative.slice(withSlash.length);
    return `${climb}${repoRelative}`;
  };

  const mkdirp = async (dirPath: string): Promise<void> => {
    const pfs = getFs().promises;
    const parts = dirPath.split('/').filter(Boolean);
    let currentPath = '';
    for (const part of parts) {
      currentPath += '/' + part;
      try {
        await pfs.mkdir(currentPath);
      } catch (e: unknown) {
        if ((e as { code?: string })?.code !== 'EEXIST') {
          // Not a clean "exists" — but it may still exist (race, odd code).
          try {
            await pfs.stat(currentPath);
          } catch {
            throw e;
          }
        }
      }
    }
  };

  return {
    REPO_DIR: repoDir,
    getFs,
    toRepoPath,
    toSitePath,
    fsPath: siteRelative => collapseDots(`${repoDir}/${toRepoPath(siteRelative.replace(/^\/+/, ''))}`),
    mkdirp,
    writeRepoFile: async (repoPath, data) => {
      const full = `${repoDir}/${repoPath}`;
      const parentDir = full.slice(0, full.lastIndexOf('/'));
      if (parentDir) await mkdirp(parentDir);
      await getFs().promises.writeFile(full, data as Uint8Array);
    },
    ensureHealthy: () => {
      let check = healthChecks.get(fsDbName);
      if (!check) {
        check = breakStuckFsLock(fsDbName).then(() => deleteStorelessDb(fsDbName));
        healthChecks.set(fsDbName, check);
      }
      return check;
    },
  };
}

/**
 * Break a stuck filesystem lock left by a crashed or hung tab.
 *
 * lightning-fs serializes tabs with a Web Lock (`${fsDbName}_lock`). A tab
 * that crashed mid-operation — the store-less-db bug did exactly this — keeps
 * holding it until the tab closes, and every other tab waits forever on
 * "Connecting to repository…" with no error and no way out short of the user
 * hunting down the zombie tab.
 *
 * A healthy holder releases between operations within milliseconds, so a probe
 * acquisition that is still pending after several seconds means the holder is
 * gone for good. Stealing is safe then: the zombie's operations already fail.
 */
async function breakStuckFsLock(fsDbName: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks?.query) return;
  const lockName = `${fsDbName}_lock`;
  try {
    const { held } = await navigator.locks.query();
    const holder = held?.find(l => l.name === lockName);
    if (!holder) return;

    // If the holder is THIS tab (another island already spun up the fs), the
    // lock is live and healthy — probing it would just stall page load for
    // the full timeout and then steal from ourselves.
    const probeName = `${lockName}_probe_${Math.random().toString(36).slice(2)}`;
    let ownClientId: string | undefined;
    await navigator.locks.request(probeName, async () => {
      const q = await navigator.locks.query();
      ownClientId = q.held?.find(l => l.name === probeName)?.clientId;
    });
    if (ownClientId && holder.clientId === ownClientId) return;

    const acquired = await new Promise<boolean>(resolve => {
      const controller = new AbortController();
      // A healthy holder releases between operations within milliseconds;
      // 2s of silence is already decisive, and this wait blocks page load.
      const timer = setTimeout(() => { controller.abort(); resolve(false); }, 2000);
      navigator.locks
        .request(lockName, { signal: controller.signal }, async () => {
          clearTimeout(timer);
          resolve(true);
        })
        .catch(() => resolve(false));
    });
    if (acquired) return;

    console.warn(`[plinto] filesystem lock ${lockName} is stuck (held by a crashed tab?) — breaking it`);
    await navigator.locks.request(lockName, { steal: true }, async () => {});
  } catch {
    // Lock introspection is best-effort; worst case is the old behavior.
  }
}

/**
 * Delete a store-less fs database before lightning-fs ever opens it.
 *
 * An older PreviewButton probed for the repo with indexedDB.open(), which
 * *creates* the database — empty, no object stores. lightning-fs then finds it
 * already at its version, skips onupgradeneeded, and every transaction fails —
 * including the one backing its internal mutex, which surfaces as "Mutex
 * timeout" and leaves the admin loading forever. Deleting the husk lets
 * lightning-fs create it properly.
 *
 * Must run before getFs() is first called: deleteDatabase blocks while any
 * connection is open, and lightning-fs holds one from construction.
 */
function deleteStorelessDb(fsDbName: string): Promise<void> {
  return new Promise<void>(resolve => {
    const req = indexedDB.open(fsDbName);
    req.onerror = () => resolve();
    req.onsuccess = () => {
      const db = req.result;
      const empty = db.objectStoreNames.length === 0;
      db.close();
      if (!empty) return resolve();
      console.warn(`[plinto] fs database ${fsDbName} has no object stores — deleting it`);
      const del = indexedDB.deleteDatabase(fsDbName);
      del.onsuccess = del.onerror = () => resolve();
      // Another tab holds it open; don't hang this one on that.
      del.onblocked = () => resolve();
    };
  });
}
