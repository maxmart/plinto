/**
 * @plinto/core — the engine under an plinto CMS.
 *
 * What a document is and where it lives, the two storage modes, the operations
 * a CMS performs on content and on its repository, and the Claude agents that
 * translate and resolve merges. It takes its configuration as an argument and
 * imports nothing from any site generator: `@plinto/astro` is one adapter over
 * this, not the only shape one could have.
 *
 * The light surface is here; the parts that pull real weight (isomorphic-git,
 * lightning-fs, the Anthropic SDK) are behind their own subpaths, so importing
 * a path rule does not drag a git implementation in with it:
 *
 *   @plinto/core/storage       the FileStore/GitStore factory
 *   @plinto/core/ops           content, media and repository operations
 *   @plinto/core/agents/…      translation and conflict resolution
 */

export type {
  ResolvedConfig, ResolvedI18n, ResolvedContent, ResolvedGit, ResolvedStorage,
} from './resolved-config';
export type {
  CollectionConfig, CollectionFieldConfig, PartialConfig, PageField,
} from './content-model';

export {
  localeDir, collectionDir, collectionsWithOwnDir,
  findPartial, partialForFile,
  pageContentPath, pageSlugOf,
  toContentPath, toFilePath, candidateFilePaths,
} from './layout';

export {
  pageRelPath, pageFieldsFor, allPageFieldKeys, sections, sectionForSlug,
  type Section,
} from './page-fields';

export { readFrontmatter, writeFrontmatter, type Frontmatter } from './frontmatter';
export { parseSyncMeta, setSyncMeta, syncMetaFromData, stripSyncMetadataLines, type SyncMeta } from './sync-meta';
export { createSettings, type Settings } from './settings';
export { UserFacingError } from './user-error';
export { parseGitHubRepo } from './github';
