/**
 * The pull orchestration, against a scripted git store.
 *
 * The case that matters: a pull that fetched, hit conflicts, and was rolled
 * back (no API key, Claude failing, the editor closing on a question). The
 * remote-tracking ref already points at the remote head, but the branch has
 * not merged it. An editor stuck there saw Pull do nothing and every Publish
 * rejected as non-fast-forward, with no way out from the admin.
 */
import { createRepoOps } from '../repo';

// B is the merge base; the editor committed L on it, the remote moved to R.
const B = 'b'.repeat(40);
const L = 'l'.repeat(40);
const R = 'r'.repeat(40);
const parents: Record<string, string | null> = { [B]: null, [L]: B, [R]: B };

function fakeStore({ head, tracking, remoteHead }: { head: string; tracking: string; remoteHead: string }) {
  const state = { head, tracking };
  return {
    state,
    getHeadHash: vi.fn(async () => state.head),
    resolveRef: vi.fn(async (ref: string) => {
      if (ref === 'refs/remotes/origin/main') return state.tracking;
      throw new Error(`no ref ${ref}`);
    }),
    getRemoteInfo: vi.fn(async () => ({ refs: { heads: { main: remoteHead } } })),
    fetch: vi.fn(async () => { state.tracking = remoteHead; }),
    getParentCommit: vi.fn(async (oid: string) => parents[oid] ?? null),
    writeRef: vi.fn(async () => {}),
    checkout: vi.fn(async () => {}),
    merge: vi.fn(async () => ({ conflicts: [], mergedFiles: ['src/pages/index.mdx'] })),
    completeMerge: vi.fn(async () => {}),
    abortMerge: vi.fn(async () => {}),
  };
}

function opsFor(store: ReturnType<typeof fakeStore>) {
  return createRepoOps({
    config: { git: { defaultBranch: 'main', corsProxy: 'https://proxy.example' } },
    stores: { getGitStore: async () => store },
    settings: {},
    media: {},
  } as never);
}

const noConflicts = async () => [];

describe('pull', () => {
  it('merges a remote it already fetched but never merged (after a rolled-back merge)', async () => {
    const store = fakeStore({ head: L, tracking: R, remoteHead: R });

    const result = await opsFor(store).pull('token', noConflicts);

    expect(store.fetch).not.toHaveBeenCalled(); // nothing new to download
    expect(store.merge).toHaveBeenCalledWith(R, expect.any(Function));
    expect(result.status).toBe('merged');
  });

  it('fast-forwards onto a remote it already fetched', async () => {
    const store = fakeStore({ head: B, tracking: R, remoteHead: R });

    const result = await opsFor(store).pull('token', noConflicts);

    expect(store.fetch).not.toHaveBeenCalled();
    expect(store.writeRef).toHaveBeenCalledWith('refs/heads/main', R);
    expect(result.status).toBe('fast_forward');
  });

  it('is up to date, without fetching, when the remote has not moved and the branch has it', async () => {
    const store = fakeStore({ head: R, tracking: R, remoteHead: R });

    const result = await opsFor(store).pull('token', noConflicts);

    expect(store.fetch).not.toHaveBeenCalled();
    expect(store.merge).not.toHaveBeenCalled();
    expect(result.status).toBe('up_to_date');
  });

  it('is up to date when the branch is ahead of the remote', async () => {
    const store = fakeStore({ head: L, tracking: B, remoteHead: B });

    const result = await opsFor(store).pull('token', noConflicts);

    expect(store.merge).not.toHaveBeenCalled();
    expect(result.status).toBe('up_to_date');
  });

  it('fetches when the remote has moved', async () => {
    const store = fakeStore({ head: L, tracking: B, remoteHead: R });

    const result = await opsFor(store).pull('token', noConflicts);

    expect(store.fetch).toHaveBeenCalledTimes(1);
    expect(store.merge).toHaveBeenCalledWith(R, expect.any(Function));
    expect(result.status).toBe('merged');
  });

  it('rolls back and reports a failed resolution — and the next pull tries again', async () => {
    const store = fakeStore({ head: L, tracking: B, remoteHead: R });
    store.merge.mockResolvedValueOnce({
      conflicts: [{ path: 'src/pages/index.mdx', ours: 'a', theirs: 'b', base: '' }],
      mergedFiles: [],
    } as never);
    const ops = opsFor(store);

    await expect(
      ops.pull('token', async () => { throw new Error('Cancelled while resolving a conflict.'); }),
    ).rejects.toThrow();
    expect(store.abortMerge).toHaveBeenCalledTimes(1);

    // The fetch above moved the tracking ref to R; the branch is still L.
    const retry = await ops.pull('token', noConflicts);
    expect(store.merge).toHaveBeenCalledTimes(2);
    expect(retry.status).toBe('merged');
  });
});
