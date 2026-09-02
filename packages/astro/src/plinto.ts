/**
 * The one place the site's configuration enters, and where the editing
 * application is assembled for this site.
 *
 * `virtual:plinto-config` is a Vite virtual module, invisible to every tool
 * that draws an import graph — which is how thirty-seven modules could once
 * depend on the site's directory names with nothing showing it. Three modules
 * import it now, all of them composition roots, and this is the first.
 *
 * What it does is small, and that is the point: it reads the config, and hands
 * `@plinto/admin` the seven things only an Astro adapter can know. Everything
 * else the admin needs it builds for itself out of `@plinto/core`.
 */
import { blockImports } from 'virtual:plinto-config';
import { blocks } from 'virtual:plinto-blocks';
import { previewShell } from 'virtual:plinto-preview';
import { createAdminRuntime, type AdminHost } from '@plinto/admin/runtime';
import { config } from './lib/site-config';
import { toPageHref } from './lib/urls';
import { isRoutable, pageSlug } from './lib/listing/page-rules';

export { config } from './lib/site-config';

/**
 * Whether the Astro dev server is running — injected by Vite, true during
 * `astro dev` and false in the static build. Which storage mode the library
 * uses is the adapter's fact to state, not something the library sniffs for.
 */
export const dev: boolean = import.meta.env.DEV;

/**
 * Where a generated document imports each block's component from. Not part of
 * ResolvedConfig: the engine never reads it, and a map only the MDX generator
 * uses belongs beside the generator.
 */
export { blockImports } from 'virtual:plinto-config';

/**
 * What this adapter contributes. Seven members — the honest measure of how
 * much of plinto is actually Astro-shaped.
 */
const host: AdminHost = {
  config,
  dev,
  blocks,
  blockImports,
  previewShell,
  toPageHref,
  pageRules: { isRoutable, pageSlug },
};

/**
 * The editing application, bound to this site. The island wrappers in
 * `islands/` provide it to the React tree; nothing else should import it.
 */
export const plinto = createAdminRuntime(host);
