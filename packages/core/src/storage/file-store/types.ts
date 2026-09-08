export interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;  // ms since epoch
  /** Parsed frontmatter data — only present for .mdx files */
  frontmatter?: Record<string, unknown>;
}

/**
 * The file is not there — as distinct from "the file could not be read".
 *
 * Both stores throw this so callers can tell the two apart without matching
 * on a message or an errno. It matters because "missing" is often benign
 * ("this page has no Norwegian version yet") while a read that merely failed
 * — a lightning-fs mutex timeout, an aborted IndexedDB transaction — must
 * never be mistaken for it: read as "new document", it restarts a page's
 * revision history and invites the next sync to translate over the save.
 */
export class FileNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`No such file: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

export interface FileStore {
  /** Read a file as UTF-8 text. Throws FileNotFoundError if it is missing. */
  readFile(repoPath: string): Promise<string>;

  /** Write a file. Body may be a string (encoded as UTF-8) or raw bytes. */
  writeFile(repoPath: string, body: string | Uint8Array): Promise<void>;

  /**
   * List immediate children of a directory. Returns empty array for missing
   * directories — callers should not have to special-case ENOENT.
   */
  readDir(repoPath: string): Promise<DirEntry[]>;

  /**
   * Read parsed frontmatter for multiple files in one batch.
   * Returns a map of repoPath → frontmatter data (or null if the file is
   * missing or unreadable).
   */
  readManyFrontmatter(paths: string[]): Promise<Record<string, Record<string, unknown> | null>>;

  deleteFile(repoPath: string): Promise<void>;

  /**
   * Resolve a media path to a URL the browser can use as <img src>.
   * In dev mode this returns the public URL path directly. In production
   * (browser mode) this reads the bytes from lightning-fs, wraps them in
   * a Blob, and returns a blob: URL — that's why it's async.
   */
  getMediaUrl(path: string): Promise<string>;
}
