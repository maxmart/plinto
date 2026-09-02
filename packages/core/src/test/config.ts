/**
 * The config the tests run against — a typical prefixed three-locale site.
 *
 * Typed as ResolvedConfig, so a change to the shape the integration produces
 * breaks here rather than at runtime, and usable two ways: directly by the
 * tests of anything that takes a config, and through virtual-plinto-config.ts,
 * which vitest aliases the virtual module id to.
 */
import type { ResolvedConfig } from '../resolved-config';

export const testConfig: ResolvedConfig = {
  i18n: {
    locales: ['sv', 'no', 'en'],
    defaultLocale: 'sv',
    labels: { sv: 'Svenska', no: 'Norsk', en: 'English' },
    prefixDefaultLocale: true,
  },
  content: {
    pagesDir: 'src/pages',
    partialsDir: 'src/partials',
    collectionsDir: 'content',
    mediaDir: 'public/media',
    siteSubdir: '',
  },
  git: {
    corsProxy: 'https://proxy.test',
    defaultBranch: 'main',
    defaultAuthorName: 'Plinto',
  },
  storage: {
    keyPrefix: 'test',
    fsDbName: 'test-fs',
    lfsDbName: 'test-lfs',
    repoDir: '/repo',
  },
  partials: [
    { name: 'topbar', file: 'TopBar.mdx', label: 'Top Bar' },
    { name: 'footer', file: 'Footer.mdx', label: 'Footer' },
  ],
};
