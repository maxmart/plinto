# @plinto/admin

Plinto's editing application: the admin, the Puck editor over MDX, the media
browser, the translation and publish flows — everything a person clicks.

It is React and it knows nothing about any site generator. `@plinto/astro` is
one adapter over it; the four routes that adapter injects are fifteen lines
each, and they mount the islands in here.

## What an adapter has to supply

Seven things, and that list is the honest measure of how much of plinto is
tied to a particular site generator:

```ts
export interface AdminHost {
  config: ResolvedConfig;       // the site's directories, locales, git, storage
  dev: boolean;                 // working tree through a dev server, or a clone in the browser
  blocks: BlockRegistry;        // the site's own components
  blockImports: BlockImportMap; // where a generated document imports each from
  previewShell: ComponentType | null;

  // The three that genuinely differ between generators:
  toPageHref(contentPath, lang): string;
  pageRules: { isRoutable(name): boolean; pageSlug(relative): string };
}
```

Everything else the admin builds for itself out of [`@plinto/core`](../plinto-core):
the storage for the mode it is in, the operations layer over it, the agents
above that, the MDX conversion bound to this site's blocks, and the layout
rules bound to its config.

```ts
import { createAdminRuntime } from '@plinto/admin/runtime';
import { PlintoProvider } from '@plinto/admin/context';
import AdminPage from '@plinto/admin/components/islands/AdminPage';

const plinto = createAdminRuntime(host);

<PlintoProvider runtime={plinto}><AdminPage /></PlintoProvider>
```

## Why context, and not an import

The runtime reaches components through React context, which is the whole
difference between an application any adapter can mount and one that can only
be mounted by the adapter it was written beside. The islands are the
composition roots: an adapter wraps its own entry point in the provider,
because an island's props are serialized and a runtime is functions and
component references.

The five modules that are not components — the translation queue, the listing
walk, the collection config, and the two halves of the MDX conversion — take
what they need as arguments instead. `parseMdx` and `puckToMdx` are the
sharpest case: both require the richtext rule and the import map, because a
default for either silently produces the wrong file.

## The pieces

```
runtime.ts        createAdminRuntime(host) — the only composition root here
host.ts           what an adapter must supply
context.tsx       PlintoProvider / usePlinto()
components/
  islands/        AdminPage, EditorPage, CollectionEditorPage, PreviewPage
  admin/          the admin's own chrome and its two state machines
  puck/           the Puck config built from the site's block registry
mdx/              MDX ⇄ Puck: the round-trip parser (over remark-mdx, the same
                  parser Astro compiles with), the generator, and the
                  markdown ⇄ HTML boundary richtext crosses
listing/          walking pages and collections for the admin's lists
blocks/           field walks, media-path resolution, the registry types
preview.tsx       the shell the editor and preview draw around a page
```

## License

MIT.
