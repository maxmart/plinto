/**
 * The three-way merge, against a real repository.
 *
 * This module had no test at all, and it is where every publish either
 * incorporates the remote's work or loses it. Four rounds of adversarial
 * review each found bugs in here — a two-tree walk that deleted 214 remotely
 * added pages, a merge left pending with nothing recording it, a commit that
 * recorded the remote as merged over a tree that no longer held its changes —
 * and each round proved them by building this harness from scratch and then
 * throwing it away. Here it is, kept.
 *
 * isomorphic-git runs against node's fs here rather than lightning-fs; the
 * git objects, refs, index and working tree are all real, so what these tests
 * assert about parents and trees is what git would say.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';

let repoDir: string;

import { createMerge } from '../merge';
import { nodeBrowserFs } from '../../../test/browser-fs';

// The merge takes its filesystem as an argument, so pointing it at a temp
// directory is a call rather than a module mock.
const { threeWayMerge, completePendingMerge, abortPendingMerge, readPendingMarker, clearPendingMarker } =
  createMerge(nodeBrowserFs(() => repoDir), 'main');

const author = { name: 'Test', email: 'test@plinto.local' };
const SESSION = 'test-session';

async function write(file: string, body: string) {
  const full = path.join(repoDir, file);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, body, 'utf8');
}

async function commit(message: string, files: string[]) {
  for (const f of files) {
    if (fs.existsSync(path.join(repoDir, f))) await git.add({ fs, dir: repoDir, filepath: f });
    else await git.remove({ fs, dir: repoDir, filepath: f });
  }
  return git.commit({ fs, dir: repoDir, message, author });
}

/** Every path in a commit's tree. */
async function treePaths(oid: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (treeOid: string, prefix: string) => {
    const { tree } = await git.readTree({ fs, dir: repoDir, oid: treeOid });
    for (const e of tree) {
      const p = prefix ? `${prefix}/${e.path}` : e.path;
      if (e.type === 'blob') out.push(p);
      else await walk(e.oid, p);
    }
  };
  await walk(oid, '');
  return out.sort();
}

const head = () => git.resolveRef({ fs, dir: repoDir, ref: 'HEAD' });
const read = (file: string) => fs.promises.readFile(path.join(repoDir, file), 'utf8');
const parentsOf = async (oid: string) =>
  (await git.readCommit({ fs, dir: repoDir, oid })).commit.parent;

/**
 * A repository whose local branch and `origin/main` have diverged.
 * Returns the two tips.
 */
async function divergedRepo(): Promise<{ base: string; ours: string; theirs: string }> {
  await git.init({ fs, dir: repoDir, defaultBranch: 'main' });
  await write('shared.mdx', 'base\n');
  await write('untouched.mdx', 'untouched\n');
  const base = await commit('base', ['shared.mdx', 'untouched.mdx']);

  // Their side, recorded as origin/main.
  await write('shared.mdx', 'theirs\n');
  await write('theirs-only.mdx', 'from them\n');
  await write('media.bin', 'their bytes\n');
  const theirs = await commit('theirs', ['shared.mdx', 'theirs-only.mdx', 'media.bin']);
  await git.writeRef({ fs, dir: repoDir, ref: 'refs/remotes/origin/main', value: theirs, force: true });

  // Ours, branching from base.
  await git.writeRef({ fs, dir: repoDir, ref: 'refs/heads/main', value: base, force: true });
  await git.checkout({ fs, dir: repoDir, ref: 'main', force: true });
  await write('shared.mdx', 'ours\n');
  await write('ours-only.mdx', 'from us\n');
  await write('media.bin', 'our bytes\n');
  const ours = await commit('ours', ['shared.mdx', 'ours-only.mdx', 'media.bin']);

  return { base, ours, theirs };
}

beforeEach(async () => {
  repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'plinto-merge-'));
});

afterEach(async () => {
  await fs.promises.rm(repoDir, { recursive: true, force: true });
});

describe('a merge with no conflicts', () => {
  it('commits with BOTH parents, so the remote counts as merged', async () => {
    const { ours, theirs } = await divergedRepo();
    // Nothing needs resolution: every both-sides change takes the remote.
    const { result, pending } = await threeWayMerge(theirs, author, () => false, SESSION);

    expect(pending).toBeNull();
    expect(result.conflicts).toEqual([]);
    // A single parent would mean git never learns the remote was merged, and
    // every push afterwards is rejected as non-fast-forward.
    expect(await parentsOf(await head())).toEqual([ours, theirs]);
  });

  it('brings across a file only the remote has', async () => {
    const { theirs } = await divergedRepo();
    await threeWayMerge(theirs, author, () => false, SESSION);
    expect(await read('theirs-only.mdx')).toBe('from them\n');
    expect(await treePaths(await head())).toContain('theirs-only.mdx');
  });

  it('keeps a file only we have', async () => {
    const { theirs } = await divergedRepo();
    await threeWayMerge(theirs, author, () => false, SESSION);
    expect(await read('ours-only.mdx')).toBe('from us\n');
  });

  it('leaves a file neither side touched alone', async () => {
    const { theirs } = await divergedRepo();
    await threeWayMerge(theirs, author, () => false, SESSION);
    expect(await read('untouched.mdx')).toBe('untouched\n');
  });

  it('keeps a file we deleted deleted, rather than resurrecting it', async () => {
    // The merge base is what tells "they added it" from "we deleted it".
    // Without it a two-tree walk once deleted 214 remotely added pages; the
    // mirror error resurrects everything the user removed.
    const { theirs } = await divergedRepo();
    await fs.promises.unlink(path.join(repoDir, 'untouched.mdx'));
    await commit('delete untouched', ['untouched.mdx']);

    await threeWayMerge(theirs, author, () => false, SESSION);
    expect(fs.existsSync(path.join(repoDir, 'untouched.mdx'))).toBe(false);
    expect(await treePaths(await head())).not.toContain('untouched.mdx');
  });
});

