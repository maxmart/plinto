/**
 * Repository-level operations: the pull/push orchestration the admin's
 * Publish button drives, plus repo status queries. Browser mode only for the
 * remote half — dev mode uses the developer's own terminal.
 */

import type { Stores } from '../storage';
import { isAncestor, countAncestry } from '../storage/git-store/ancestry';
import type { CommitInfo, ProgressFn, ConflictFile } from '../storage/git-store/types';
import type { Settings } from '../settings';
import type { ResolvedConfig } from '../resolved-config';
import { batchUpload, uploadBlob } from '../lfs/batch';
import type { createMediaOps } from './media';
import { OpsError, translateError } from './errors';

export type { ProgressFn } from '../storage/git-store/types';

export interface RepoInfo {
  initialized: boolean;
  repoUrl: string | undefined;
  branch: string | undefined;
  /** A publish was interrupted part-way through a merge. Saves are refused
   *  until it is finished or discarded. */
  mergePending: boolean;
}

export interface SyncState {
  commitsAhead: number;
  commitsBehind: number;
}

export type PullStatus = 'up_to_date' | 'fast_forward' | 'merged';

export interface OpsPullResult {
  status: PullStatus;
  mergedFiles?: string[];
}

/**
 * Human-readable progress line for the long-running git orchestrations.
 * Optional everywhere: callers that don't render progress pass nothing.
 */
export type OnOpsProgress = (message: string) => void;

/**
 * How a caller resolves the conflicts a merge could not settle by itself.
 *
 * A parameter, not something ops reaches for: what a conflict *means* is the
 * CMS's business, and resolving one with Claude is the agent layer's — which
 * sits above this one. See lib/agents/conflict.
 */
export type OnConflict = (
  conflicts: ConflictFile[]
) => Promise<{ path: string; content: string }[]>;

export interface RepoOpsDeps {
  config: ResolvedConfig;
  stores: Stores;
  settings: Settings;
  /** Push uploads the pending LFS blobs first, so it needs the media store. */
  media: ReturnType<typeof createMediaOps>;
}

