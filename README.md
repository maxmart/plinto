# Plinto

Plinto is an admin UI for Astro MDX sites, bundled into the deployed site itself: git-backed content, a visual block editor, and surgical AI translations driven by vector clocks.

**A Plinto site is a normal Astro MDX site with a nicer admin.** Everything
about the *site* (routing, i18n, sitemap, redirects, styling) is ordinary
Astro config and ordinary site code. Plinto contributes only the *editing*:
injected `/plinto/*` admin routes, a Puck-based visual editor, browser-side
git (the deployed static site can edit itself and push), and translation
sync that carries what changed in one language into the others. Remove the
integration and the site still builds, byte for byte.

| package | what it is |
|---|---|
| [`@plinto/astro`](packages/astro) | what a site installs: the Astro integration, route shells, dev API, URL rules |
| [`@plinto/admin`](packages/admin) | the editing application: admin, Puck editor, MDX ⇄ Puck. React, no opinion about the site generator |
| [`@plinto/core`](packages/core) | the engine: content model, browser-and-dev storage, operations, agents. Headless |
| [`examples/playground`](examples/playground) | a complete site to clone, and the corpus the tests walk |

Translation tracking is [Obelum](https://github.com/maxmart/obelum): core
depends on `@obelum/core` for vector clocks and diffs and on
`@obelum/translator-claude` for the translating. Plinto adapts them to MDX
documents in `packages/core/src/agents/translate.ts`; nothing in Obelum knows
what MDX is.

## Developing

Obelum is not on npm yet. Check out both repos side by side under one npm
workspace root and install there, never inside one repo:

```
workspace/
  package.json      { "workspaces": ["obelum/packages/*", "plinto/packages/*", "plinto/examples/*"] }
  obelum/
  plinto/
```

```sh
npm install                 # at the workspace root
cd plinto
npm test
npm run typecheck
npm run build               # builds examples/playground
cd examples/playground && npm run dev
```

The adopter-facing story is in [`packages/astro/README.md`](packages/astro/README.md).

MIT.
