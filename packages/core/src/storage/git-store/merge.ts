/**
 * Three-way merge over lightning-fs, for the browser git store.
 *
 * isomorphic-git has no working-tree merge, so this walks the two commit
 * trees plus their merge base and applies the differences directly. Which
 * files get surfaced as conflicts (rather than taken wholesale from the
 * remote) is the CALLER's policy — the store knows git, not the CMS.
 *
 * A factory over the filesystem it works on, so nothing here has to know
 * where that filesystem came from or how the site is configured.
 */

import git from 'isomorphic-git';
import type { BrowserFs } from '../browser-fs';
import type { MergeResult, ConflictFile } from './types';
import { UserFacingError } from '../../user-error';

export interface PendingMerge {
  savedHead: string;
  branch: string;
  remoteOid: string;
  /**
   * Which store instance owns this merge. Two admin tabs share one
   * lightning-fs repository with no lock between them, so "is this merge
   * mine?" is a question that has to be answerable.
   */
  session: string;
}

/**
 * Where a pending merge is recorded on disk.
 *
 * It has to be on disk. A merge left pending has the remote's auto-merged
 * files staged and nothing committed, and resolving the rest takes a Claude
 * round-trip plus a human answering questions — tens of seconds, sometimes
 * minutes. Held only in a field on the store, a reload, a closed tab or any
 * uncaught error during that window left the repository half-merged with
 * nothing anywhere recording it.
 *
 * MERGE_HEAD is written alongside because it is git's own name for this
 * state, which makes the repository legible to any other tool that looks.
 * It is *not* a defence: isomorphic-git does not read it, and a plain
 * commit with one present still produces a single-parent commit. What
 * defends is that nothing commits while the marker is there — see
 * `commitFiles`.
 */
const MERGE_STATE_FILES = ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE', 'PLINTO_MERGE'];

interface Author {
  name: string;
  email: string;
}

/** The merge operations, bound to one browser filesystem. */
export interface Merge {
  readPendingMarker(): Promise<PendingMerge | null>;
  clearPendingMarker(): Promise<void>;
  walkTree(commitOid: string): Promise<Map<string, string>>;
  threeWayMerge(
    remoteOid: string,
    author: Author,
    needsResolution: (repoPath: string) => boolean,
    session: string,
  ): Promise<{ result: MergeResult; pending: PendingMerge | null }>;
  abortPendingMerge(pending: PendingMerge): Promise<void>;
  completePendingMerge(
    pending: PendingMerge,
    resolvedFiles: Map<string, string>,
    author: Author,
  ): Promise<void>;
}

