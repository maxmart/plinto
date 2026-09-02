/**
 * The operations a CMS performs, as three factories.
 *
 * Each one takes the site's configuration and its storage and returns the
 * operations bound to them; an adapter calls these once and hands the result
 * to whatever it puts on top. Nothing here reaches for a configured instance,
 * because there is no such thing at this level — that is the adapter's job,
 * and keeping it there is what lets this package run under something that is
 * not Astro.
 */
export * from './errors';
export { createContentOps, type ContentOpsDeps, type StalenessInfo } from './content';
export { createMediaOps, type MediaOpsDeps, type MediaFile } from './media';
export {
  createRepoOps, type RepoOpsDeps,
  type RepoInfo, type SyncState, type PullStatus, type OpsPullResult,
  type OnOpsProgress, type OnConflict, type ProgressFn,
} from './repo';
