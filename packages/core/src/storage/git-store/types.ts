// Pure git primitives — no business logic, no CMS concepts

export type ProgressFn = (phase: string, loaded: number, total: number) => void;

export interface ConflictFile {
  path: string;
  ours: string;    // our content (local)
  theirs: string;  // their content (remote)
}

export interface FileChange {
  path: string;
  type: 'added' | 'modified' | 'deleted';
}

export interface CommitInfo {
  hash: string;
  message: string;
  files: FileChange[];
}

export interface MergeResult {
  mergedFiles: string[];    // auto-resolved files
  conflicts: ConflictFile[]; // unresolved conflicts needing caller resolution
}

export interface RemoteInfo {
  refs?: { heads?: Record<string, string> };
}

export interface GitStore {
  // ── Local operations (both modes) ──────────────────────────
  commitFiles(message: string, files: string[]): Promise<void>;
  getHeadHash(): Promise<string>;
  getLog(limit: number): Promise<CommitInfo[]>;
  readBlobAtCommit(repoPath: string, hash: string): Promise<string>;
  getParentCommit(hash: string): Promise<string | null>;

  /**
   * Return the configured URL of the "origin" remote, or null if no remote
   * is configured. Implemented by reading `git config --get remote.origin.url`
   * in dev mode and by reading the cached clone URL in browser mode.
   */
  getRemoteUrl(): Promise<string | null>;

  checkout(ref: string): Promise<void>;

  // ── Remote operations (browser only, throw in dev) ─────────
  // `token` is a GitHub PAT; the username half of the basic auth is always
  // the literal 'x-access-token'.
  fetch(token: string): Promise<void>;
  push(token: string): Promise<string>; // returns pushed OID
  /**
   * Merge the remote commit into the working tree. `needsResolution` is the
   * caller's policy for which both-sides-changed files come back as
   * conflicts; all others take the remote's version.
   */
  merge(remoteOid: string, needsResolution: (path: string) => boolean): Promise<MergeResult>;
  completeMerge(resolvedFiles: Map<string, string>): Promise<void>;
  /** Give up on a pending merge and restore the repository. A no-op when no
   *  merge is pending. */
  abortMerge(): Promise<void>;
  /** Whether the repository is part-way through a merge that was never finished. */
  hasPendingMerge(): Promise<boolean>;
  resetToRemote(): Promise<void>;
  clone(url: string, token: string, onProgress?: ProgressFn): Promise<void>;
  getRemoteInfo(token: string): Promise<RemoteInfo>;
  resolveRef(ref: string): Promise<string>;
  writeRef(ref: string, oid: string): Promise<void>;
}
