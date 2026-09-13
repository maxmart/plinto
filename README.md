# Plinto

Plinto is a user-friendly admin UI for MDX[^1]-based Astro sites, bundled into the deployed site itself. 
It is built for the use case of having one frontend developer constructing the Astro site and React components, and other non-technical persons doing the editing. 

It uses [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git) to check out your git repo in-browser, so the deployed static site can edit itself and push. (Use LFS to avoid checking out media files)

It uses the [Puck editor](https://github.com/puckeditor/puck) to edit MDX pages with a visual block editor, where the blocks are your custom React components. 

It uses [Obelum](https://github.com/maxmart/obelum) to keep multi-lingual pages in sync with each other, by only taking the changes made and propagating them to the other languages using an agentic LLM. 

Everything about the *site* (routing, i18n, sitemap, redirects, styling) is ordinary
Astro config and ordinary site code. Plinto contributes only the *admin*. You can remove 
Plinto and the site still builds.

| package | what it is |
|---|---|
| [`@plinto/astro`](packages/astro) | what you install for an Astro site: the Astro integration, route shells, dev API, URL rules |
| [`@plinto/admin`](packages/admin) | the editing application: admin written in React, uses Puck editor and uses MDX as storage format. No opinion about the site generator |
| [`@plinto/core`](packages/core) | the engine: content model, browser-and-dev storage, operations, agents. Headless |
| [`examples/playground`](examples/playground) | a complete site to clone, with tests |

The adopter-facing story is in [`packages/astro/README.md`](packages/astro/README.md).

MIT.

[^1]: Currently we dont support root-level prose in MDX, so only React component tags.