describe('a merge with conflicts', () => {
  const onlyMdx = (p: string) => p.endsWith('.mdx');

  it('returns the conflicted files and commits nothing', async () => {
    const { ours, theirs } = await divergedRepo();
    const { result, pending } = await threeWayMerge(theirs, author, onlyMdx, SESSION);

    expect(result.conflicts.map(c => c.path)).toEqual(['shared.mdx']);
    expect(result.conflicts[0].ours).toBe('ours\n');
    expect(result.conflicts[0].theirs).toBe('theirs\n');
    expect(pending).not.toBeNull();
    expect(await head()).toBe(ours);           // nothing committed yet
  });

  it('takes the remote for files the caller does not want resolved', async () => {
    // What counts as a conflict is the caller's policy: media and config take
    // the remote's version rather than asking a human about bytes.
    const { theirs } = await divergedRepo();
    await threeWayMerge(theirs, author, onlyMdx, SESSION);
    expect(await read('media.bin')).toBe('their bytes\n');
  });

  it('records the pending merge on disk, not just in memory', async () => {
    // A reload during resolution used to leave the repository half-merged
    // with nothing anywhere saying so.
    const { ours, theirs } = await divergedRepo();
    await threeWayMerge(theirs, author, onlyMdx, SESSION);

    const marker = await readPendingMarker();
    expect(marker).toMatchObject({ savedHead: ours, remoteOid: theirs, session: SESSION });
    expect(fs.existsSync(path.join(repoDir, '.git/MERGE_HEAD'))).toBe(true);
  });

  it('commits both parents and clears the marker when resolution lands', async () => {
    const { ours, theirs } = await divergedRepo();
    const { pending } = await threeWayMerge(theirs, author, onlyMdx, SESSION);

    await completePendingMerge(pending!, new Map([['shared.mdx', 'merged by hand\n']]), author);

    expect(await parentsOf(await head())).toEqual([ours, theirs]);
    expect(await read('shared.mdx')).toBe('merged by hand\n');
    expect(await readPendingMarker()).toBeNull();
    // and the remote's other work came along
    expect(await treePaths(await head())).toContain('theirs-only.mdx');
  });

  it('refuses to commit a merge that was abandoned elsewhere', async () => {
    // Another tab can roll the merge back while a human answers questions
    // here. Committing then records the remote as merged over a tree that no
    // longer holds its changes — and because it becomes an ancestor, they can
    // never be re-applied.
    const { theirs } = await divergedRepo();
    const { pending } = await threeWayMerge(theirs, author, onlyMdx, SESSION);

    await clearPendingMarker();          // stand in for the other tab

    await expect(
      completePendingMerge(pending!, new Map([['shared.mdx', 'x\n']]), author),
    ).rejects.toThrow(/no longer/i);
  });

  it('refuses a merge whose marker belongs to someone else', async () => {
    const { theirs } = await divergedRepo();
    const { pending } = await threeWayMerge(theirs, author, onlyMdx, SESSION);

    await expect(
      completePendingMerge({ ...pending!, session: 'a-different-tab' }, new Map(), author),
    ).rejects.toThrow(/no longer/i);
  });
});

describe('abandoning a merge', () => {
  const onlyMdx = (p: string) => p.endsWith('.mdx');

  it('puts HEAD, the working tree and the index back', async () => {
    const { ours, theirs } = await divergedRepo();
    const { pending } = await threeWayMerge(theirs, author, onlyMdx, SESSION);

    await abortPendingMerge(pending!);

    expect(await head()).toBe(ours);
    expect(await read('shared.mdx')).toBe('ours\n');
    expect(await read('media.bin')).toBe('our bytes\n');
    // The remote's file was staged by the merge; it must not survive.
    expect(fs.existsSync(path.join(repoDir, 'theirs-only.mdx'))).toBe(false);
    expect(await readPendingMarker()).toBeNull();

    const status = await git.statusMatrix({ fs, dir: repoDir });
    expect(status.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1))).toEqual([]);
  });

  it('leaves a repository a later merge can use', async () => {
    const { theirs } = await divergedRepo();
    const first = await threeWayMerge(theirs, author, onlyMdx, SESSION);
    await abortPendingMerge(first.pending!);

    const second = await threeWayMerge(theirs, author, onlyMdx, SESSION);
    expect(second.result.conflicts.map(c => c.path)).toEqual(['shared.mdx']);
  });
});
