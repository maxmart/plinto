import type { APIRoute } from 'astro';
import { safeResolve, git, devGuard, jsonResponse, errorResponse } from './_shared';

export const prerender = false;

interface FileChange {
  path: string;
  type: 'added' | 'modified' | 'deleted';
}

interface CommitInfo {
  hash: string;
  message: string;
  files: FileChange[];
}

const FIELD = '\x1f';
const RECORD = '\x1e';

/**
 * GET /api/plinto/git?action=<action>
 *
 * Actions:
 *   headHash       — current HEAD oid
 *   log            — recent commits with their file changes (params: limit)
 *   parentCommit   — first parent of a commit (params: hash)
 *   remoteUrl      — URL of the 'origin' remote, or null if not configured
 */
export const GET: APIRoute = async ({ url }) => {
  const guard = devGuard();
  if (guard) return guard;

  const action = url.searchParams.get('action');

  try {
    switch (action) {
      case 'headHash': {
        const out = await git(['rev-parse', 'HEAD']);
        return jsonResponse({ hash: out.trim() });
      }

      case 'log': {
        const limit = parseInt(url.searchParams.get('limit') || '0', 10);
        if (!limit || limit < 1) {
          return errorResponse('limit must be a positive integer', 400);
        }

        // One invocation for the whole log: --name-status prints each
        // commit's file changes under its header, so no `git show` per
        // commit. Each record starts with RECORD, fields split on FIELD.
        const out = await git(['log', `-${limit}`, '--name-status', '--format=%x1e%H%x1f%s%x1f', 'HEAD']);

        const commits: CommitInfo[] = [];
        for (const chunk of out.split(RECORD)) {
          if (!chunk.trim()) continue;
          const [hash, message, body = ''] = chunk.split(FIELD);
          if (!hash || message === undefined) continue;
          const files: FileChange[] = [];
          for (const line of body.split('\n')) {
            const trimmed = line.trim();
            const tabIdx = trimmed.indexOf('\t');
            if (tabIdx === -1) continue;
            const code = trimmed[0];
            const rest = trimmed.substring(tabIdx + 1);
            // R (rename) and C (copy) lines carry "old\tnew" — keep the new path.
            const path = rest.includes('\t') ? rest.slice(rest.lastIndexOf('\t') + 1) : rest;
            const type: FileChange['type'] = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
            files.push({ path, type });
          }
          commits.push({ hash: hash.trim(), message, files });
        }

        return jsonResponse({ commits });
      }

      case 'remoteUrl': {
        // `git config --get remote.origin.url` exits non-zero if the key is
        // unset; we want null rather than a 500 in that case.
        try {
          const out = await git(['config', '--get', 'remote.origin.url']);
          const trimmed = out.trim();
          return jsonResponse({ url: trimmed || null });
        } catch {
          return jsonResponse({ url: null });
        }
      }

      case 'parentCommit': {
        const hash = url.searchParams.get('hash');
        if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) {
          return errorResponse('hash must be a hex string', 400);
        }
        try {
          const out = await git(['rev-parse', `${hash}^`]);
          return jsonResponse({ parent: out.trim() });
        } catch {
          // Initial commit has no parent
          return jsonResponse({ parent: null });
        }
      }

      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (e: unknown) {
    return errorResponse((e as Error).message, 500);
  }
};

/**
 * POST /api/plinto/git
 * Body: {action: 'commitFiles', message: string, files: string[]}
 */
export const POST: APIRoute = async ({ request }) => {
  const guard = devGuard();
  if (guard) return guard;

  let body: { action?: string; message?: string; files?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (body.action !== 'commitFiles') {
    return errorResponse(`Unknown action: ${body.action}`, 400);
  }

  const { message, files } = body;
  if (typeof message !== 'string' || !message.trim()) {
    return errorResponse('message is required', 400);
  }
  if (!Array.isArray(files) || files.length === 0) {
    return errorResponse('files must be a non-empty array', 400);
  }

  // Validate every path. They MUST stay relative — git is invoked from
  // process.cwd() and we want it to receive relative paths so they map to
  // the working tree positions.
  const relFiles: string[] = [];
  for (const f of files) {
    try {
      safeResolve(f); // throws on bad input
      relFiles.push(f);
    } catch (e: unknown) {
      return errorResponse(`Invalid file path "${f}": ${(e as Error).message}`, 400);
    }
  }

  try {
    await git(['add', '--', ...relFiles]);
    // A byte-identical save is a legitimate no-op, not an error — checked
    // deterministically before committing (`git commit` reports "nothing to
    // commit" on stdout and exits 1, which reads as a generic failure here).
    const staged = await git(['diff', '--cached', '--name-only', '--', ...relFiles]);
    if (!staged.trim()) {
      return jsonResponse({ ok: true, noop: true });
    }
    // Scoped to the given paths so a commit never sweeps up whatever else the
    // developer happens to have staged in the working repo.
    await git(['commit', '-m', message, '--', ...relFiles]);
    return jsonResponse({ ok: true });
  } catch (e: unknown) {
    return errorResponse((e as Error).message, 500);
  }
};
