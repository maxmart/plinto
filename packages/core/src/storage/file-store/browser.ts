/**
 * BrowserFileStore - File I/O using lightning-fs (IndexedDB-backed).
 * Used in production/browser mode. No git operations.
 */

import matter from 'gray-matter';
import { FileStore, DirEntry, FileNotFoundError } from './types';
import { lookupMime } from './mime';
import type { BrowserFs } from '../browser-fs';

export class BrowserFileStore implements FileStore {
  /**
   * mediaDir is something like 'public/media' (relative to the site root).
   * The first segment ('public') normalises client-supplied media paths like
   * "media/foo.png" back to "public/media/foo.png" for lightning-fs lookups.
   */
  private readonly mediaPublicPrefix: string;

  constructor(private readonly bfs: BrowserFs, mediaDir: string) {
    this.mediaPublicPrefix = mediaDir.split('/')[0] ?? 'public';
  }

  // Cache key is the repo-relative path (e.g. "public/media/foo.png").
  // Value is the blob: URL for that file's current bytes.
  private _mediaBlobUrls = new Map<string, string>();

  private get pfs() {
    return this.bfs.getFs().promises;
  }

  async readFile(repoPath: string): Promise<string> {
    let data: Uint8Array | string;
    try {
      data = await this.pfs.readFile(this.bfs.fsPath(repoPath));
    } catch (err) {
      // Only a genuine ENOENT is "missing"; everything else — a mutex
      // timeout, an aborted transaction — is a failure to read and stays one.
      if ((err as { code?: string })?.code === 'ENOENT') throw new FileNotFoundError(repoPath);
      throw err;
    }
    // lightning-fs returns Uint8Array when no encoding is given
    return data instanceof Uint8Array ? new TextDecoder().decode(data) : data as string;
  }

  async writeFile(repoPath: string, body: string | Uint8Array): Promise<void> {
    const fullPath = this.bfs.fsPath(repoPath);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await this.bfs.mkdirp(parentDir);

    if (typeof body === 'string') {
      await this.pfs.writeFile(fullPath, body, 'utf8');
    } else {
      await this.pfs.writeFile(fullPath, body);
    }

    // Invalidate the blob-URL cache if this write replaces a media file —
    // the next getMediaUrl call will read fresh bytes and create a new blob.
    if (this._mediaBlobUrls.has(repoPath)) {
      URL.revokeObjectURL(this._mediaBlobUrls.get(repoPath)!);
      this._mediaBlobUrls.delete(repoPath);
    }
  }

  async readDir(repoPath: string): Promise<DirEntry[]> {
    const fullPath = this.bfs.fsPath(repoPath);
    let names: string[];
    try {
      names = (await this.pfs.readdir(fullPath)) as string[];
    } catch {
      return [];
    }
    const entries: DirEntry[] = [];
    for (const name of names) {
      try {
        const childPath = `${fullPath}/${name}`;
        const stat = await this.pfs.stat(childPath);
        const entry: DirEntry = {
          name,
          type: stat.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          mtime: stat.mtimeMs,
        };
        if (!stat.isDirectory() && name.endsWith('.mdx')) {
          try {
            const data = await this.pfs.readFile(childPath);
            const text = data instanceof Uint8Array
              ? new TextDecoder().decode(data)
              : data as string;
            entry.frontmatter = matter(text).data as Record<string, unknown>;
          } catch {
            // frontmatter stays undefined — caller falls back to readFile
          }
        }
        entries.push(entry);
      } catch {
        // Skip entries we can't stat
      }
    }
    return entries;
  }

  async readManyFrontmatter(paths: string[]): Promise<Record<string, Record<string, unknown> | null>> {
    const entries = await Promise.all(
      paths.map(async (repoPath) => {
        try {
          const data = await this.pfs.readFile(this.bfs.fsPath(repoPath));
          const text = data instanceof Uint8Array
            ? new TextDecoder().decode(data)
            : data as string;
          return [repoPath, matter(text).data as Record<string, unknown>] as const;
        } catch {
          return [repoPath, null] as const;
        }
      })
    );
    return Object.fromEntries(entries);
  }

  async deleteFile(repoPath: string): Promise<void> {
    const fullPath = this.bfs.fsPath(repoPath);
    await this.pfs.unlink(fullPath);

    // Revoke and drop any cached blob URL for this path
    if (this._mediaBlobUrls.has(repoPath)) {
      URL.revokeObjectURL(this._mediaBlobUrls.get(repoPath)!);
      this._mediaBlobUrls.delete(repoPath);
    }
  }

  async getMediaUrl(path: string): Promise<string> {
    // path is something like "media/foo.png" or "/media/foo.png" — normalise to
    // a repo-relative path under public/ ("public/media/foo.png").
    const stripped = path.startsWith('/') ? path.slice(1) : path;
    const repoRelative = stripped.startsWith(`${this.mediaPublicPrefix}/`)
      ? stripped
      : `${this.mediaPublicPrefix}/${stripped}`;

    if (this._mediaBlobUrls.has(repoRelative)) {
      return this._mediaBlobUrls.get(repoRelative)!;
    }

    try {
      const fullPath = this.bfs.fsPath(repoRelative);
      const data = await this.pfs.readFile(fullPath);
      const bytes = data instanceof Uint8Array
        ? data
        : new TextEncoder().encode(data as string);
      const mimeType = lookupMime(repoRelative);
      const blob = new Blob(
        [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
        { type: mimeType },
      );
      const url = URL.createObjectURL(blob);
      this._mediaBlobUrls.set(repoRelative, url);
      return url;
    } catch {
      // File not found — return original path as fallback (browser will 404)
      return path;
    }
  }
}
