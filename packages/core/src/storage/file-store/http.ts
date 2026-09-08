import { FileStore, DirEntry, FileNotFoundError } from './types';

const API_BASE = '/api/plinto/files/';

function buildUrl(repoPath: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ path: repoPath, ...extra });
  return `${API_BASE}?${params.toString()}`;
}

export class HttpFileStore implements FileStore {
  async readFile(repoPath: string): Promise<string> {
    const response = await fetch(buildUrl(repoPath));
    if (response.status === 404) throw new FileNotFoundError(repoPath);
    if (!response.ok) {
      throw new Error(`Failed to read ${repoPath}: ${response.status}`);
    }
    return response.text();
  }

  async writeFile(repoPath: string, body: string | Uint8Array): Promise<void> {
    const payload: BodyInit = typeof body === 'string'
      ? body
      // Slice to a fresh ArrayBuffer to avoid passing a SharedArrayBuffer
      // or a sub-view that fetch might not accept on every runtime.
      : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    const response = await fetch(buildUrl(repoPath), {
      method: 'PUT',
      headers: { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/octet-stream' },
      body: payload,
    });
    if (!response.ok) {
      throw new Error(`Failed to write ${repoPath}: ${response.status}`);
    }
  }

  async readDir(repoPath: string): Promise<DirEntry[]> {
    const response = await fetch(buildUrl(repoPath));
    if (!response.ok) {
      // Per FileStore contract, missing directories return empty (don't throw)
      if (response.status === 404) return [];
      throw new Error(`Failed to list ${repoPath}: ${response.status}`);
    }
    const data = await response.json() as { entries: DirEntry[] };
    return data.entries;
  }

  async readManyFrontmatter(paths: string[]): Promise<Record<string, Record<string, unknown> | null>> {
    if (paths.length === 0) return {};
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
    if (!response.ok) {
      throw new Error(`Failed to read frontmatter batch: ${response.status}`);
    }
    const data = await response.json() as { results: Record<string, Record<string, unknown> | null> };
    return data.results;
  }

  async deleteFile(repoPath: string): Promise<void> {
    const response = await fetch(buildUrl(repoPath), {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete ${repoPath}: ${response.status}`);
    }
  }

  async getMediaUrl(path: string): Promise<string> {
    // Dev mode: media files are served by Astro from public/ at the root.
    // path is like "media/foo.png" (without leading /); the public URL is "/media/foo.png".
    return path.startsWith('/') ? path : `/${path}`;
  }
}
