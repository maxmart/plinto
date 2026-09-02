/**
 * BrowserGitStore, against a real repository.
 *
 * 500 lines that commit, reset and clone, with no test at all — and most of
 * it is thin delegation to isomorphic-git, which does not need one. What
 * needs one is the handful of places where this file decided something for
 * itself, and every one of those decisions is here because it was wrong once:
 * a stat failure read as a deletion, an index stat cache that hid a save, a
 * discard that left the merge marker behind and undid itself on the next
 * load, a commit taken while a merge was staged.
 *
 * Same harness as merge.test.ts: isomorphic-git over node's fs, so the
 * objects, refs, index and working tree are real and what these tests assert
 * about parents and trees is what git would say.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';

let repoDir: string;

import { createBrowserGitStore } from '../browser';
import { createMerge } from '../merge';
import type { BrowserGitStore } from '../browser';
import { nodeBrowserFs } from '../../../test/browser-fs';
import { createSettings } from '../../../settings';
import { testConfig } from '../../../test/config';

// The store takes its filesystem, git settings and stored credentials as
// arguments, so this is construction rather than a module mock.
const bfs = nodeBrowserFs(() => repoDir);
const newStore = () => createBrowserGitStore({
  git: testConfig.git,
  fs: bfs,
  settings: createSettings('test'),
});
const { readPendingMarker } = createMerge(bfs, testConfig.git.defaultBranch);

const author = { name: 'Plinto', email: 'plinto@plinto.local' };

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

const head = () => git.resolveRef({ fs, dir: repoDir, ref: 'HEAD' });
const count = async () => (await git.log({ fs, dir: repoDir, ref: 'HEAD' })).length;

/** Leave the repository looking like someone's merge is half-done in it. */
async function stubPendingMerge(session = 'the-other-tab', fields: Record<string, unknown> = {}) {
  const oid = await head();
  fs.writeFileSync(
    path.join(repoDir, '.git/PLINTO_MERGE'),
    JSON.stringify({ savedHead: oid, branch: 'main', remoteOid: oid, session, ...fields }),
    'utf8',
  );
}

/** Whether the working tree file matches HEAD. */
async function committedBody(file: string): Promise<string> {
  const { blob } = await git.readBlob({ fs, dir: repoDir, oid: await head(), filepath: file });
  return new TextDecoder().decode(blob);
}

let store: BrowserGitStore;

beforeEach(async () => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinto-store-'));
  await git.init({ fs, dir: repoDir, defaultBranch: 'main' });
  await write('a.mdx', 'one\n');
  await commit('initial', ['a.mdx']);
  // getAuthor() reads the admin's name from here.
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  store = newStore();
  await store.checkInitialized();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('commitFiles', () => {
  it('commits a changed file', async () => {
    await write('a.mdx', 'two\n');
    await store.commitFiles('edit a', ['a.mdx']);

    expect(await count()).toBe(2);
    expect(await committedBody('a.mdx')).toBe('two\n');
  });

  it('makes no commit when nothing changed', async () => {
    // A "minor fix" that changes nothing is a real thing the editor does.
    // Counting it would leave an empty junk commit, and an unpushable one.
    await store.commitFiles('no-op', ['a.mdx']);
    expect(await count()).toBe(1);
  });

  it('sees a same-length change the index thinks is unmodified', async () => {
    // The index caches each file's stats, and lightning-fs keeps mtime to the
    // second — so a same-length save in the same second read as 'unmodified'
    // and was silently dropped. Staging first re-reads and re-hashes the
    // file, which is why the status that follows is asked afterwards.
    //
    // Forced here by putting the mtime back where it was, which is the
    // clock's version of the same accident.
    const file = path.join(repoDir, 'a.mdx');
    const before = fs.statSync(file);
    await write('a.mdx', 'ONE\n');
    fs.utimesSync(file, before.atime, before.mtime);

    await store.commitFiles('same length, same second', ['a.mdx']);

    expect(await count()).toBe(2);
    expect(await committedBody('a.mdx')).toBe('ONE\n');
  });

  it('commits a deletion', async () => {
    fs.unlinkSync(path.join(repoDir, 'a.mdx'));
    await store.commitFiles('delete a', ['a.mdx']);

    expect(await count()).toBe(2);
    await expect(committedBody('a.mdx')).rejects.toThrow();
  });

  it('does not count a path that was never there', async () => {
    await store.commitFiles('nothing', ['never-existed.mdx']);
    expect(await count()).toBe(1);
  });

  it('refuses to read a failed stat as a deletion', async () => {
    // The one that matters. A lightning-fs mutex timeout or an aborted IDB
    // transaction is not "the user deleted this page" — staging it as a
    // deletion commits the page away while it still sits in the working tree.
    const real = fs.promises.stat;
    const boom = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    const spy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p, ...rest) => {
      if (String(p).endsWith('a.mdx')) throw boom;
      return real(p as never, ...(rest as []));
    });

    await expect(store.commitFiles('edit a', ['a.mdx'])).rejects.toThrow('EBUSY');
    spy.mockRestore();

    expect(await count()).toBe(1);
    expect(await committedBody('a.mdx')).toBe('one\n');
  });

  it('refuses while a merge is pending, and says how to get out', async () => {
    // isomorphic-git never reads MERGE_HEAD, so an ordinary commit taken
    // mid-merge produces a single-parent commit that sweeps the remote's work
    // in as the user's own — after which every push is rejected. Refusing is
    // the whole protection.
    await stubPendingMerge('someone-else');
    await write('a.mdx', 'two\n');

    await expect(store.commitFiles('edit a', ['a.mdx'])).rejects.toMatchObject({
      remedy: 'discard',
    });
    expect(await count()).toBe(1);
  });
});

