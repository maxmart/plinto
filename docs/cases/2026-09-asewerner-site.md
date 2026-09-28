# Case: adding Plinto to an existing site (asewerner-site, 2026-09)

The first time Plinto was added to a site that was not built for it, from npm rather
than through the workspace. Every problem below was hit for real, in that order of
discovery; each has the symptom, the cause as far as it was traced, what the site did
about it, and what Plinto could do instead.

The site: Astro 5, MDX pages made entirely of React blocks with JSON-serialisable
props (designed with Puck in mind), no Tailwind, one language (Swedish), served from a
GitHub Pages project subdirectory. Repo: `maxmart/asewerner-site`.

Plinto version: `@plinto/astro@0.2.0` from npm. The local source at 0.2.1 has the same
behaviour for everything below.

## Summary

| # | Problem | Severity | Silent? |
|---|---|---|---|
| 1 | Admin crashes in `astro dev` when installed from npm (CommonJS deps not pre-bundled) | Blocker | No, but misleading |
| 2 | Pages without block `id`s render every block as the last one | Blocker | **Yes** |
| 3 | Sites under a `base` path cannot use the admin at all | Blocker for those sites | Yes, links 404 |
| 4 | First save of a hand-written page rewrites its formatting | Surprise | Diff only |
| 5 | Save in dev mode commits immediately | Surprise | No |
| 6 | Tailwind setup for a site without Tailwind is underspecified | Friction | — |
| 7 | Site CSS from `previewPath` leaks into the admin list page | Cosmetic | — |
| 8 | No field for `string[]` or tuples | Friction | — |
| 9 | `@/*` tsconfig alias is required but not listed as required | Friction | Fails at save |
| 10 | Peer range needs Astro ≥ 6; the README's install line does not say so | Friction | npm says so |
| 11 | The "build-time ladder" for media is referenced but does not exist | Performance | Yes |
| 12 | Partials sharing a parent get page-sized overlays; the last one takes every click | Blocker for partials | Yes |
| 13 | Partials offer every block; no per-partial allow list | Friction | — |

What worked well is at the end.

## 1. Admin crashes in dev when installed from npm

**Symptom.** `/plinto/admin/` renders an empty page. Console:

```
[astro-island] Error hydrating /node_modules/@plinto/astro/src/islands/AdminIsland.tsx
SyntaxError: The requested module '/node_modules/gray-matter/index.js?v=…'
does not provide an export named 'default'
```

Adding `gray-matter` to `optimizeDeps.include` moved the crash one package down the
chain (`style-to-js/cjs/index.js`, via react-markdown → hast-util-to-jsx-runtime).

**Cause.** Installed from npm, the Plinto packages live in `node_modules` and ship `.ts`/
`.tsx` source. Vite serves those files raw (it does not pre-bundle them), and a bare
import *from a file inside node_modules* is not queued for pre-bundling. So every
CommonJS package reachable from Plinto's source is served as raw CJS to the browser.
Through a workspace link the Plinto packages count as source, Vite crawls their imports
and pre-bundles the CJS ones — which is why no existing Plinto site hits this.

It cannot currently be reproduced from the playground either: `examples/playground`
depends on `@plinto/astro ^0.2.1`, which is not on npm (latest is 0.2.0), so it only
installs through the workspace.

**Site workaround.** Pre-bundle Plinto's direct dependencies; that takes everything under
them along:

```js
optimizeDeps: {
  include: [
    '@isomorphic-git/lightning-fs', '@mdx-js/mdx', '@obelum/core', '@obelum/translator-claude',
    '@puckeditor/core', '@radix-ui/react-slot', '@tiptap/core', '@tiptap/extension-image',
    '@tiptap/react', '@tiptap/starter-kit', 'buffer', 'class-variance-authority', 'clsx',
    'estree-util-is-identifier-name', 'gray-matter', 'mime-types', 'react-markdown', 'remark',
    'remark-frontmatter', 'remark-gfm', 'remark-html', 'remark-mdx', 'remark-parse',
    'tailwind-merge', 'tiptap-markdown', 'turndown', 'turndown-plugin-gfm', 'unified',
  ],
},
```

