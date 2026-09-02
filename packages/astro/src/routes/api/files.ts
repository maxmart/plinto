import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { safeResolve, git, devGuard, jsonResponse, errorResponse, mimeTypeFor } from './_shared';

export const prerender = false;

interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;  // ms since epoch
  frontmatter?: Record<string, unknown>;
}

/**
 * GET /api/plinto/files?path=<p>                 → file bytes OR directory listing
 *                                                  (server checks the inode to decide)
 * GET /api/plinto/files?path=<p>&commit=<hash>   → file bytes at a specific git commit
 *
 * The path lives in a query param rather than a URL segment so the route works
 * under any trailingSlash config a consumer site might pick. Astro's router
 * doesn't care what's in query params, so /api/plinto/files/ matches uniformly.
 */
export const GET: APIRoute = async ({ request }) => {
  const guard = devGuard();
  if (guard) return guard;

  const url = new URL(request.url);
  const repoPath = url.searchParams.get('path');
  if (!repoPath) {
    return errorResponse('path query param is required', 400);
  }

  let abs: string;
  try {
    abs = safeResolve(repoPath);
  } catch (e: unknown) {
    return errorResponse((e as Error).message, 400);
  }

  const commit = url.searchParams.get('commit');
  if (commit) {
    if (!/^[0-9a-f]{4,40}$/i.test(commit) && commit !== 'HEAD') {
      return errorResponse('commit must be a hex string or HEAD', 400);
    }
    try {
      // Prefix with ./ so git interprets the path relative to the cwd it was
      // spawned in (the site root), not relative to the git repo root. This
      // matters in monorepos where the site lives in a subdirectory.
      const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
      const content = await git(['show', `${commit}:./${rel}`]);
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': mimeTypeFor(repoPath) },
      });
    } catch (e: unknown) {
      return errorResponse((e as Error).message, 404);
    }
  }

  // Stat the path to decide file vs directory. The filesystem is the source of
  // truth — no URL convention to disambiguate.
  let stat: import('node:fs').Stats;
  try {
    stat = await fs.stat(abs);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      // For directories, callers expect empty array on missing (FileStore
      // contract). For files, we return 404. But we can't know which they
      // expected. Return 404 — callers of readDir catch the 404 and treat
      // it as empty; direct file readers see it as a legitimate miss.
      return errorResponse(`Not found: ${repoPath}`, 404);
    }
    return errorResponse(err.message || 'Failed to stat', 500);
  }

  if (stat.isDirectory()) {
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(abs, { withFileTypes: true });
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      return errorResponse(err.message || 'Failed to read directory', 500);
    }
    const entries: DirEntry[] = [];
    for (const d of dirents) {
      try {
        const childAbs = path.join(abs, d.name);
        const childStat = await fs.stat(childAbs);
        const entry: DirEntry = {
          name: d.name,
          type: d.isDirectory() ? 'directory' : 'file',
          size: childStat.size,
          mtime: childStat.mtimeMs,
        };
        if (!d.isDirectory() && d.name.endsWith('.mdx')) {
          try {
            const raw = await fs.readFile(childAbs, 'utf8');
            entry.frontmatter = matter(raw).data as Record<string, unknown>;
          } catch {
            // frontmatter stays undefined — caller falls back to readFile
          }
        }
        entries.push(entry);
      } catch {
        // Skip entries we can't stat
      }
    }
    return jsonResponse({ entries });
  }

  // Regular file — return bytes with Content-Type from extension.
  try {
    const data = await fs.readFile(abs);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: { 'Content-Type': mimeTypeFor(repoPath) },
    });
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    return errorResponse(err.message || 'Failed to read file', 500);
  }
};

/**
 * POST /api/plinto/files
 * Body: { paths: string[] }
 * Returns: { results: Record<string, Record<string, unknown> | null> }
 * Reads and parses frontmatter for multiple files in one request.
 * Each path maps to parsed frontmatter data, or null if the file is missing.
 */
export const POST: APIRoute = async ({ request }) => {
  const guard = devGuard();
  if (guard) return guard;

  let paths: unknown;
  try {
    const body = await request.json() as { paths?: unknown };
    paths = body.paths;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string')) {
    return errorResponse('body.paths must be an array of strings', 400);
  }

  const results: Record<string, Record<string, unknown> | null> = {};
  await Promise.all(
    (paths as string[]).map(async (repoPath) => {
      let abs: string;
      try {
        abs = safeResolve(repoPath);
      } catch {
        results[repoPath] = null;
        return;
      }
      try {
        const raw = await fs.readFile(abs, 'utf8');
        results[repoPath] = matter(raw).data as Record<string, unknown>;
      } catch {
        results[repoPath] = null;
      }
    })
  );

  return jsonResponse({ results });
};

/**
 * PUT /api/plinto/files?path=<p>
 * Body: raw bytes. Content-Type of the request is recorded but not validated;
 * the server is a dumb pipe. Parent directories are created as needed.
 */
export const PUT: APIRoute = async ({ request }) => {
  const guard = devGuard();
  if (guard) return guard;

  const url = new URL(request.url);
  const repoPath = url.searchParams.get('path');
  if (!repoPath) {
    return errorResponse('path query param is required', 400);
  }

  let abs: string;
  try {
    abs = safeResolve(repoPath);
  } catch (e: unknown) {
    return errorResponse((e as Error).message, 400);
  }

  try {
    const arrayBuf = await request.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Mark this as an editor save BEFORE the write lands, so the watcher's
    // hot-update (see plinto:suppress-editor-save-reload in integration.ts)
    // finds the mark no matter how fast it fires. Keyed with forward slashes
    // because that is how Vite reports paths, also on Windows.
    const g = globalThis as { __plintoEditorWrites?: Map<string, number> };
    (g.__plintoEditorWrites ??= new Map()).set(abs.replace(/\\/g, '/'), Date.now());
    await fs.writeFile(abs, bytes);
    return jsonResponse({ ok: true });
  } catch (e: unknown) {
    return errorResponse((e as Error).message, 500);
  }
};

/**
 * DELETE /api/plinto/files?path=<p>
 */
export const DELETE: APIRoute = async ({ request }) => {
  const guard = devGuard();
  if (guard) return guard;

  const url = new URL(request.url);
  const repoPath = url.searchParams.get('path');
  if (!repoPath) {
    return errorResponse('path query param is required', 400);
  }

  let abs: string;
  try {
    abs = safeResolve(repoPath);
  } catch (e: unknown) {
    return errorResponse((e as Error).message, 400);
  }

  try {
    await fs.unlink(abs);
    return new Response(null, { status: 204 });
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return errorResponse(`File not found: ${repoPath}`, 404);
    }
    return errorResponse(err.message || 'Failed to delete file', 500);
  }
};
