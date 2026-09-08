/**
 * HttpGitStore - Dev mode git operations via API routes.
 * Only local operations work. Remote operations throw — use your terminal.
 */

import type { GitStore, CommitInfo, MergeResult, RemoteInfo, ProgressFn } from './types';

const DEV_MODE_ERROR = 'Not available in dev mode — use your terminal.';

export class HttpGitStore implements GitStore {
  async commitFiles(message: string, files: string[]): Promise<void> {
    const response = await fetch('/api/plinto/git/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'commitFiles', message, files }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to commit files');
    }
  }

  async getHeadHash(): Promise<string> {
    const response = await fetch('/api/plinto/git/?action=headHash');
    if (!response.ok) throw new Error('Failed to get HEAD hash');
    const data = await response.json();
    return data.hash;
  }

  async getLog(limit: number): Promise<CommitInfo[]> {
    const params = new URLSearchParams({ action: 'log', limit: String(limit) });
    const response = await fetch(`/api/plinto/git/?${params}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.commits || [];
  }

  async readBlobAtCommit(repoPath: string, hash: string): Promise<string> {
    const params = new URLSearchParams({ path: repoPath, commit: hash });
    const response = await fetch(`/api/plinto/files/?${params.toString()}`);
    if (!response.ok) throw new Error(`Failed to read ${repoPath} at ${hash}: ${response.status}`);
    return await response.text();
  }

  async getParentCommit(hash: string): Promise<string | null> {
    const response = await fetch(`/api/plinto/git/?action=parentCommit&hash=${encodeURIComponent(hash)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.parent ?? null;
  }

  async getRemoteUrl(): Promise<string | null> {
    const response = await fetch('/api/plinto/git/?action=remoteUrl');
    if (!response.ok) return null;
    const data = await response.json();
    return data.url ?? null;
  }

  async checkout(_ref: string): Promise<void> { throw new Error(DEV_MODE_ERROR); }

  // ── Remote operations: throw in dev mode ───────────────────
  async fetch(_token: string): Promise<void> { throw new Error(DEV_MODE_ERROR); }
  async push(_token: string): Promise<string> { throw new Error(DEV_MODE_ERROR); }
  async merge(_remoteOid: string, _needsResolution: (path: string) => boolean): Promise<MergeResult> { throw new Error(DEV_MODE_ERROR); }
  async completeMerge(_resolvedFiles: Map<string, string>): Promise<void> { throw new Error(DEV_MODE_ERROR); }
  /** No-op rather than a throw: merge() cannot succeed here, so there is
   *  never a merge to abort, and a cleanup path that throws would mask the
   *  failure it was called to clean up after. */
  async abortMerge(): Promise<void> {}
  /** Dev mode commits with the user's own git; there is no merge of ours. */
  async hasPendingMerge(): Promise<boolean> { return false; }
  async resetToRemote(): Promise<void> { throw new Error(DEV_MODE_ERROR); }
  async clone(_url: string, _token: string, _onProgress?: ProgressFn): Promise<void> { throw new Error(DEV_MODE_ERROR); }
  async getRemoteInfo(_token: string): Promise<RemoteInfo> { throw new Error(DEV_MODE_ERROR); }
  async resolveRef(_ref: string): Promise<string> { throw new Error(DEV_MODE_ERROR); }
  async writeRef(_ref: string, _oid: string): Promise<void> { throw new Error(DEV_MODE_ERROR); }
}