/** The repository operations, bound to one site's configuration and storage. */
export function createRepoOps({ config, stores, settings, media }: RepoOpsDeps) {

  // ── Status queries ────────────────────────────────────────

  async function getRepoInfo(): Promise<RepoInfo> {
    try {
      const gitStore = await stores.getGitStore();
      await gitStore.getHeadHash(); // throws if not initialized
      // Dev mode: reads `git config --get remote.origin.url` from the real
      // local checkout. Browser mode: returns the cached clone URL the store
      // loaded from lightning-fs config (or localStorage backup) at init.
      const repoUrl = (await gitStore.getRemoteUrl()) ?? undefined;
      // Reported rather than waited for. A repository left mid-merge refuses
      // every save, but nothing in the admin's own start-up fails: the pull
      // that would surface it short-circuits to up_to_date, because the fetch
      // it needs already happened. So the admin asked, was told nothing was
      // wrong, and only found out when a save the user had already typed was
      // rejected — with the one action that helps sitting on a screen the
      // error never brought them to.
      const mergePending = await gitStore.hasPendingMerge();
      return { initialized: true, repoUrl, branch: config.git.defaultBranch, mergePending };
    } catch {
      return { initialized: false, repoUrl: undefined, branch: undefined, mergePending: false };
    }
  }

  async function getSyncState(): Promise<SyncState> {
    try {
      const gitStore = await stores.getGitStore();
      const localOid = await gitStore.getHeadHash();
      let remoteOid: string;
      try { remoteOid = await gitStore.resolveRef(`refs/remotes/origin/${config.git.defaultBranch}`); } catch { return { commitsAhead: 0, commitsBehind: 0 }; }

      if (localOid === remoteOid) return { commitsAhead: 0, commitsBehind: 0 };

      // Check if remote is ancestor of local (we're ahead)
      const ahead = await countAncestry(gitStore, remoteOid, localOid);
      if (ahead !== null) return { commitsAhead: ahead, commitsBehind: 0 };

      // Check if local is ancestor of remote (we're behind)
      const behind = await countAncestry(gitStore, localOid, remoteOid);
      if (behind !== null) return { commitsAhead: 0, commitsBehind: behind };

      // Diverged
      return { commitsAhead: 1, commitsBehind: 1 };
    } catch {
      return { commitsAhead: 0, commitsBehind: 0 };
    }
  }

  async function getCommitLog(limit: number): Promise<CommitInfo[]> {
    const gitStore = await stores.getGitStore();
    return gitStore.getLog(limit);
  }

  // ── Pull orchestration ────────────────────────────────────

  async function pull(
    token: string,
    onConflict: OnConflict,
    onProgress?: OnOpsProgress
  ): Promise<OpsPullResult> {
    try {
      const gitStore = await stores.getGitStore();

      // 1. Lightweight check: has remote changed since last fetch?
      onProgress?.('Checking for remote changes…');
      let knownRemoteOid: string | undefined;
      try { knownRemoteOid = await gitStore.resolveRef(`refs/remotes/origin/${config.git.defaultBranch}`); } catch { /* no remote ref */ }

      try {
        const remoteInfo = await gitStore.getRemoteInfo(token);
        const remoteHead = remoteInfo.refs?.heads?.[config.git.defaultBranch];
        if (remoteHead && remoteHead === knownRemoteOid) {
          return { status: 'up_to_date' };
        }
      } catch { /* ls-remote failed, fall through to fetch */ }

      // 2. Fetch
      onProgress?.('Downloading remote changes…');
      await gitStore.fetch(token);

      // 3. Compare local vs remote
      const localOid = await gitStore.getHeadHash();
      let remoteOid: string;
      try { remoteOid = await gitStore.resolveRef(`refs/remotes/origin/${config.git.defaultBranch}`); } catch { return { status: 'up_to_date' }; }

      if (localOid === remoteOid) {
        return { status: 'up_to_date' };
      }

      // 4. Check ancestry
      if (await isAncestor(gitStore, remoteOid, localOid)) {
        // Remote is ancestor of local — we're ahead, nothing to pull
        return { status: 'up_to_date' };
      }

      if (await isAncestor(gitStore, localOid, remoteOid)) {
        // Fast-forward: local is ancestor of remote
        onProgress?.('Applying remote changes…');
        await gitStore.writeRef(`refs/heads/${config.git.defaultBranch}`, remoteOid);
        await gitStore.checkout(config.git.defaultBranch);
        return { status: 'fast_forward' };
      }

      // 5. Diverged — merge. Only MDX documents are worth a Claude-assisted
      // resolution; anything else (media, config) takes the remote's version.
      onProgress?.('Merging remote changes…');
      const result = await gitStore.merge(remoteOid, path => path.endsWith('.mdx'));

      if (result.conflicts.length > 0) {
        // From here until completeMerge returns, the repository is mid-merge:
        // the auto-merged files are staged and nothing is committed. Every way
        // out of that window has to put it back, or the next ordinary save
        // sweeps the remote's changes into a single-parent commit — git then no
        // longer knows the remote was merged, and every push afterwards is
        // rejected as non-fast-forward with nothing explaining why.
        //
        // The ways out are more than the obvious one. Resolution can throw (no
        // API key, Claude failing, the editor closing on a question); the
        // progress callback belongs to the caller and can throw; a caller could
        // return something that is not a list; and completeMerge itself can
        // fail. A finally covers them all, and does nothing on the way out of
        // a merge that committed.
        let committed = false;
        try {
          onProgress?.(
            `Resolving ${result.conflicts.length} conflicted file${result.conflicts.length === 1 ? '' : 's'} with Claude…`
          );
          const resolved = await onConflict(result.conflicts);
          await gitStore.completeMerge(new Map(resolved.map(r => [r.path, r.content])));
          committed = true;
        } finally {
          // Best effort: what the user needs to see is the failure itself, so a
          // rollback that also fails must not replace it.
          if (!committed) await gitStore.abortMerge().catch(() => {});
        }
      }

      return {
        status: 'merged',
        mergedFiles: result.mergedFiles,
      };
    } catch (err) {
      if (err instanceof OpsError) throw err;
      throw translateError(err);
    }
  }

  // ── Push orchestration (pull + push, auto-retry) ─────────

  async function push(
    token: string,
    onConflict: OnConflict,
    onProgress?: OnOpsProgress
  ): Promise<string> {
    try {
      const gitStore = await stores.getGitStore();

      // Upload pending LFS blobs before pushing
      const db = media.getLfsDb();
      const pending = await db.listPending();
      if (pending.length > 0) {
        onProgress?.(`Uploading ${pending.length} media file${pending.length === 1 ? '' : 's'}…`);
        const repoUrl = settings.repoUrl();
        const proxyUrl = settings.proxyUrl() || config.git.corsProxy;

        const uploadResults = await batchUpload(
          proxyUrl, repoUrl, pending, token
        );
        await Promise.all(uploadResults.map(async ({ oid, uploadUrl }) => {
          const blob = await db.getPending(oid);
          if (blob) await uploadBlob(uploadUrl, proxyUrl, blob);
        }));
      }

      // Push with retry on rejection
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) onProgress?.('Remote changed while publishing — retrying…');
        await pull(token, onConflict, onProgress);

        try {
          onProgress?.('Uploading changes…');
          const pushedOid = await gitStore.push(token);
          // Clear pending after successful push
          await db.clearPending();
          return pushedOid;
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if ((msg.includes('rejected') || msg.includes('non-fast-forward')) && attempt < 2) {
            continue;
          }
          throw err;
        }
      }

      throw new Error('Push rejected after 3 attempts');
    } catch (err) {
      if (err instanceof OpsError) throw err;
      throw translateError(err);
    }
  }

  // ── Discard and init ──────────────────────────────────────

  async function discard(): Promise<void> {
    try {
      const gitStore = await stores.getGitStore();
      await gitStore.resetToRemote();
    } catch (err) {
      if (err instanceof OpsError) throw err;
      throw translateError(err);
    }
  }

  async function initRepo(
    url: string,
    token: string,
    onProgress?: ProgressFn
  ): Promise<void> {
    try {
      const gitStore = await stores.getGitStore();
      await gitStore.clone(url, token, onProgress);
    } catch (err) {
      // No cleanup: clone() itself deletes any partial repo dir before it
      // starts, so a retry begins from a clean slate either way.
      if (err instanceof OpsError) throw err;
      throw translateError(err);
    }
  }

  return {
    getRepoInfo,
    getSyncState,
    getCommitLog,
    pull,
    push,
    discard,
    initRepo,
  };
}
