import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import plinto from '@plinto/astro/integration';

/**
 * The plinto playground — a small, publishable example site, and the fixture
 * corpus the library's tests walk.
 *
 * Everything here is ordinary Astro config; plinto's own config is close to
 * the minimum (a CORS proxy and the block registry). Content directories,
 * branch names and language labels all follow the conventions.
 */
export default defineConfig({
  // Astro's own i18n config is the authority on languages; plinto reads it
  // here. routing 'manual' switches Astro's URL enforcement off — file-based
  // routing already defines every URL, and plinto's /plinto/* admin routes live
  // outside the locale tree. src/middleware.ts re-exports plinto's
  // passthrough, which manual mode requires.
  //
  // The default locale is URL-prefixed, which is not a setting: the
  // src/pages/en/ directory states it. All three locales are symmetric,
  // which is what the translation corpus wants.
  i18n: {
    locales: ['en', 'sv', 'de'],
    defaultLocale: 'en',
    routing: 'manual',
  },
  integrations: [
    react(),
    // smartypants off: the editor round-trips these files, so what the page
    // renders must match the bytes on disk (no curly quotes the file doesn't
    // contain).
    mdx({ smartypants: false }),
    plinto({
      git: {
        corsProxy: 'https://atoll-proxy.cupmanager.workers.dev',
      },
      blocksPath: 'src/plinto-blocks.tsx',
      previewPath: 'src/plinto-preview.tsx',
      content: {
        pageLayout: '@/layouts/Layout.astro',
      },
      // Distinct from the sibling sites' so a local dev session of one never
      // clobbers another — dev serves them all from localhost.
      storageKey: 'playground',
    }),
  ],
  site: 'https://playground.plinto.example',
  output: 'static',
  vite: {
    css: {
      postcss: './postcss.config.mjs',
    },
    ssr: {
      // Every plinto package ships uncompiled source; leaving one out lets the
      // build pass and `astro dev` die on "Cannot find module".
      noExternal: ['@plinto/astro', '@plinto/admin', '@plinto/core', '@obelum/core'],
    },
  },
  srcDir: './src',
});