**Suggested fix.** The integration already sets `optimizeDeps`; it could add this list
itself, derived from the packages' own `dependencies`. And a CI job that installs the
packed tarballs (`npm pack`) into a scratch site and loads `/plinto/admin/` would catch
the whole class — the workspace hides it.

## 2. Pages without block ids: every block becomes the last block

**Symptom.** Every page opens without an error, but the canvas shows the page's *last*
block repeated once per block (six `CtaBanner`s). Console, once per page:

```
Each child in a list should have a unique "key" prop.
Check the render method of `ul`. It was passed a child from StaticLayerTreeItems.
```

**Cause.** Puck keys and looks up blocks by `props.id`. The parser takes `id` only from
the MDX attributes, and hand-written pages have none, so every block's id is
`undefined` and every lookup finds the same one. The README says of existing pages
that "the block editor opens the pages that are made of blocks", which reads as
though they would just work.

**Site workaround.** Added `id="<Type>-<uuid>"` to all 51 blocks by script. One block
already had a meaningful `id` (an anchor, `erbjudande`), which was kept, since Puck only
needs uniqueness.

**Suggested fix.** In the parser, give a block without an `id` a fresh
`${type}-${uuid}` (what Puck does on insert), so the next save writes it. Failing that,
refuse the page with a clear message, the same way unrepresentable content is refused.
Silent mis-rendering is the worst of the three.

Related: sites that use `id` as a real prop (an anchor on a section) now share it with
Puck. Worth a sentence in the README: `id` is Puck's, and any block that also renders it
as an HTML id will get `Type-uuid` values in its markup.

## 3. A site under a `base` path cannot use the admin

**Symptom.** With `base: '/asewerner-site'` (a GitHub Pages *project* site) the admin
loads at `/asewerner-site/plinto/admin/`, but its links, previews and the dev API go to
the domain root and 404.

**Cause.** Root-relative paths are hardcoded: `/plinto/admin/…` and `/plinto/preview/…`
in `@plinto/admin` (ContentRow, EditorHeader, EditorPage, PreviewPage, AdminPage,
use-partial-link, CollectionPuckEditor, CollectionEditorPage) and in
`PreviewButton.astro`; `/api/plinto/files/` and `/api/plinto/git/` in
`@plinto/core/storage/*/http.ts`; `/media/` checks in the media fields. The integration
reads the Astro config but never looks at `base`.

**Site workaround.** None needed in the end: the site moved to its own domain, so it
sits at the root. Before that, the plan was to drop `base` in `astro dev` only.

**Suggested fix.** At minimum, throw in `astro:config:setup` when `astroConfig.base`
is not `/`, naming the limitation. Properly: prefix every one of those paths with
`import.meta.env.BASE_URL` (client) or the resolved base (integration).

## 4. The first save rewrites a hand-written page's formatting

**Symptom.** Opening a hand-written page and pressing Save without touching anything
produced a 33-line diff:

```diff
-import { DraftNote, PageHeader, ContactCards, CtaBanner, Rule } from '../components';
+import { ContactCards, CtaBanner, DraftNote, PageHeader, Rule } from '@/components';
-<PageHeader
-  id="PageHeader-…"
+<PageHeader id="PageHeader-…"
-  actions={[{ href: 'mailto:…', label: 'Skicka ett mejl' }]}
+  actions={[{"href":"mailto:…","label":"Skicka ett mejl"}]}
```

Content-equivalent: the site's rendered HTML was compared page by page before and
after, and was identical. A second save is then byte-identical, as promised.

**Cause.** The generator writes its canonical form. The README's promise ("a page it did
not change is written back byte-identical") holds only for files already in that form.

**Site workaround.** Normalised all six pages once, deliberately, so later edits are
small diffs.

**Suggested fix.** Say so in the README's "Existing pages" paragraph, and consider a
`plinto normalize` script so adopting sites can do the formatting commit on purpose
instead of mixing it into someone's first content edit. (Preserving the source text of
untouched blocks would be nicer still, but is a bigger change.)

