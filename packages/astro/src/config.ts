/**
 * Plinto configuration types.
 *
 * Consumer sites import PlintoConfig from '@plinto/astro/config' in their
 * astro.config.mjs and pass a config object to the plinto() integration.
 * The integration provides those values to the library code via a Vite
 * virtual module ('virtual:plinto-config').
 */
import type { Slot, SlotComponent } from '@puckeditor/core';
import type { ComponentType } from 'react';

/**
 * What a document is — collections, partials, and the extra frontmatter
 * fields a page offers — is the content model, not an Astro option, so it is
 * declared in @plinto/core and re-exported here. A site still writes one
 * import to describe its content.
 */
export type {
  CollectionConfig, CollectionFieldConfig, PartialConfig, PageField,
} from '@plinto/core';
import type { CollectionConfig, PageField } from '@plinto/core';

export interface PlintoConfig {
  /**
   * Language display names, e.g. { sv: 'Svenska' }. Everything else about
   * languages — which locales exist, the default, whether the default is
   * prefixed — comes from Astro's own config: sites declare
   * `i18n: { locales, defaultLocale, routing: 'manual' }` in defineConfig and
   * the integration reads it there. `routing: 'manual'` is required because
   * plinto's injected admin routes live outside the locale tree and Astro's
   * built-in enforcement would 404 them; plinto supplies the passthrough
   * middleware manual mode demands. Whether the default locale is prefixed
   * is not a setting at all — it is read off the filesystem, which under
   * Astro's own convention already states it: `{pagesDir}/{defaultLocale}/`
   * exists exactly when the default locale is prefixed.
   */
  i18n?: {
    /**
     * Display labels for each locale. Defaults to each language's native
     * name via the platform's Intl.DisplayNames ('sv' → 'Svenska'), so this
     * exists only for overrides.
     */
    labels?: Record<string, string>;
  };

  /** Content file layout. Every directory has the conventional default. */
  content?: {
    /**
     * Astro's pages directory. Pages are `{pagesDir}/{lang}/{slug}.mdx`, with
     * `index.mdx` for the locale's home page — Astro's own routing, so a page's
     * URL is its path and nothing has to derive one from the other. Following
     * Astro's i18n convention, an unprefixed default locale's pages sit at the
     * pagesDir root instead of a `{lang}/` directory.
     *
     * Default: 'src/pages'
     */
    pagesDir?: string;
    /**
     * Directory holding the declared partials, as `{partialsDir}/{lang}/{file}`.
     * Deliberately outside `pagesDir`: everything under Astro's pages directory
     * is a route, and a top bar is not a page.
     *
     * Default: 'src/partials'
     */
    partialsDir?: string;
    /**
     * Layout a generated page names in its frontmatter, as the MDX file will
     * spell it.
     *
     * Use the tsconfig alias rather than a relative path: a page in a section —
     * `docs/{category}/{article}.mdx` — sits deeper than a top-level one, so no
     * single relative path is right for all of them. The alias is also what the
     * generated import statements use, so the two lines agree.
     *
     * Only used when the editor creates a page or repairs one that has no
     * layout of its own; existing frontmatter is passed through untouched. Omit
     * it and generated pages render without the site's shell.
     *
     * Example: '@/layouts/LangLayout.astro'
     */
    pageLayout?: string;
    /** Directory containing collection entries. Default: 'content' */
    collectionsDir?: string;
    /** Directory containing media files. Default: 'public/media' */
    mediaDir?: string;
    /** Optional per-collection editor configurations. Keyed by collection name. */
    collections?: Record<string, CollectionConfig>;
    /**
     * Extra page-frontmatter fields the editor offers beside the built-in
     * title/description, keyed by folder prefix, then by frontmatter key.
     *
     * The outer key is a path prefix below the locale directory: 'news/'
     * scopes its fields to src/pages/{lang}/news/*. The empty key '' means
     * every page. Deeper prefixes merge over shallower ones. Values on
     * non-matching pages are preserved, just not offered for editing.
     *
     * Type 'date' renders the datetime picker (stored as "YYYY-MM-DD", with
     * a time only when one was picked).
     *
     * Example:
     *   {
     *     '': { description: { type: 'textarea', label: 'Summary' } },
     *     'news/': { date: { type: 'date', label: 'Published' } },
     *     'jobs/': { date: { type: 'date', label: 'Publish date' } },
     *   }
     */
    pageFields?: Record<string, Record<string, PageField>>;
    /**
     * First-class page folders shown as their own admin tabs beside Pages.
     * A section's pages leave the Pages tab, list in `orderBy` order
     * ('-date' = frontmatter key `date`, descending — the key must exist in
     * the folder's pageFields), and get their own "+ New" button that
     * creates pages inside `folder`. Array order is the sidebar order.
     *
     * Example: [{ label: 'News', folder: 'news/', orderBy: '-date' }]
     */
    sections?: Array<{ label: string; folder: string; orderBy?: string }>;
  };

  /** Git configuration */
  git: {
    /** CORS proxy URL for browser-side git operations */
    corsProxy: string;
    /** Default branch name. Default: 'main' */
    defaultBranch?: string;
    /** Default author name when no admin-name is set. Default: 'Plinto' */
    defaultAuthorName?: string;
    /** Optional default repo URL shown in the admin setup flow */
    defaultRepoUrl?: string;
  };

  /**
   * Namespace for the browser-mode storage (localStorage keys, the
   * lightning-fs and LFS IndexedDB databases). Default: 'plinto'.
   *
   * Only matters when two plinto sites share an origin — in practice, local
   * dev serving several sites from localhost. Give each site its own key
   * there so one site's clone never clobbers another's.
   */
  storageKey?: string;

  /**
   * Path to a module default-exporting the shell the editor and preview draw
   * around the page — the site's own arrangement of its partials, as React.
   *
   * The real page is rendered by the site's Astro layout, which the browser
   * cannot run, so this is a second statement of that arrangement and can
   * drift from it. It is deliberately named for what it is: the editor's view.
   * What it buys over a declarative description is everything a layout knows
   * that a list cannot hold — order, wrapper elements, and per-partial detail.
   *
   * Omit it and the editor shows the page with no shell at all, rather than
   * the library inventing one.
   *
   * Example: 'src/plinto-preview.tsx'
   */
  previewPath?: string;

  /**
   * Path to the consumer site's blocks module (relative to the project root).
   * The referenced module MUST export `blocks: BlockRegistry`.
   *
   * Example: 'src/plinto-blocks.tsx'
   *
   * The integration re-exports from this path in the virtual module so that
   * React component references are preserved through Vite's module graph.
   */
  blocksPath: string;
}

/**
 * Blocks a generated page imports as Astro rather than React, as module
 * specifiers relative to the registry file:
 *
 *   export const astroBlocks: AstroBlockPaths = {
 *     CmNations: './components/blocks/CmNations.astro',
 *   };
 *
 * Paths rather than imports, because nothing loads these at runtime — the
 * editor and preview use the React component, and only the generated MDX
 * import statement points here. The integration verifies each path resolves.
 */
export type AstroBlockPaths = Record<string, string>;

/**
 * What a block is, and how a block declares its fields, is the editor's
 * vocabulary rather than Astro's — declared in @plinto/admin and re-exported
 * here so a site describing its blocks still writes one import.
 */
export type { BlockComponent, BlockRegistry, BlockConfig } from '@plinto/admin/blocks/registry';
export { richtext, mediaPicker, pageLink, iconPicker } from '@plinto/admin/blocks/registry';
