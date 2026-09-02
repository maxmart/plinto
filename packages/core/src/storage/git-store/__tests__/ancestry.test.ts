import { isAncestor, countAncestry } from '../ancestry';

// Chain: c5 → c4 → c3 → c2 → c1 (root)
const chain: Record<string, string | null> = {
  c5: 'c4',
  c4: 'c3',
  c3: 'c2',
  c2: 'c1',
  c1: null,
};

const mockGitStore = {
  getParentCommit: vi.fn(async (hash: string): Promise<string | null> => {
    if (hash in chain) return chain[hash];
    return null;
  }),
};

beforeEach(() => {
  mockGitStore.getParentCommit.mockClear();
});

describe('isAncestor', () => {
  it('returns true when ancestor is reachable from descendant', async () => {
    expect(await isAncestor(mockGitStore, 'c1', 'c5')).toBe(true);
  });

  it('returns true for immediate parent', async () => {
    expect(await isAncestor(mockGitStore, 'c4', 'c5')).toBe(true);
  });

  it('returns true when both OIDs are the same', async () => {
    expect(await isAncestor(mockGitStore, 'c3', 'c3')).toBe(true);
  });

  it('returns false in wrong direction (descendant is not ancestor of ancestor)', async () => {
    expect(await isAncestor(mockGitStore, 'c5', 'c1')).toBe(false);
  });

  it('returns false for unrelated commit', async () => {
    expect(await isAncestor(mockGitStore, 'unrelated', 'c5')).toBe(false);
  });

  it('walks lazily — stops as soon as found', async () => {
    await isAncestor(mockGitStore, 'c4', 'c5');
    // Should only have called getParentCommit once (c5 → c4, found immediately)
    expect(mockGitStore.getParentCommit).toHaveBeenCalledTimes(1);
    expect(mockGitStore.getParentCommit).toHaveBeenCalledWith('c5');
  });
});

describe('countAncestry', () => {
  it('returns the number of commits between ancestor and descendant', async () => {
    expect(await countAncestry(mockGitStore, 'c1', 'c5')).toBe(4);
  });

  it('returns 1 for immediate parent', async () => {
    expect(await countAncestry(mockGitStore, 'c4', 'c5')).toBe(1);
  });

  it('returns 0 when both OIDs are the same', async () => {
    expect(await countAncestry(mockGitStore, 'c3', 'c3')).toBe(0);
  });

  it('returns null when ancestor is not reachable', async () => {
    expect(await countAncestry(mockGitStore, 'c5', 'c1')).toBeNull();
  });

  it('returns null for unrelated commit', async () => {
    expect(await countAncestry(mockGitStore, 'unrelated', 'c5')).toBeNull();
  });
});
