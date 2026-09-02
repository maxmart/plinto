/**
 * A BrowserFs over node's real filesystem, for the git-store tests.
 *
 * The stores take their filesystem as an argument, so pointing them at a temp
 * directory is a call rather than a module mock — the objects, refs, index and
 * working tree are real, and what the tests assert about parents and trees is
 * what git would say.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserFs } from '../storage/browser-fs';

/**
 * `repoDir` is a getter because each test gets a fresh temp directory in
 * beforeEach, after this object is built.
 */
export function nodeBrowserFs(repoDir: () => string): BrowserFs {
  return {
    get REPO_DIR() { return repoDir(); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getFs: () => fs as any,
    toRepoPath: p => p,
    toSitePath: p => p,
    fsPath: p => path.join(repoDir(), p),
    mkdirp: async dir => { await fs.promises.mkdir(dir, { recursive: true }); },
    writeRepoFile: async (repoPath, data) => {
      const full = path.join(repoDir(), repoPath);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, data as never);
    },
    ensureHealthy: async () => {},
  };
}
