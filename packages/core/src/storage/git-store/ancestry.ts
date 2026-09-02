import type { GitStore } from './types';

/**
 * Whether one commit is reachable from another.
 *
 * Defined in terms of the walk rather than repeating it — this was a second
 * copy of the loop below, differing only in what it returned.
 */
export async function isAncestor(
  gitStore: Pick<GitStore, 'getParentCommit'>,
  ancestorOid: string,
  descendantOid: string,
): Promise<boolean> {
  return (await countAncestry(gitStore, ancestorOid, descendantOid)) !== null;
}

/** How many commits lie between the two, or null if the first is not reachable. */
export async function countAncestry(
  gitStore: Pick<GitStore, 'getParentCommit'>,
  ancestorOid: string,
  descendantOid: string,
): Promise<number | null> {
  let current: string | null = descendantOid;
  let count = 0;
  while (current !== null) {
    if (current === ancestorOid) return count;
    current = await gitStore.getParentCommit(current);
    count++;
  }
  return null;
}
