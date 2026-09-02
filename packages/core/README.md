# @plinto/core

The engine under an plinto CMS: what a document is and where it lives, the two
storage modes, the operations a CMS performs on content and on its repository,
and the Claude agents that translate and resolve merges.

It imports nothing from any site generator. `@plinto/astro` is one adapter over
this — the only one today, and the reason the boundary exists is not to invite
a second one but to keep the engine honest about what it actually needs.

## The shape

Everything takes its configuration as an argument. There is no module anything
can reach into for the site's directories or locales:

```ts
import { toFilePath, type ResolvedConfig } from '@plinto/core';
import { createStores } from '@plinto/core/storage';
import { createContentOps } from '@plinto/core/ops';

const stores = createStores(config, { dev: false, settings });
const content = createContentOps({ config, stores });

await content.editContent('page/support', 'sv', mdx);
```

A `ResolvedConfig` is the config with every default already applied and
everything derived already derived — the adapter's job is to produce one.

## The layers

```
agents/     translation and conflict resolution, driven by Claude
   |        (declares what it needs from ops; imports none of it)
ops/        content, media and repository operations, in CMS vocabulary
   |
storage/    FileStore + GitStore — HTTP to a dev server, or
   |        lightning-fs + isomorphic-git in the browser
layout/     where a document lives: contentPath <-> file path
```

Plus the pieces with no layer of their own: `frontmatter` (one reader, one
writer, both gray-matter), `sync-meta` (the vector clock's storage format),
`settings` (the `Settings` port and its localStorage implementation), `lfs`
(git-LFS pointers, hashing, the batch API), and `content-model` (what a
collection, a partial and a page field are).

The vector-clock sync engine itself is a package further down still:
[`@obelum/core`](../translation), 407 lines with zero imports of any kind.

## What is not here

Anything about a *site*: routing, URLs, the admin UI, the block editor, the
MDX↔Puck conversion, the Astro integration. Those are `@plinto/astro`.