One readability note: one-line JSON arrays make long props — a list of five cards with
paragraphs — into single 900-character lines. Fine for the editor, rough for anyone
reading a diff.

## 5. Save in dev mode commits

**Symptom.** Verifying the editor by pressing Save on six pages produced six local
commits ("Edit page/kontakt (sv)", …) authored with the machine's git identity.

The README does say that dev mode "commits with your own git", but it is easy to read
that as "you commit with your own git". In a verification session it meant cleaning up
afterwards.

**Suggested fix.** Make it explicit where the button is ("Save — commits to your local
branch"), or offer Save-without-commit in dev.

## 6. Tailwind for a site that has none

The admin needs Tailwind 3 with the shadcn-style theme extension (`bg-primary`,
`bg-accent`, … reading `hsl(var(--…))`). The README says to add the admin's source to
`content` and to import `@plinto/astro/styles/globals.css` from the site's layout.

For a site without Tailwind, that import would put Tailwind's preflight on every public
page. It turned out not to be needed: the injected routes import `globals.css`
themselves. The site installed `tailwindcss@3`, `postcss`, `autoprefixer`, a
`postcss.config.mjs`, and a `tailwind.config.mjs` that scans only Plinto's packages plus
the site's own editor fields. The public pages were then checked to load no Tailwind
CSS.

**Suggested fix.** In the README, separate "the admin needs Tailwind configured" from
"import globals.css in your layout (only if you use PreviewButton or `.plinto-header`)".
Ship the theme extension as a preset (`@plinto/astro/tailwind-preset`) rather than
having every site copy it from the playground.

## 7. Site CSS leaks into the admin list page

The preview shell (`previewPath`) imports the site's stylesheet so blocks are styled on
the canvas. That module is part of every admin route's bundle, so the site's
`body { font-family: … }` also restyles `/plinto/admin/` — the page list comes out in
the site's serif. The editor itself looked fine. Cosmetic, but it shows that site CSS
has no boundary on the admin routes.

## 8. No field for `string[]` or tuples

Puck's `array` field holds objects. Sites whose blocks take `points: string[]`,
`tags: string[]` or `paragraphs: string[]` must either change their prop shapes (and
every MDX file) or write a custom field. The site wrote `lines(label, { paragraphs })`,
a textarea with one item per line (or per blank-line-separated block) that stores a
`string[]`, plus a two-select field for a `[Ink, Ink]` tuple.

One detail worth copying if Plinto ships this: the textarea must keep its raw text in
local state. Splitting on every keystroke drops the empty line you just typed to start
the next item.

**Suggested fix.** A `stringList(label, { separator })` sentinel next to `richtext()` and
friends.

## 9. The `@/*` alias is effectively required

Generated imports use `@/…` because relative paths in the registry are rewritten to the
alias. A site without `"paths": { "@/*": ["./src/*"] }` in tsconfig will write imports
that do not resolve. The README mentions the alias only in the `pageLayout` comment.
It belongs in the required setup steps.

## 10. Peer range: Astro ≥ 6

`@plinto/astro` peers on `astro ^6 || ^7` and `@astrojs/react ^5`. A site on Astro 5
needs a major upgrade first (here: astro 6.4.8, @astrojs/mdx 5, @astrojs/react 5; it
built unchanged). The README's install line (`npm install @plinto/astro @astrojs/react
react react-dom`) does not mention it.

## 11. The "build-time ladder" does not exist

`downscale.ts` and `MediaBrowser.tsx` both justify bounding uploads at 2560 px with
"the build-time ladder can shrink what visitors download". No such ladder is in Plinto,
and none of the existing sites has one: their blocks render `<img src="/media/…">`, the
stored file as-is. A site moving from hand-built `srcset` images to the media picker
therefore sends a 1000–2560 px file to a 350 px slot, unless it builds its own.

The site built one (`integrations/media-ladder.mjs`, ~100 lines). At config time it
reads the size of every raster image in `public/media` and serves that as
`virtual:media-ladder`; after the build it writes `name-400w.webp`, `-800w`, `-1200w`
and `-1600w` next to each original in `dist/media/`, only those narrower than the
original. The site's `<Picture>` then emits a `srcset` of them in production, and
`width`/`height` whenever the size is known. In dev and in the editor it falls back to
the plain original, which also covers the editor's `blob:` URLs.

**Suggested fix.** Ship this in `@plinto/astro`, together with a `<MediaImage>` (or a
`srcset` helper) for blocks. It is what the upload bound already assumes exists.

## 12. Two partials under one parent: every click opens the last one

**Symptom.** With the header and footer as partials, hovering anywhere on the page in
the editor darkened the whole canvas, and clicking the header opened the **Footer**.

**Cause.** The overlay is positioned against the partial's *parent*
(`:has(> .plinto-partial-editable) { position: relative }`), because the marker
itself is `display: contents`. The site's preview shell rendered both partials as
siblings under the same parent:

```tsx
<>
  {topBar}
  <main>{children}</main>
  {footer}
</>
```

So both overlays were the size of the whole page, and the footer's, drawn last, took
every click. The playground and cupmanager do not hit this only because their shells
happen to wrap each partial in its own `<header>` / `<footer>`. Here the partial renders
its own `<header>`, so the shell had no reason to add one.

**Site workaround.** `<div>{topBar}</div>` and `<div>{footer}</div>`.

**Suggested fix.** Have `usePartial` return the partial inside a wrapper of its own
(a `display: contents` element cannot be the positioning context, but a
`position: relative` block element with no layout effect of its own can). Failing that,
the `usePartial` doc comment should say that each partial needs its own parent.

## 13. Partials inherit the whole block list

A partial's editor offers every registered block, so a page can get a `SiteHeader`
dropped into its middle and the footer can get a `Hero`. There is no way to say which
blocks belong to which partial, or that some blocks are partial-only. A per-partial
`allow` list (Puck slots already have `allow`/`disallow`) would fix it.

## Smaller things

- **Inline editing changes the prop type.** With `contentEditable: true`, Puck hands the
  block an `InlineTextField` element instead of the string. Blocks that key lists by
  text (`key={item.title}`) or process the string (a `*mark*` parser, `.slice()`) break
  quietly, with duplicate `[object Object]` keys or a thrown TypeError. That is Puck's
  behaviour, but a note next to the field helpers would save the next site the audit.

- The build prints warnings from Plinto's dependencies: @anthropic-ai/sdk's `node:fs`
  externalised, gray-matter's `eval`, chunk size, an empty `pro-light-svg-icons` chunk.
  Harmless, but a site's first Plinto build looks alarming.
- Admin pages have no favicon link, so the browser requests `/favicon.ico` (404).
- `smartypants: false` is required. Harmless here, since the pages had no prose, but on
  a site with markdown prose it changes rendered punctuation, and the README could say
  so for adopters.

## What worked well

- **The strict parser never refused a page.** Every prop was a literal (strings,
  numbers, arrays and objects of those), and all of it round-tripped.
- **Rendered output is unchanged.** Built HTML for all six pages was identical before
  and after normalisation, so the editor's rewrite never changed content.
- **Registry import derivation is clean.** A barrel (`import { Hero, … } from
  './components'`) just works and becomes `@/components` in pages.
- **`previewPath` gives a faithful canvas.** Rendering the site's real header and
  footer React components there made the editor look like the site.
- **The proxy template** (`examples/proxy`) was copy, edit two variables,
  `wrangler deploy`. It worked the first time, and the origin checks behaved as
  documented.
- **Config-time validation** (mdx registered, i18n present, routing manual, middleware
  exists) gave exact, actionable messages for everything it checks.

## How it was verified

`astro check` was clean after each step. After that:

- **Admin:** the page list was loaded in headless Chrome, and every page was opened in
  the editor and checked for console errors and correct block types on the canvas.
- **Save:** each page was saved once to normalise it, the built HTML was diffed against
  a pre-save build, and a second save was checked to change nothing.
- **Proxy:** tested with allowed and disallowed origins.
