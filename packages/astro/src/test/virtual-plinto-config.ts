/**
 * Test double for virtual:plinto-config. In a running site the plinto
 * integration generates this module from the site's config; under vitest
 * there is no integration, so vitest.config.ts aliases the virtual id here.
 *
 * The values themselves live in ./config, typed, so the fixture and anything
 * a test constructs directly cannot drift apart.
 */
import { testConfig } from '@plinto/core/test/config';
import type { BlockImportMap } from '@plinto/admin/block-imports';

export const { i18n, content, git, storage, partials } = testConfig;

/** What the sites this was built for set; it is Astro's default that differs. */
export const trailingSlash = 'always' as const;

/**
 * Where a generated document imports each block from — the adapter's, not the
 * engine's, so it is declared here rather than in core's fixture. Two of these
 * omit `export`, which is what a default import looks like: the .astro block
 * components are declared that way, and a fixture where every entry has one
 * would never exercise the branch.
 */
export const blockImports: BlockImportMap = {
  CmHero: { module: '@example/blocks/CmHero', export: 'CmHero' },
  CmText: { module: '@example/blocks/CmText', export: 'CmText' },
  CmColumns: { module: '@example/blocks/CmColumns', export: 'CmColumns' },
  CmColumn: { module: '@example/blocks/CmColumns', export: 'CmColumn' },
  // No `export`: a default import, which is how the .astro block components
  // are declared. Present so the generator's default-import branch is
  // reached through the real wiring — the composition root's re-export of
  // the virtual module — and not only through renderImportBlock's own unit
  // test, which passes the map in as an argument and never touches it.
  CmNations: { module: '@/components/blocks/CmNations.astro' },
};
