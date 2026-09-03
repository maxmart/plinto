# @plinto/astro

**A Plinto site is a normal Astro MDX site with a nicer admin.**

Everything about the *site* — routing, i18n, sitemap, redirects, styling — is
ordinary Astro config and ordinary site code. Plinto contributes only the
*editing*:

- **Injected `/plinto/admin` routes** — a content admin mounted by the
  integration, no files copied into your project.
- **A visual block editor** (built on [Puck](https://puckeditor.com)) that
  reads and writes your MDX pages in place. The files it writes are files a
  person could also have typed — frontmatter, import statements, components —
  and a page it did not change is written back byte-identical.
- **Browser-side git** (isomorphic-git + lightning-fs): the *deployed static
  site* can clone its own repository into the browser, let an editor work,
  and commit and push the result. No server, no database — GitHub is the
  backend.
- **Translation sync**: every document carries a revision and a vector clock
  of what it has seen from its sibling languages. When a language goes stale,
  a Claude agent translates *what changed* — not the whole page — and the
  clock records it. Conflicting concurrent edits are merged by an agent that
  asks the editor plain-language questions when it cannot decide.

Plinto does no build-time output processing at all. Remove the integration and
your site still builds, byte for byte.

## How content is laid out

A page is one MDX file in Astro's own pages directory, and Astro renders it —
the URL *is* the file path:

```
src/pages/sv/index.mdx        ->  /sv/
src/pages/sv/streaming.mdx    ->  /sv/streaming/
src/partials/sv/TopBar.mdx        (no URL — the site's layout places it)
content/staff/sv/havard.mdx       (a collection entry — never routed)
```

Each page is self-contained: frontmatter naming its layout, then the import
statements for the blocks it uses, then the blocks:

```mdx
---
layout: '@/layouts/Layout.astro'
title: Streaming
rev: 3
synced: {en: 2}
---

import { CmFeatureRow } from '@example/blocks/CmFeatureRow';

<CmFeatureRow id="feat-8d1c4e7a" title="Livestreaming">
  Markdown between the tags, as usual.
</CmFeatureRow>
```

`rev` and `synced` are the translation sync's bookkeeping; everything else is
yours. The editor derives the import block from your block registry, so the
file stays valid however it is written.

## Adding plinto to an Astro site

```sh
npm install @plinto/astro @astrojs/react react react-dom
```

**1. astro.config.mjs** — declare your languages in Astro's own i18n config
(plinto reads it there; `routing: 'manual'` is required because the injected
admin routes live outside the locale tree), and register the integration:

```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import plinto from '@plinto/astro/integration';

export default defineConfig({
  i18n: { locales: ['en', 'sv'], defaultLocale: 'en', routing: 'manual' },
  integrations: [
    react(),
    mdx({ smartypants: false }),   // the editor round-trips these files;
                                   // rendered punctuation must match the bytes
    plinto({
      git: { corsProxy: 'https://your-proxy.example.workers.dev' },
      blocksPath: 'src/plinto-blocks.tsx',
    }),
  ],
});
```

That is the whole required config: a CORS proxy for browser-side git, and the
path to your block registry. Content directories (`src/pages`, `src/partials`,
`content`, `public/media`), the git branch, storage names, and language labels
all follow conventions and can be overridden only when your site differs.
Whether your default locale is URL-prefixed is not a setting either — the
filesystem states it: a `src/pages/{defaultLocale}/` directory exists exactly
when it is.

**2. src/middleware.ts** — Astro's manual i18n routing insists this file is
the site's own; it is a two-line re-export of plinto's passthrough:

```ts
export { onRequest } from '@plinto/astro/middleware';
```

**3. src/plinto-blocks.tsx** — the block registry. A block is a React
component with its editor config attached; the registry is a list of
components and nothing else:

```tsx
import type { BlockConfig, BlockRegistry } from '@plinto/astro/config';
import { richtext } from '@plinto/astro/config';

export const Hero = ({ title, body }: { title: string; body: string }) => (
  <section><h1>{title}</h1><p>{body}</p></section>
);
Hero.config = {
  fields: {
    title: { type: 'text', label: 'Title' },
    body: richtext('Body'),
  },
} satisfies BlockConfig<{ title: string; body: string }>;

export const blocks: BlockRegistry = { Hero };
```

Field sentinels — `richtext()`, `mediaPicker()`, `pageLink()` — declare the
plinto-aware field types; everything else is Puck's own field vocabulary.
Never declare an `id` field: Puck owns `props.id`.

**4. Run it.** `astro dev` and open `/plinto/admin`. In dev mode the admin
reads and writes your real working tree through the dev server and commits
with your own git. The deployed static site serves the same admin in browser
mode: it clones the repository into the browser (via the CORS proxy, with a
GitHub fine-grained PAT) and pushes commits back — pushing to the default
branch is publishing, if your CI deploys from it.

**Existing pages:** an already-MDX site keeps building unchanged from day
one. The block editor opens the pages that are made of blocks; a page of
loose prose is refused loudly rather than silently rewritten (the editor's
data model is blocks, and it never destroys what it cannot represent). Adopt
page by page: convert a page to blocks when you want it visually editable,
leave it as hand-written MDX when you don't.

### What you also need, honestly

- **One line of Vite config, because this package ships uncompiled source.**
  There is no build step: the `exports` map points at `.ts`, `.tsx` and
  `.astro` files under `src/`. The `.astro` routes have to ship that way —
  Astro compiles them itself — and the rest follows. So your bundler has to
  be told to transpile this package rather than treat it as ready-made
  JavaScript:

  ```js
  vite: {
    ssr: {
      noExternal: ['@plinto/astro', '@plinto/admin', '@plinto/core'],
    },
  }
  ```

  Every plinto package, not just the one you installed: they are all
  source-only. Leave `@plinto/astro` out and the build fails on the first
  `.tsx` it meets. Leave one of the others out and the build *passes* —
  Vite's bundler resolves it fine — and `astro dev` dies on "Cannot find
  module", because that path goes through Node's own ESM resolution instead.
- **A git CORS proxy.** Browsers cannot speak the git smart-HTTP protocol
  cross-origin; a ~30-line Cloudflare Worker forwards it. Any
  isomorphic-git-compatible proxy works.
- **Tailwind.** The admin UI is styled with Tailwind classes, and — more
  fundamentally — the editor canvas renders *your* blocks, so the editor
  route needs your site's compiled utilities either way. Your Tailwind
  config must scan the library alongside your own source:

  ```js
  content: [
    './src/**/*.{astro,js,ts,jsx,tsx,mdx}',
    './node_modules/@plinto/admin/src/**/*.{ts,tsx}',
    './node_modules/@plinto/astro/src/**/*.{astro,ts,tsx}',
  ],
  ```

  `@plinto/admin` is the one that matters — that is where the admin UI is.
  Missing it does not break loudly: the classes your own site happens to
  share are still generated, so the admin comes out *almost* right.

  and your site imports `@plinto/astro/styles/globals.css` (the Tailwind
  entry with the admin's design tokens) from its layout.
- **An Anthropic API key** per editor, for the translation sync and merge
  agents. Everything else — editing, saving, publishing — works without one.

## The pieces

This package is the **Astro adapter**, and it is the small one. Everything a
person clicks is `@plinto/admin`; the engine under that is `@plinto/core`, and
under that `@obelum/core`. A site imports none of them directly.

```
@plinto/astro          this package
  integration.ts        validates the site, injects routes, resolves config
                        into virtual:plinto-config
  plinto.ts              the composition root: reads that config once and
                        hands @plinto/admin the seven things only an Astro
                        adapter can know
  config.ts             the public config types and field sentinels
  islands/              four wrappers that mount an admin island inside its
                        runtime provider
  routes/               the injected .astro routes — fifteen lines each — and
                        the dev-only working-tree API
  lib/urls.ts           where a document is *served*: Astro's routing
  lib/listing/page-rules.ts   what Astro calls a page file
  lib/ops/index.ts      the published @plinto/astro/lib/ops, for your blocks
  lib/hooks/            what a block may call at build time and in the browser

@plinto/admin          the editing application, React, no
                      generator: the admin, the Puck editor, MDX ⇄ Puck,
                      the listing walks, the media browser

@plinto/core           headless: layout (where a document
                      lives), storage (dev-server HTTP or lightning-fs +
                      isomorphic-git), ops, agents, settings, frontmatter,
                      sync-meta, lfs

@obelum/core           vector-clock staleness, the anchored
                      diff, the lazy history cursor. Zero imports.
```

Three rules the layout serves. **Block and UI code go through `lib/ops`,
never the filesystem** — that is what makes the same editor work against a
dev server and against a repository cloned into the browser. **Everything in
`@plinto/core` takes its configuration as an argument**, so no module below
the adapter can reach for the site's directories or locales. And **what an
adapter has to supply is seven things** — see `AdminHost` in
`@plinto/admin` — which is the honest measure of how much of plinto is tied to
Astro at all. Counting runtime imports, there is no cycle at any level.

## Media

Media files are stored as git-LFS pointers; the bytes live in LFS. Uploads
are downscaled in the browser before anything is committed — LFS history is
immutable, so a 6 MB phone photo must never reach it. In browser mode the
bytes wait in IndexedDB until publish uploads them through the LFS batch API.

## Development

```sh
npm test          # vitest across every package — the sync engine, the MDX
                  # round-trip, the git store and its three-way merge, LFS,
                  # the layout rules
npx tsc --noEmit  # clean in each package, tests included
```

CI runs both of those plus a build of the playground on each
push and pull request. "It builds" is not the bar: the round trip is, and the
suite's own worst bug was a fixture that made half of it unreachable.

## License

MIT.