export function createMerge(bfs: BrowserFs, defaultBranch: string): Merge {
  async function writePendingMarker(pending: PendingMerge): Promise<void> {
    const pfs = bfs.getFs().promises;
    await pfs.writeFile(`${bfs.REPO_DIR}/.git/MERGE_HEAD`, `${pending.remoteOid}\n`, 'utf8');
    await pfs.writeFile(`${bfs.REPO_DIR}/.git/PLINTO_MERGE`, JSON.stringify(pending), 'utf8');
  }

  /** The pending merge this repository was left in, if it was left in one. */
  async function readPendingMarker(): Promise<PendingMerge | null> {
    try {
      const raw: unknown = await bfs.getFs().promises.readFile(`${bfs.REPO_DIR}/.git/PLINTO_MERGE`, 'utf8');
      const text = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw);
      const parsed = JSON.parse(text) as PendingMerge;
      return parsed.savedHead && parsed.branch && parsed.remoteOid ? parsed : null;
    } catch {
      return null;
    }
  }

  async function clearPendingMarker(): Promise<void> {
    for (const f of MERGE_STATE_FILES) {
      try {
        await bfs.getFs().promises.unlink(`${bfs.REPO_DIR}/.git/${f}`);
      } catch { /* not present */ }
    }
  }

  /** Every blob in a commit's tree, as repo-relative path -> blob oid. */
  async function walkTree(commitOid: string): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const walk = async (treeOid: string, prefix: string) => {
      const { tree: entries } = await git.readTree({ fs: bfs.getFs(), dir: bfs.REPO_DIR, oid: treeOid });
      for (const entry of entries) {
        const path = prefix ? `${prefix}/${entry.path}` : entry.path;
        if (entry.type === 'blob') {
          files.set(path, entry.oid);
        } else if (entry.type === 'tree') {
          await walk(entry.oid, path);
        }
      }
    };
    await walk(commitOid, '');
    return files;
  }

  /** Stage adds/removes so the index matches the working tree. */
  async function stageWorkingTree(): Promise<void> {
    const statusMatrix = await git.statusMatrix({ fs: bfs.getFs(), dir: bfs.REPO_DIR });
    for (const [filepath, , workdir] of statusMatrix) {
      if (workdir === 0) await git.remove({ fs: bfs.getFs(), dir: bfs.REPO_DIR, filepath });
      else if (workdir === 2) await git.add({ fs: bfs.getFs(), dir: bfs.REPO_DIR, filepath });
    }
  }

  /** Restore HEAD and the working tree, and clean any merge state files. */
  async function rollback(branch: string, savedHead: string): Promise<void> {
    await git.writeRef({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref: `refs/heads/${branch}`, value: savedHead, force: true });
    try {
      await git.checkout({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref: branch, force: true });
    } catch { /* best effort */ }
    await clearPendingMarker();
  }

  /** The merge commit — BOTH parents. With the default single parent (HEAD),
   *  the remote history is never incorporated, every push stays
   *  non-fast-forward, and publishing dead-ends for the user. */
  async function commitMerge(author: Author, localOid: string, remoteOid: string): Promise<void> {
    await git.commit({
      fs: bfs.getFs(),
      dir: bfs.REPO_DIR,
      message: `Merge remote-tracking branch 'origin/${defaultBranch}'`,
      author,
      parent: [localOid, remoteOid],
    });
  }

  /**
   * Merge the remote commit into the working tree.
   *
   * `needsResolution` decides which both-sides-changed files come back as
   * conflicts for the caller to resolve; every other such file takes the
   * remote's version. With conflicts, the merge is left pending (auto-resolved
   * files staged, nothing committed) and the returned PendingMerge must go to
   * completeMerge(); without, the merge commit is made here.
   */
  async function threeWayMerge(
    remoteOid: string,
    author: Author,
    needsResolution: (repoPath: string) => boolean,
    session: string,
  ): Promise<{ result: MergeResult; pending: PendingMerge | null }> {
    const pfs = bfs.getFs().promises;
    const localOid = await git.resolveRef({ fs: bfs.getFs(), dir: bfs.REPO_DIR, ref: 'HEAD' });
    const savedHead = localOid;
    const branch = await git.currentBranch({ fs: bfs.getFs(), dir: bfs.REPO_DIR }) || defaultBranch;

    try {
      // Three-way walk. The merge base is what disambiguates "added on their
      // side" from "deleted on our side" — without it, a two-tree walk once
      // deleted every remotely-added file (214 pages in one publish).
      const ourFiles = await walkTree(localOid);
      const theirFiles = await walkTree(remoteOid);
      let baseFiles = new Map<string, string>();
      try {
        const bases = await git.findMergeBase({ fs: bfs.getFs(), dir: bfs.REPO_DIR, oids: [localOid, remoteOid] }) as string[];
        if (bases?.[0]) baseFiles = await walkTree(bases[0]);
      } catch { /* no common ancestor — fall back to never deleting */ }

      const allPaths = new Set([...ourFiles.keys(), ...theirFiles.keys()]);

      const mergedFiles: string[] = [];
      const deletedFiles: string[] = [];
      const conflicts: ConflictFile[] = [];

      const readBlob = async (oid: string) => {
        const { blob } = await git.readBlob({ fs: bfs.getFs(), dir: bfs.REPO_DIR, oid });
        return blob;
      };

      for (const path of allPaths) {
        const ourOid = ourFiles.get(path);
        const theirOid = theirFiles.get(path);
        const baseOid = baseFiles.get(path);

        if (ourOid === theirOid) continue; // identical — no action needed

        if (!ourOid && theirOid) {
          if (baseOid === theirOid) {
            // We deleted it and they left it untouched — keep it deleted.
            continue;
          }
          // New (or changed) on their side — write it into our tree.
          await bfs.writeRepoFile(path, await readBlob(theirOid));
          mergedFiles.push(path);
          continue;
        }

        if (ourOid && !theirOid) {
          if (baseOid === ourOid) {
            // They deleted it and we left it untouched — apply their deletion.
            try {
              await pfs.unlink(`${bfs.REPO_DIR}/${path}`);
            } catch { /* already gone */ }
            deletedFiles.push(path);
          }
          // Otherwise it's new or modified on our side — keep it.
          continue;
        }

        if (!ourOid || !theirOid) continue; // unreachable — narrows types for below

        // Both have the file but different content. Files outside the caller's
        // resolution policy take theirs — as raw bytes, since a text round-trip
        // would corrupt binaries.
        if (!needsResolution(path)) {
          await bfs.writeRepoFile(path, await readBlob(theirOid));
          mergedFiles.push(path);
          continue;
        }

        const ourContent = new TextDecoder().decode(await readBlob(ourOid));
        const theirContent = new TextDecoder().decode(await readBlob(theirOid));

        // If content is identical modulo trailing whitespace, take theirs — no conflict.
        if (ourContent.trimEnd() === theirContent.trimEnd()) {
          await pfs.writeFile(`${bfs.REPO_DIR}/${path}`, theirContent, 'utf8');
          mergedFiles.push(path);
          continue;
        }

        // Real conflict — return to caller for resolution
        conflicts.push({ path, ours: ourContent, theirs: theirContent });
      }

      for (const path of mergedFiles) {
        try {
          await git.add({ fs: bfs.getFs(), dir: bfs.REPO_DIR, filepath: path });
        } catch { /* skip */ }
      }
      for (const path of deletedFiles) {
        try {
          await git.remove({ fs: bfs.getFs(), dir: bfs.REPO_DIR, filepath: path });
        } catch { /* skip */ }
      }

      if (conflicts.length > 0) {
        // Leave the merge pending — caller must resolve and call completeMerge.
        // Recorded on disk as well as returned, so the state survives the page
        // that was resolving it.
        const pending = { savedHead, branch, remoteOid, session };
        await writePendingMarker(pending);
        // Translate internal repo-relative paths to site-relative for the caller.
        return {
          result: {
            mergedFiles: mergedFiles.map(bfs.toSitePath),
            conflicts: conflicts.map(c => ({ ...c, path: bfs.toSitePath(c.path) })),
          },
          pending,
        };
      }

      // No conflicts — stage any remaining working tree changes and commit.
      await stageWorkingTree();
      await commitMerge(author, localOid, remoteOid);

      return { result: { mergedFiles: mergedFiles.map(bfs.toSitePath), conflicts: [] }, pending: null };
    } catch (err) {
      await rollback(branch, savedHead);
      throw err;
    }
  }

  /**
   * Give up on a pending merge and put the repository back as it was.
   *
   * threeWayMerge and completePendingMerge each roll back their own failures,
   * but between them sits the caller's resolution step — a Claude agent, and a
   * human answering its questions. That step can fail or be cancelled, and
   * without this the auto-merged files stayed staged with the merge never
   * committed: the next ordinary save swept the remote's changes into a
   * single-parent commit, so git no longer knew the remote had been merged and
   * every later push was rejected as non-fast-forward.
   */
  async function abortPendingMerge(pending: PendingMerge): Promise<void> {
    await rollback(pending.branch, pending.savedHead);
  }

  /** Write the resolved files, stage everything, and make the merge commit. */
  async function completePendingMerge(
    pending: PendingMerge,
    resolvedFiles: Map<string, string>,
    author: Author,
  ): Promise<void> {
    const pfs = bfs.getFs().promises;
    const { savedHead, branch, remoteOid } = pending;

    // The merge this resolution belongs to must still be the one on disk.
    // Another tab can have rolled it back while a human was answering
    // questions here, and committing then records `[savedHead, remoteOid]` as
    // parents over a tree that no longer contains the remote's changes: git is
    // told the remote is merged, the changes are gone, and because remoteOid
    // becomes an ancestor they can never be re-applied. Refusing is the only
    // safe answer — this side has nothing left to commit.
    const onDisk = await readPendingMarker();
    if (!onDisk || onDisk.session !== pending.session || onDisk.remoteOid !== remoteOid) {
      throw new UserFacingError(
        'The changes being merged are no longer waiting to be merged — this was cancelled somewhere else. ' +
        'Nothing was saved; pull again to redo it.',
      );
    }

    try {
      // Caller passes site-relative keys; translate each to repo-relative
      // before writing to lightning-fs or iso-git.
      for (const [sitePath, fileContent] of resolvedFiles) {
        const filepath = bfs.toRepoPath(sitePath);
        await pfs.writeFile(`${bfs.REPO_DIR}/${filepath}`, fileContent, 'utf8');
        await git.add({ fs: bfs.getFs(), dir: bfs.REPO_DIR, filepath });
      }

      await stageWorkingTree();
      await commitMerge(author, savedHead, remoteOid);
      await clearPendingMarker();
    } catch (err) {
      await rollback(branch, savedHead);
      throw err;
    }
  }

  return {
    readPendingMarker,
    clearPendingMarker,
    walkTree,
    threeWayMerge,
    abortPendingMerge,
    completePendingMerge,
  };
}