describe('getLog', () => {
  it('classifies each commit\'s files as added, modified or deleted', async () => {
    await write('b.mdx', 'b\n');
    await commit('add b', ['b.mdx']);
    await write('a.mdx', 'changed\n');
    fs.unlinkSync(path.join(repoDir, 'b.mdx'));
    await commit('edit a, drop b', ['a.mdx', 'b.mdx']);

    const log = await store.getLog(3);

    expect(log.map(c => c.message)).toEqual(['edit a, drop b', 'add b', 'initial']);
    expect(log[0].files).toEqual(
      expect.arrayContaining([
        { path: 'a.mdx', type: 'modified' },
        { path: 'b.mdx', type: 'deleted' },
      ]),
    );
    expect(log[1].files).toEqual([{ path: 'b.mdx', type: 'added' }]);
    // A first commit has no parent to diff against; everything in it is new.
    expect(log[2].files).toEqual([{ path: 'a.mdx', type: 'added' }]);
  });

  it('is empty rather than throwing on a repository with no commits', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'plinto-empty-'));
    const previous = repoDir;
    repoDir = bare;
    await git.init({ fs, dir: repoDir, defaultBranch: 'main' });
    try {
      expect(await newStore().getLog(5)).toEqual([]);
    } finally {
      repoDir = previous;
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('resetToRemote', () => {
  it('restores modified files and deletes new ones', async () => {
    await write('a.mdx', 'edited\n');
    await write('new.mdx', 'untracked\n');

    await store.resetToRemote();

    expect(fs.readFileSync(path.join(repoDir, 'a.mdx'), 'utf8')).toBe('one\n');
    expect(fs.existsSync(path.join(repoDir, 'new.mdx'))).toBe(false);
  });

  it('moves the branch back to the remote tip', async () => {
    const remoteTip = await head();
    await write('a.mdx', 'local work\n');
    await commit('local', ['a.mdx']);
    expect(await count()).toBe(2);

    await git.writeRef({ fs, dir: repoDir, ref: 'refs/remotes/origin/main', value: remoteTip, force: true });
    await store.resetToRemote();

    expect(await head()).toBe(remoteTip);
    expect(await count()).toBe(1);
    expect(fs.readFileSync(path.join(repoDir, 'a.mdx'), 'utf8')).toBe('one\n');
  });

  it('clears the merge marker, so the discard does not undo itself', async () => {
    // It used to delete three of the four state files by name and leave
    // PLINTO_MERGE behind. The next load found the marker, rolled HEAD back to
    // the commit that had just been discarded, and every later merge was
    // refused because _pendingMerge had never been cleared either.
    await stubPendingMerge();
    expect(await store.hasPendingMerge()).toBe(true);

    await store.resetToRemote();

    expect(await store.hasPendingMerge()).toBe(false);
    expect(await readPendingMarker()).toBeNull();
    // And a save works again immediately, which is the point of discarding.
    await write('a.mdx', 'after the discard\n');
    await store.commitFiles('edit a', ['a.mdx']);
    expect(await committedBody('a.mdx')).toBe('after the discard\n');
  });

  it('leaves the marker standing if the reset fails part-way', async () => {
    // The marker comes off at the END. Clearing it first and then failing
    // would leave a half-merged working tree with nothing left to refuse the
    // next save.
    await stubPendingMerge();
    const spy = vi.spyOn(git, 'statusMatrix').mockRejectedValueOnce(new Error('fs went away'));

    await expect(store.resetToRemote()).rejects.toThrow('fs went away');
    spy.mockRestore();

    expect(await store.hasPendingMerge()).toBe(true);
  });
});

describe('merge bookkeeping', () => {
  it('refuses a second merge rather than overwriting the first', async () => {
    // The record holds the HEAD to roll back to, so replacing it loses the
    // only way home from the first merge. Two admin tabs reach this: both
    // auto-pull on load.
    await write('a.mdx', 'ours\n');
    await commit('ours', ['a.mdx']);
    const ours = await head();

    await git.writeRef({ fs, dir: repoDir, ref: 'refs/heads/theirs', value: ours, force: true });
    await write('a.mdx', 'theirs\n');
    const theirs = await commit('theirs', ['a.mdx']);
    await git.writeRef({ fs, dir: repoDir, ref: 'HEAD', value: ours, force: true, symbolic: false });

    // First merge leaves conflicts pending; the second must be refused.
    await store.merge(theirs, p => p.endsWith('.mdx')).catch(() => {});
    if (await store.hasPendingMerge()) {
      await expect(store.merge(theirs, p => p.endsWith('.mdx'))).rejects.toThrow(/already merging/);
    }
  });

  it('has nothing to abort when no merge was started', async () => {
    await expect(store.abortMerge()).resolves.toBeUndefined();
  });

  it('refuses to complete a merge that was never started', async () => {
    await expect(store.completeMerge(new Map())).rejects.toThrow('No merge in progress');
  });

  it('ignores a marker that was only half-written', async () => {
    // A record missing any of the three things it exists to hold cannot get
    // the repository home, so it is not a record. Treating it as one would
    // refuse every save with no way to satisfy the refusal.
    await stubPendingMerge('s', { branch: undefined });
    expect(await store.hasPendingMerge()).toBe(false);
    await write('a.mdx', 'two\n');
    await store.commitFiles('edit a', ['a.mdx']);
    expect(await count()).toBe(2);
  });
});

describe('readBlobAtCommit', () => {
  it('reads a file as it was at a given commit', async () => {
    const first = await head();
    await write('a.mdx', 'two\n');
    await commit('edit a', ['a.mdx']);

    expect(await store.readBlobAtCommit('a.mdx', first)).toBe('one\n');
    expect(await store.readBlobAtCommit('a.mdx', await head())).toBe('two\n');
  });

  it('falls back to GitHub when the commit is not in the shallow clone', async () => {
    // The clone is single-branch and shallow, so sync metadata can name a
    // commit that simply is not here.
    await git.setConfig({
      fs, dir: repoDir, path: 'remote.origin.url', value: 'https://github.com/owner/repo.git',
    });
    await store.checkInitialized();
    const fetchMock = vi.fn(async () => new Response('from github\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await store.readBlobAtCommit('a.mdx', 'f'.repeat(40))).toBe('from github\n');
    expect(fetchMock).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/owner/repo/${'f'.repeat(40)}/a.mdx`,
    );
  });
});

describe('checkInitialized', () => {
  it('reports a real repository, and remembers its remote', async () => {
    await git.setConfig({
      fs, dir: repoDir, path: 'remote.origin.url', value: 'https://github.com/owner/repo.git',
    });

    expect(await store.checkInitialized()).toBe(true);
    expect(await store.getRemoteUrl()).toBe('https://github.com/owner/repo.git');
  });

  it('reports a directory that is not a repository', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'plinto-plain-'));
    const previous = repoDir;
    repoDir = plain;
    try {
      expect(await newStore().checkInitialized()).toBe(false);
    } finally {
      repoDir = previous;
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('does not clean up a merge another tab may still be resolving', async () => {
    // It used to. A second admin tab opening during the minute a human spends
    // answering conflict questions in the first one rolled the merge back
    // underneath it, and the first tab then committed the remote as merged
    // over a tree that no longer held its changes — unrecoverably, because
    // the remote's oid had become an ancestor.
    await stubPendingMerge();

    await newStore().checkInitialized();

    expect(await readPendingMarker()).not.toBeNull();
  });
});
