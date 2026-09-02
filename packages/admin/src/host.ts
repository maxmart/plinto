/**
 * What the editing application needs from the site generator underneath it.
 *
 * This is the whole of it — seven facts. Everything else the admin uses it
 * builds for itself out of `@plinto/core`, which is why this file is the honest
 * measure of how much of plinto is actually Astro-shaped: an adapter for
 * another generator would supply these and reuse the rest.
 *
 * The three that are not plain data are the ones that genuinely differ between
 * generators: what a URL looks like, what counts as a page file, and how the
 * site's own components reach the editor.
 */
import type { ComponentType, ReactNode } from 'react';
import type { ResolvedConfig } from '@plinto/core';
import type { BlockRegistry } from './blocks/registry';
import type { BlockImportMap } from './block-imports';

export interface AdminHost {
  /** The site's configuration, with every default applied and everything derived. */
  config: ResolvedConfig;

  /**
   * True when reads and writes go to a real working tree through a dev server,
   * false when the only storage is a repository cloned into this browser.
   * The adapter's fact to state — the storage layer does not sniff for it.
   */
  dev: boolean;

  /** The site's blocks: the components the editor offers and renders. */
  blocks: BlockRegistry;

  /** Where a generated document imports each block's component from. */
  blockImports: BlockImportMap;

  /**
   * The shell the editor and the preview draw around the page — the site's own
   * arrangement of its partials, as React. Null when the site has none, in
   * which case the canvas is shown on its own rather than the library
   * inventing a shell.
   */
  previewShell: ComponentType<{ children?: ReactNode }> | null;

  /**
   * The URL a page is served at. Routing, so it is the generator's: Astro's
   * answer is the pages directory read backwards, honouring the site's
   * trailingSlash.
   */
  toPageHref(contentPath: string, lang: string): string;

  /**
   * What the generator calls a page file. Astro skips `_`-prefixed names
   * ("not a route") and `[`-prefixed ones (dynamic routes), and collapses
   * `index` to the directory it sits in.
   */
  pageRules: {
    isRoutable(name: string): boolean;
    pageSlug(relative: string): string;
  };
}
