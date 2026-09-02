/**
 * Shared helpers for the dev-mode API routes.
 *
 * These routes only exist during `astro dev` (output: server). In production
 * builds (output: static) they're not bundled at all, but each route also
 * checks devGuard() defensively.
 *
 * All paths from the client are validated against process.cwd() (the site
 * root, e.g. examples/playground) to prevent directory traversal.
 *
 * Git operations shell out to native git via execFile (NOT exec — execFile
 * skips the shell and is immune to injection via filenames).
 */

import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import mime from 'mime-types';
import { config } from '../../lib/site-config';

const execFile = promisify(execFileCb);

/**
 * The outermost directory client paths may reach. Normally the site root
 * (process.cwd()), but in a monorepo layout (siteSubdir set) paths may climb
 * with '../' to shared content at the repo root — so the boundary is the repo
 * root, computed by stripping siteSubdir off the cwd.
 */
function pathBoundary(): string {
  const subdir = (config.content.siteSubdir ?? '').replace(/^\/+|\/+$/g, '');
  if (!subdir) return process.cwd();
  const climb = subdir.split('/').map(() => '..').join(path.sep);
  return path.resolve(process.cwd(), climb);
}

/**
 * Validate a client-supplied relative path and resolve it against the site
 * root (process.cwd()). Throws if the path is empty, absolute, or escapes the
 * boundary (the repo root in a monorepo, the site root otherwise) after
 * normalization.
 */
export function safeResolve(rel: unknown): string {
  if (!rel || typeof rel !== 'string') {
    throw new Error('Invalid path: must be a non-empty string');
  }
  if (rel.startsWith('/') || rel.startsWith('\\')) {
    throw new Error('Absolute paths not allowed');
  }
  const resolved = path.resolve(process.cwd(), rel);
  const boundary = pathBoundary();
  if (resolved !== boundary && !resolved.startsWith(boundary + path.sep)) {
    throw new Error('Path escapes root');
  }
  return resolved;
}

/**
 * Run a git command in the site root and return stdout. Throws with stderr
 * on non-zero exit. Args are passed as an array to execFile to avoid shell
 * interpretation.
 */
export async function git(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFile('git', args, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
    });
    return stdout;
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(e.stderr?.trim() || e.message || 'git failed');
  }
}

/**
 * Returns a 404 response if not in dev mode. Routes should bail early:
 *
 *   const guard = devGuard();
 *   if (guard) return guard;
 */
export function devGuard(): Response | null {
  if (!import.meta.env.DEV) {
    return new Response('Not Found', { status: 404 });
  }
  return null;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Look up the MIME type for a file path. Falls back to application/octet-stream
 * for unknown extensions.
 */
export function mimeTypeFor(filePath: string): string {
  return mime.lookup(filePath) || 'application/octet-stream';
}
