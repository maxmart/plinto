# Plinto

Plinto is an admin UI for MDX-based Astro sites, bundled into the deployed site itself. It checks out your git repo in-browser with LFS support, so the deployed static site can edit itself and push. It lets you edit MDX pages with a visual block editor, where the blocks are your custom React components. It uses Obelum library to keep multi-lingual pages in sync with each other, by only taking the changes made and propagating them to the other languages using an agentic LLM. 

It is built for the use case of having one frontend developer team/person constructing the Astro site and React components, and one non-technical team/person doing the editing. 

Everything about the *site* (routing, i18n, sitemap, redirects, styling) is ordinary
Astro config and ordinary site code. Plinto contributes only the *admin*. You can remove the
Plinto and the site still builds.

| package | what it is |
|---|---|
| [`@plinto/astro`](packages/astro) | what you install for an Astro site: the Astro integration, route shells, dev API, URL rules |
| [`@plinto/admin`](packages/admin) | the editing application: admin written in React, uses Puck editor and uses MDX as storage format. No opinion about the site generator |
| [`@plinto/core`](packages/core) | the engine: content model, browser-and-dev storage, operations, agents. Headless |
| [`examples/playground`](examples/playground) | a complete site to clone, and the corpus the tests walk |

Translation tracking is done using [Obelum](https://github.com/maxmart/obelum): core
depends on `@obelum/core` for the synced copies, staleness and diffs and on
`@obelum/translator-claude` for the translating. 


The adopter-facing story is in [`packages/astro/README.md`](packages/astro/README.md).

MIT.
