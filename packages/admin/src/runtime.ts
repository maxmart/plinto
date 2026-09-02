/**
 * The editing application, assembled.
 *
 * An adapter supplies an `AdminHost` — the seven things only it can know — and
 * gets back everything the admin runs on: the storage for the mode it is in,
 * the operations layer over that storage, the agents above it, the MDX
 * conversion bound to this site's blocks, and the layout rules bound to its
 * config.
 *
 * This is a composition root, and the only one in the package. Nothing under
 * `components/` reaches for a configured instance; it is handed this through
 * React context, or given the parts it needs as arguments.
 */
import { createStores, type Stores } from '@plinto/core/storage';
import { createContentOps } from '@plinto/core/ops/content';
import { createMediaOps } from '@plinto/core/ops/media';
import { createRepoOps } from '@plinto/core/ops/repo';
import { createSettings, type Settings } from '@plinto/core/settings';
import * as layout from '@plinto/core/layout';
import * as fields from '@plinto/core/page-fields';
import * as translate from '@plinto/core/agents/translate';
import * as conflict from '@plinto/core/agents/conflict';
import type { ConflictFile } from '@plinto/core/storage/git-store/types';
import type { Data } from '@puckeditor/core';
import type { Frontmatter } from '@plinto/core';
import type { AdminHost } from './host';
import { richtextFieldsOf } from './mdx/richtext-fields';
import { blockComponentsOf } from './blocks/components';
import { parseMdx, type ParseOptions, type ParsedMdx } from './mdx/parser';
import { puckToMdx } from './mdx/generator';

export type { AdminHost } from './host';

export type AdminRuntime = ReturnType<typeof createAdminRuntime>;

export function createAdminRuntime(host: AdminHost) {
  const { config, dev, blocks, blockImports } = host;

  // This browser's stored credentials — the port the storage layer takes.
  const settings: Settings = createSettings(config.storage.keyPrefix);

  // One storage for the mode we are in, and one of each store within it:
  // BrowserFileStore caches blob URLs, and two GitStores over one repository
  // means two merge sessions, where the one holding a pending merge may not be
  // the one everything else is talking to.
  const stores: Stores = createStores(config, { dev, settings });

  const media = createMediaOps({ config, stores, settings });
  const ops = {
    ...createContentOps({ config, stores }),
    ...media,
    ...createRepoOps({ config, stores, settings, media }),
    stores,
  };

  // The agent layer sits above ops and imports none of it: it declares what it
  // needs and this is where it is supplied.
  const agents = {
    runTranslation: (
      opts: translate.RunTranslationOptions,
      callbacks: translate.RunTranslationCallbacks,
    ) => translate.runTranslation({
      locales: config.i18n.locales,
      getContent: ops.getContent,
      syncContent: ops.syncContent,
      resolveFilePath: ops.resolveFilePath,
      commits: () => stores.getGitStore(),
    }, opts, callbacks),

    /** The `onConflict` a pull or push takes, backed by Claude and this browser's key. */
    resolveConflictsWithClaude: (
      conflicts: ConflictFile[],
      opts: conflict.ResolveConflictsOptions = {},
    ) => conflict.resolveConflictsWithClaude(conflicts, settings.apiKey(), opts),
  };

  // Which fields hold richtext, from this site's registry. Derived once: the
  // parser and the generator take the rule as an argument precisely so it can
  // be derived somewhere a test can also reach.
  const richtextFields = richtextFieldsOf(blocks);
  const mdx = {
    parse: (source: string, options: Omit<ParseOptions, 'richtext' | 'pageFieldKeys'> = {}): ParsedMdx =>
      parseMdx(source, {
        ...options,
        richtext: richtextFields,
        pageFieldKeys: fields.allPageFieldKeys(config),
      }),
    generate: (data: Data, frontmatter?: Frontmatter): string =>
      puckToMdx(data, frontmatter, { richtext: richtextFields, blockImports }),
    richtextFields,
  };

  return {
    ...host,
    settings,
    ops,
    agents,
    mdx,

    /** Every block, with media-declaring ones wrapped to resolve their paths. */
    blockComponents: blockComponentsOf(blocks, ops.getMediaUrl),

    /** Display label for a language — the site's override, or its native name. */
    langLabel: (code: string) => config.i18n.labels[code] ?? code.toUpperCase(),

    // The layout rules, bound. Where a document lives; `host.toPageHref` is
    // where it is served.
    localeDir: (lang: string) => layout.localeDir(config, lang),
    collectionDir: (name: string) => layout.collectionDir(config, name),
    findPartial: (name: string) => layout.findPartial(config, name),
    partialForFile: (file: string) => layout.partialForFile(config, file),
    toContentPath: (file: string) => layout.toContentPath(config, file),
    toFilePath: (contentPath: string, lang: string) => layout.toFilePath(config, contentPath, lang),
    candidateFilePaths: (contentPath: string, lang: string) => layout.candidateFilePaths(config, contentPath, lang),
    pageContentPath: layout.pageContentPath,
    pageSlugOf: layout.pageSlugOf,

    // The site's declared page fields and sections, resolved.
    pageRelPath: (filePath?: string) => fields.pageRelPath(config, filePath),
    pageFieldsFor: (relPath: string | undefined) => fields.pageFieldsFor(config, relPath),
    allPageFieldKeys: () => fields.allPageFieldKeys(config),
    sections: () => fields.sections(config),
    sectionForSlug: (slug: string) => fields.sectionForSlug(config, slug),
  };
}
