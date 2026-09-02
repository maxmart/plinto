/**
 * BrowserGitStore - git primitives using isomorphic-git in the browser.
 * No CMS concepts: what counts as a conflict is the caller's policy (see
 * merge()), and the three-way merge itself lives in ./merge.
 *
 * A factory over the filesystem, the git settings and the browser's stored
 * credentials. Reaching for those directly is what made this file — the
 * deepest one in the library — impossible to construct anywhere else, and
 * impossible to test without mocking a module.
 */

import '../../buffer-polyfill';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { GitStore, ProgressFn, CommitInfo, FileChange, MergeResult, RemoteInfo } from './types';
import type { ResolvedGit } from '../../resolved-config';
import type { BrowserFs } from '../browser-fs';
import { createMerge, type PendingMerge } from './merge';
import type { Settings } from '../../settings';
import { parseGitHubRepo } from '../../github';
import { UserFacingError } from '../../user-error';

/**
 * Browser mode's extra step: everything that touches the repository first
 * checks it is actually there, and the check is cached.
 */
export interface BrowserGitStore extends GitStore {
  checkInitialized(): Promise<boolean>;
}

export interface BrowserGitStoreDeps {
  git: ResolvedGit;
  fs: BrowserFs;
  settings: Settings;
}

export function createBrowserGitStore({ git: gitConfig, fs: bfs, settings }: BrowserGitStoreDeps): BrowserGitStore {
  const merge = createMerge(bfs, gitConfig.defaultBranch);

  // CORS proxy for browser-based git operations
  function getCorsProxy(): string {
    if (typeof localStorage !== 'undefined') {
      return settings.proxyUrl() || gitConfig.corsProxy;
    }
    return gitConfig.corsProxy;
  }

  // Build Basic auth header to send credentials preemptively,
  // avoiding the initial 401 → onAuth retry round-trip.
  function authHeaders(token: string): Record<string, string> {
    return {
      Authorization: 'Basic ' + btoa(`x-access-token:${token}`),
    };
  }

  class Store implements BrowserGitStore {
    private _initialized = false;
    private _repoUrl: string | null = null;
    private _pendingMerge: PendingMerge | null = null;
    /**
     * Identifies this store's merges on disk. Two admin tabs share one
     * lightning-fs repository with nothing locking between them, so a merge
     * marker has to say whose it is.
     */
    private readonly _session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    /**
     * Refuse to go on while the repository is mid-merge — ours or anyone's.
     *
     * This is what actually protects the half-merged state. MERGE_HEAD does
     * not: isomorphic-git never reads it, so an ordinary commit taken while a
     * merge is pending still produces a single-parent commit — sweeping the
     * remote's changes in as though they were the user's own, after which
     * every push is rejected as non-fast-forward.
     *
     * It used to wave through a merge this store owned, on the reasoning that
     * our own merge is under control. It is not: the index is full of the
     * remote's staged files for the whole time a human spends answering
     * conflict questions, and the admin leaves its Sync buttons live
     * throughout. A translation saved in that window committed the remote as
     * its own single parent — and then cancelling the conflict rolled HEAD
     * back past it, deleting the translation, file and commit.
     *
     * Nothing legitimate commits during a merge: completing one goes through
     * commitMerge, not here.
     */
    private async assertNotMidMerge(): Promise<void> {
      if (!(await merge.readPendingMarker())) return;
      throw new UserFacingError(
        'A publish is part-way through merging changes from elsewhere, so this cannot be saved yet. ' +
        'Finish or cancel that publish, or discard local changes to start over.',
        'discard',
      );
    }

    private getAuthor(): { name: string; email: string } {
      const name = settings.adminName() || gitConfig.defaultAuthorName;
      return { name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@plinto.local` };
    }

    private get pfs() {
      return bfs.getFs().promises;
    }

    public async checkInitialized(): Promise<boolean> {
      try {
        await this.pfs.stat(bfs.REPO_DIR);
        // Check if it's actually a git repo
        await this.pfs.stat(`${bfs.REPO_DIR}/.git`);
        this._initialized = true;

        // Deliberately does NOT clean up a merge left pending here. It did, and
        // that was worse than the problem: a second admin tab opening during
        // the minute a human spends answering conflict questions in the first
        // one would roll the merge back underneath it, and the first tab then
        // committed `[savedHead, remoteOid]` over a tree that no longer held
        // the remote's changes — git told the changes were merged, the changes
        // gone, and unrecoverable because remoteOid had become an ancestor.
        //
        // A pending merge is now refused rather than repaired: commitFiles
        // will not commit past one, completeMerge will not commit a merge that
        // is no longer the one on disk, and Discard clears it.

        // Try to get repo URL from config
        try {
          const config = await git.getConfig({
            fs: bfs.getFs(),
            dir: bfs.REPO_DIR,
            path: 'remote.origin.url',
          });
          this._repoUrl = config || null;
          if (this._repoUrl) {
            settings.setRepoUrl(this._repoUrl);
          }
        } catch {
          // No remote configured — try to restore from localStorage backup
          const backupUrl = settings.repoUrl();
          if (backupUrl) {
            try {
              await git.setConfig({
                fs: bfs.getFs(),
                dir: bfs.REPO_DIR,
                path: 'remote.origin.url',
                value: backupUrl,
              });
              this._repoUrl = backupUrl;
            } catch {
              // Failed to restore remote config
            }
          }
        }

        return true;
      } catch {
        this._initialized = false;
        return false;
      }
    }

    private async deleteDir(dirPath: string): Promise<void> {
      try {
        const entries = await this.pfs.readdir(dirPath);

        for (const entry of entries) {
          const entryPath = `${dirPath}/${entry}`;
          const stat = await this.pfs.stat(entryPath);

          if (stat.isDirectory()) {
            await this.deleteDir(entryPath);
          } else {
            await this.pfs.unlink(entryPath);
          }
        }

        await this.pfs.rmdir(dirPath);
      } catch {
        // Directory might not exist
      }
    }

    private async fetchFileFromGitHub(path: string, commitHash: string): Promise<string> {
      const info = this._repoUrl ? parseGitHubRepo(this._repoUrl) : null;
      if (!info) throw new Error('Not a GitHub repository');
      const url = `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${commitHash}/${path}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`GitHub fetch failed: ${response.status} for ${path} at ${commitHash}`);
      }
      return response.text();
    }

    // ── GitStore interface: Local operations ──────────────────────────

    async commitFiles(message: string, files: string[]): Promise<void> {
      if (!this._initialized) { await this.checkInitialized(); }
      if (!this._initialized) {
        throw new Error('Repository not initialized');
      }
      await this.assertNotMidMerge();

      // Stage only the specified files. Caller passes site-relative paths;
      // translate each to repo-relative before hitting iso-git or the fs.
      let hasChanges = false;
      for (const sitePath of files) {
        const filepath = bfs.toRepoPath(sitePath);
        // Check if the file exists in the working tree
        let exists = true;
        try {
          await this.pfs.stat(`${bfs.REPO_DIR}/${filepath}`);
        } catch (err) {
          // Only a genuine "not found" means the file was deleted. Anything
          // else — a lightning-fs mutex timeout, an aborted IDB transaction —
          // must not be read as a deletion: staging one would commit the page
          // away while it still sits in the working tree.
          if ((err as { code?: string })?.code !== 'ENOENT') throw err;
          exists = false;
        }

        if (exists) {
          // Stage FIRST, ask after: add re-reads and re-hashes the file, so the
          // status that follows compares real content against HEAD. Asking
          // before staging trusts the index's cached stats, which lightning-fs
          // keeps second-granular — a same-length save in the same second read
          // as 'unmodified' and was silently dropped.
          await git.add({ fs: bfs.getFs(), dir: bfs.REPO_DIR, filepath });
          // Byte-identical saves happen (a "minor fix" that changes nothing) —
          // counting them as changes would produce an empty junk commit below.
          const status = await git.status({ fs: bfs.getFs(), dir: bfs.REPO_DIR, filepath });
          if (status !== 'unmodified') hasChanges = true;
        } else {
          // Deleted on purpose — drop it from the index. `remove` is a silent
          // no-op for an untracked path, so ask the index first rather than
          // counting a phantom change.
          const status = await git.status({ fs: bfs.getFs(), dir: bfs.REPO_DIR, filepath });
          if (status !== 'absent') {
            await git.remove({ fs: bfs.getFs(), dir: bfs.REPO_DIR, filepath });
            hasChanges = true;
          }
        }
      }

      if (!hasChanges) {
        return;
      }

      await git.commit({
        fs: bfs.getFs(),
        dir: bfs.REPO_DIR,
        message,
        author: this.getAuthor(),
      });
    }

    async getHeadHash(): Promise<string> {
      if (!this._initialized) {
        await this.checkInitialized();
      }
      if (!this._initialized) {
        throw new Error('Repository not initialized');
      }

      return git.resolveRef({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref: 'HEAD' });
    }

    async getLog(limit: number): Promise<CommitInfo[]> {
      if (!this._initialized) { await this.checkInitialized(); }
      if (!this._initialized) return [];

      try {
        const commits = await git.log({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref: 'HEAD', depth: limit });
        const result: CommitInfo[] = [];

        for (const entry of commits) {
          const currentTree = await merge.walkTree(entry.oid);
          let parentTree = new Map<string, string>();
          if (entry.commit.parent.length > 0) {
            try { parentTree = await merge.walkTree(entry.commit.parent[0]); } catch { /* first commit */ }
          }

          // Diff the two trees. Paths from git are repo-relative; translate
          // each to site-relative.
          const files: FileChange[] = [];
          const push = (repoPath: string, type: FileChange['type']) => {
            files.push({ path: bfs.toSitePath(repoPath), type });
          };
          for (const [path, oid] of currentTree) {
            const parentOid = parentTree.get(path);
            if (!parentOid) push(path, 'added');
            else if (parentOid !== oid) push(path, 'modified');
          }
          for (const path of parentTree.keys()) {
            if (!currentTree.has(path)) push(path, 'deleted');
          }

          result.push({ hash: entry.oid, message: entry.commit.message.trim(), files });
        }

        return result;
      } catch {
        return [];
      }
    }

    async readBlobAtCommit(repoPath: string, hash: string): Promise<string> {
      if (!this._initialized) { await this.checkInitialized(); }
      try {
        const { blob } = await git.readBlob({
          fs: bfs.getFs(),
          dir: bfs.REPO_DIR,
          oid: hash,
          filepath: bfs.toRepoPath(repoPath),
        });
        return new TextDecoder().decode(blob);
      } catch {
        // The local clone is shallow/single-branch, so a commit referenced by
        // sync metadata may not exist locally — fall back to fetching the file
        // from GitHub's raw endpoint.
        return this.fetchFileFromGitHub(repoPath, hash);
      }
    }

    async getParentCommit(hash: string): Promise<string | null> {
      const { commit } = await git.readCommit({ fs: bfs.getFs(), dir: bfs.REPO_DIR, oid: hash });
      return commit.parent.length > 0 ? commit.parent[0] : null;
    }

    async getRemoteUrl(): Promise<string | null> {
      return this._repoUrl;
    }

    async checkout(ref: string): Promise<void> {
      if (!this._initialized) throw new Error('Repository not initialized');
      await git.checkout({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref, force: true });
    }

    // ── GitStore interface: Remote operations ─────────────────────────

    async fetch(token: string): Promise<void> {
      if (!this._initialized) throw new Error('Repository not initialized');

      await git.fetch({
        fs: bfs.getFs(),
        http,
        dir: bfs.REPO_DIR,
        corsProxy: getCorsProxy(),
        singleBranch: true,
        headers: authHeaders(token),
        onAuth: () => ({ username: 'x-access-token', password: token }),
      });
    }

    async push(token: string): Promise<string> {
      if (!this._initialized) throw new Error('Repository not initialized');

      const headOid = await git.resolveRef({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref: 'HEAD' });
      await git.push({
        fs: bfs.getFs(),
        http,
        dir: bfs.REPO_DIR,
        corsProxy: getCorsProxy(),
        headers: authHeaders(token),
        onAuth: () => ({ username: 'x-access-token', password: token }),
      });
      return headOid;
    }

    async merge(remoteOid: string, needsResolution: (path: string) => boolean): Promise<MergeResult> {
      if (!this._initialized) throw new Error('Repository not initialized');
      // Refused rather than overwritten. The record holds the HEAD to roll back
      // to, so replacing it loses the only way home from the first merge — and
      // a conflict-free second merge sets it to null, erasing it outright. Two
      // admin tabs on one repository reach this: both auto-pull on load.
      if (this._pendingMerge) {
        throw new UserFacingError(
          'This publish is already merging changes from elsewhere. Finish or cancel it before pulling again.',
        );
      }
      await this.assertNotMidMerge();
      const { result, pending } = await merge.threeWayMerge(
        remoteOid, this.getAuthor(), needsResolution, this._session,
      );
      this._pendingMerge = pending;
      return result;
    }

    async completeMerge(resolvedFiles: Map<string, string>): Promise<void> {
      if (!this._pendingMerge) throw new Error('No merge in progress');
      const pending = this._pendingMerge;
      this._pendingMerge = null;
      await merge.completePendingMerge(pending, resolvedFiles, this.getAuthor());
    }

    async hasPendingMerge(): Promise<boolean> {
      return (await merge.readPendingMarker()) !== null;
    }

    async abortMerge(): Promise<void> {
      if (!this._pendingMerge) return;
      const pending = this._pendingMerge;
      this._pendingMerge = null;
      await merge.abortPendingMerge(pending);
    }

    async resetToRemote(): Promise<void> {
      if (!this._initialized) {
        throw new Error('Repository not initialized');
      }

      // Discard means discard, including any merge in progress. This used to
      // delete three of the four state files by name and leave PLINTO_MERGE
      // behind, so the discard undid itself: the next load found the marker,
      // rolled HEAD back to the discarded commit, and every later merge was
      // refused because _pendingMerge had never been cleared either.
      //
      // The marker comes off at the END of this method, not here: clearing it
      // first and then failing to move the refs would leave a half-merged
      // working tree with nothing left to refuse the next save.
      this._pendingMerge = null;

      // Reset to the remote's tip of the configured branch, when there is one.
      let remoteRef: string | null = null;
      try {
        remoteRef = await git.resolveRef({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref: `refs/remotes/origin/${gitConfig.defaultBranch}` });
      } catch {
        // No remote ref — fall through and just clean the working tree.
      }

      if (remoteRef) {
        const branch = await git.currentBranch({ fs: bfs.getFs(), dir: bfs.REPO_DIR }) || gitConfig.defaultBranch;
        await git.writeRef({
          fs: bfs.getFs(),
          dir: bfs.REPO_DIR,
          ref: `refs/heads/${branch}`,
          value: remoteRef,
          force: true,
        });
      }

      // Restore every file that differs from the new HEAD. Raw bytes — a text
      // decode/encode round-trip would corrupt binaries.
      const statusMatrix = await git.statusMatrix({ fs: bfs.getFs(), dir: bfs.REPO_DIR });
      const headOid = await git.resolveRef({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref: 'HEAD' });

      for (const [filepath, head, workdir] of statusMatrix) {
        if (head === workdir) continue;

        if (head === 0) {
          // New file - delete it
          try {
            await this.pfs.unlink(`${bfs.REPO_DIR}/${filepath}`);
          } catch {
            // File might not exist
          }
        } else {
          // Modified or deleted file - restore from HEAD
          try {
            const { blob } = await git.readBlob({ fs: bfs.getFs(), dir: bfs.REPO_DIR, oid: headOid, filepath });
            await bfs.writeRepoFile(filepath, blob);
          } catch {
            // Ignore errors for individual files
          }
        }
      }

      // Reset the index to match HEAD
      await git.checkout({
        fs: bfs.getFs(),
        dir: bfs.REPO_DIR,
        force: true,
      });

      // Last, once the reset has actually landed. The marker is what refuses
      // the next save while the tree is half-merged, so removing it before
      // this point would mean a failure here left nothing standing guard.
      await merge.clearPendingMarker();
    }

    /** Replaces the repository wholesale, so nothing about the old one survives. */
    async clone(url: string, token: string, onProgress?: ProgressFn): Promise<void> {
      this._pendingMerge = null;
      // Clear existing repo if any
      await this.deleteDir(bfs.REPO_DIR);

      await git.clone({
        fs: bfs.getFs(),
        http,
        dir: bfs.REPO_DIR,
        url,
        corsProxy: getCorsProxy(),
        singleBranch: true,
        headers: authHeaders(token),
        onAuth: () => ({ username: 'x-access-token', password: token }),
        onProgress: onProgress
          ? ({ phase, loaded, total }) => onProgress(phase, loaded, total ?? 0)
          : undefined,
      });

      this._initialized = true;
      this._repoUrl = url;
      settings.setRepoUrl(url);
    }

    async getRemoteInfo(token: string): Promise<RemoteInfo> {
      const repoUrl = settings.repoUrl();
      return git.getRemoteInfo({
        http,
        corsProxy: getCorsProxy(),
        url: repoUrl,
        headers: authHeaders(token),
        onAuth: () => ({ username: 'x-access-token', password: token }),
      }) as Promise<RemoteInfo>;
    }

    async resolveRef(ref: string): Promise<string> {
      return git.resolveRef({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref });
    }

    async writeRef(ref: string, oid: string): Promise<void> {
      await git.writeRef({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref, value: oid, force: true });
    }

  }

  return new Store();
}
