/**
 * The operations layer, for a site's own blocks and hooks.
 *
 * The wiring moved to `@plinto/admin`, which builds the storage and the three
 * ops factories from the config this adapter hands it. What is left here is
 * the published surface — `@plinto/astro/lib/ops` — so a site's block goes on
 * importing one path and never sees a runtime.
 */
import { plinto } from '../../plinto';

export * from '@plinto/core/ops/errors';
export type { DirEntry } from '@plinto/core/storage/file-store/types';
export type { StalenessInfo } from '@plinto/core/ops/content';
export type {
  RepoInfo, SyncState, PullStatus, OpsPullResult, OnOpsProgress,
  OnConflict, ProgressFn,
} from '@plinto/core/ops/repo';
export type { MediaFile } from '@plinto/core/ops/media';

export const {
  getContent, listContent, resolveFilePath,
  editContent, syncContent, fixContent,
  getStaleness, markAsSynced,
  getLfsDb, listMedia, writeMedia, deleteMedia, getMediaUrl,
  getRepoInfo, getSyncState, getCommitLog,
  pull, push, discard, initRepo,
  stores,
} = plinto.ops;
