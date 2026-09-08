# @plinto/core

Part of [Plinto](https://github.com/maxmart/plinto), an admin UI for Astro MDX sites bundled into the deployed site itself. The [repository README](https://github.com/maxmart/plinto#readme) says what Plinto is and how the packages fit together; this one covers the package.

The engine under a plinto CMS: what a document is and where it lives, the two
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
writer, both gray-matter), `settings` (the `Settings` port and its
localStorage implementation), `lfs` (git-LFS pointers, hashing, the batch
API), and `content-model` (what a collection, a partial and a page field are).

The sync engine itself is a package further down still:
[`@obelum/core`](https://github.com/maxmart/obelum). Every language keeps a
copy of every language's file as of the last time it looked, under
`.obelum/<lang>/` at the repository root; staleness and the translator's brief are diffs
against those copies, and nothing is stamped into the documents.

## What is not here

Anything about a *site*: routing, URLs, the admin UI, the block editor, the
MDX↔Puck conversion, the Astro integration. Those are `@plinto/astro`.
