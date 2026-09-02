/**
 * Plinto Astro integration.
 *
 * Consumer sites use this in their astro.config.mjs:
 *
 *   import plinto from '@plinto/astro/integration';
 *   export default defineConfig({
 *     i18n: { locales: ['en', 'es'], defaultLocale: 'en', routing: 'manual' },
 *     integrations: [
 *       mdx({ smartypants: false }),
 *       plinto({
 *         git: { corsProxy: 'https://your-proxy.example.workers.dev' },
 *         blocksPath: 'src/plinto-blocks.tsx',
 *       }),
 *     ],
 *   });
 *
 * The integration provides the config to library code via a Vite virtual
 * module named 'virtual:plinto-config'. Library modules import from it
 * normally; Vite resolves it at build time using a plugin registered
 * by this integration.
 */
import type { AstroIntegration } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { PlintoConfig } from './config';
import { deriveBlockImports } from './lib/block-imports.node';
import { derivePartials } from './lib/partials.node';

// Resolve isomorphic-git's ESM sibling (`index.js`) to work around its
// broken `exports` field, which only exposes the Node-only CJS bundle and
// crashes in browsers with "createHash is not a function".
//
// Full explanation, alternatives tried (notably why NOT vite-plugin-node-
// polyfills), and removal criteria live in `docs/compat-vite-node-polyfills.md`.
// Read that before touching this code or adding similar aliases for other
// Webpack-era packages (object-hash from Puck is a latent one).
const require = createRequire(import.meta.url);
const ISOMORPHIC_GIT_ESM = (() => {
  try {
    const cjsPath = require.resolve('isomorphic-git');
    return path.join(path.dirname(cjsPath), 'index.js');
  } catch {
    return null;
  }
})();

/**
 * Font Awesome Pro is a paid, private-registry package — declared as an
 * optional dependency of @plinto/admin, so a machine without a Font Awesome
 * token still installs. The icon field imports it lazily, but a lazy import is
 * still an import Rollup must resolve at build time, so on a machine where the
 * package is absent the build needs a stub in its place: the picker then
 * searches an empty set instead of the site failing to build. Resolved once,
 * here, because this is the only module that can put either answer into the
 * site's Vite config.
 */
/**
 * The sliver of esbuild's plugin API the dep-optimiser hook below uses. Typing
 * it here keeps `esbuild` out of this package's dependencies — Vite carries it,
 * and plinto should not name a build tool it never calls.
 */
interface EsbuildPluginBuild {
  onResolve(
    options: { filter: RegExp },
    callback: (args: { path: string }) => { path: string; external: boolean },
  ): void;
}

/**
 * The slice of Vite's hot-update context the editor-save hook uses. Structural,
 * for the same reason as EsbuildPluginBuild: plinto should not depend on vite's
 * types to name two fields.
 */
interface EditorSaveHotContext {
  file: string;
  server: { hot: { send(payload: { type: 'full-reload'; path: string }): void } };
}

const FONTAWESOME_PKG = '@fortawesome/pro-light-svg-icons';
const FONTAWESOME_AVAILABLE = (() => {
  try {
    require.resolve(FONTAWESOME_PKG);
    return true;
  } catch {
    return false;
  }
})();

const VIRTUAL_MODULE_ID = 'virtual:plinto-config';
/**
 * The site's preview shell gets a module of its own rather than riding along
 * with the config.
 *
 * Re-exporting it from virtual:plinto-config would put that module in a cycle:
 * config -> the site's shell -> @plinto/astro/preview -> ops -> config. ESM
 * hoists `export … from` above every `const`, so the config's own primitives
 * are still uninitialised when ops asks for them, and the build dies on
 * "Cannot access 'storage' before initialization". Nothing in this second
 * module reads a binding at module scope, so it can sit in a cycle harmlessly.
 */
const VIRTUAL_PREVIEW_ID = 'virtual:plinto-preview';
/**
 * The block registry gets a module of its own, for the same reason and a
 * costlier one.
 *
 * `virtual:plinto-config` is otherwise seven JSON constants — the kind of thing
 * a site's own code can import anywhere. The registry is not: it is a live
 * re-export of React component references, so importing it pulls every block,
 * and through Puck's field types, Puck. While the two shared a module, one
 * client script that wanted `content.pagesDir` got all of it: the preview
 * button's script imports the config, and that made a **354 KB** chunk load
 * on 81 of cupmanager's 86 pages, for a button only an editor can use.
 *
 * Nothing about that was visible in the source. It took building the site and
 * reading what the HTML asks for.
 *
 * So: primitives here, live references there. The rule for anyone adding an
 * export — if it cannot survive JSON.stringify, it does not belong in the
 * config module.
 */
const VIRTUAL_BLOCKS_ID = 'virtual:plinto-blocks';
// Vite convention: resolved virtual module IDs start with '\0' so other
// plugins know not to try filesystem operations on them.
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;
const RESOLVED_VIRTUAL_PREVIEW_ID = '\0' + VIRTUAL_PREVIEW_ID;
const RESOLVED_VIRTUAL_BLOCKS_ID = '\0' + VIRTUAL_BLOCKS_ID;

/**
 * The path from the git repository root down to the site, '' when the site is
 * the repo root. Not a setting: the filesystem states it. The browser stores
 * clone the whole repo into lightning-fs and translate every site-relative
 * path with this.
 */
function deriveSiteSubdir(projectRoot: string): string {
  let dir = path.resolve(projectRoot);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return path.relative(dir, projectRoot).replace(/\\/g, '/');
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // No repo above us. For a site that IS its repo's root this is the
      // right answer anyway; for a monorepo site built from an exported
      // tree (git archive, .dockerignore'd .git) it bakes the wrong paths
      // into the browser admin — say so instead of failing silently later.
      console.warn(
        '[@plinto/astro] no .git directory found above the project — assuming the site is the ' +
        'repository root. If this site lives in a subdirectory of its repo, build from a git checkout.',
      );
      return '';
    }
    dir = parent;
  }
}

/** Native display name for a locale ('sv' → 'Svenska'), capitalized. */
function nativeLabel(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    return locale;
  }
}

export default function plinto(config: PlintoConfig): AstroIntegration {
  return {
    name: '@plinto/astro',
    hooks: {
      'astro:config:setup': ({ command, updateConfig, injectRoute, config: astroConfig }) => {
        // The site registers @astrojs/mdx itself (with smartypants off — the
        // editor round-trips this content, so rendered punctuation must match
        // the bytes in the file). Plinto only checks it wasn't forgotten:
        // without it every .mdx page is served as unparsed text.
        if (!astroConfig.integrations.some(i => i.name === '@astrojs/mdx')) {
          throw new Error(
            '[@plinto/astro] @astrojs/mdx is not registered. Add `mdx({ smartypants: false })` ' +
            'to your integrations before plinto() — plinto no longer registers it for you.',
          );
        }

        // Languages come from Astro's own i18n config — the site declares
        // them once, in defineConfig, in Astro's vocabulary. routing must be
        // 'manual': plinto's injected admin routes live outside the locale
        // tree and Astro's built-in enforcement 404s them (verified: with
        // pathname-prefix-always the dev router rejects /plinto/admin).
        // Manual mode requires the site to have a middleware file; the check
        // below explains the two-line re-export it needs.
        if (!astroConfig.i18n) {
          throw new Error(
            "[@plinto/astro] No i18n config. Declare it in Astro's own config: " +
            "defineConfig({ i18n: { locales: [...], defaultLocale: '...', routing: 'manual' } }).",
          );
        }
        if (astroConfig.i18n.routing !== 'manual') {
          throw new Error(
            "[@plinto/astro] i18n.routing must be 'manual': Astro's built-in i18n " +
            'enforcement 404s the injected /plinto/* admin routes.',
          );
        }
        // Astro insists the manual-mode middleware is the site's own file —
        // integration-added middleware does not satisfy its check. The file
        // is a two-line re-export of plinto's passthrough.
        const srcDir = fileURLToPath(astroConfig.srcDir);
        if (!['ts', 'js', 'mts', 'mjs'].some(ext => fs.existsSync(path.join(srcDir, `middleware.${ext}`)))) {
          throw new Error(
            "[@plinto/astro] i18n.routing 'manual' requires src/middleware.ts. Create it with:\n" +
            "  export { onRequest } from '@plinto/astro/middleware';",
          );
        }
        // Astro allows { path, codes } locale objects; plinto thinks in the
        // path form, which is also what the directory names are.
        const locales = astroConfig.i18n.locales.map(l => (typeof l === 'string' ? l : l.path));
        const defaultLocale = astroConfig.i18n.defaultLocale;

        // astroConfig.root is a URL pointing to the project root.
        const projectRoot = fileURLToPath(astroConfig.root);

        // ── Resolve config over the conventions ─────────────────────────
        const content = {
          pagesDir: 'src/pages',
          partialsDir: 'src/partials',
          collectionsDir: 'content',
          mediaDir: 'public/media',
          ...config.content,
          siteSubdir: deriveSiteSubdir(projectRoot),
        };
        const git = {
          defaultBranch: 'main',
          defaultAuthorName: 'Plinto',
          ...config.git,
        };
        // One namespace for all browser-side storage. Only matters when two
        // plinto sites share an origin (local dev on localhost).
        const key = config.storageKey ?? 'plinto';
        const storage = {
          keyPrefix: key,
          fsDbName: `${key}-fs`,
          lfsDbName: `${key}-lfs`,
          repoDir: '/repo',
        };
        // Labels default to each language's own name for itself; the config
        // only overrides.
        const labels = {
          ...Object.fromEntries(locales.map(l => [l, nativeLabel(l)])),
          ...config.i18n?.labels,
        };

        // Whether the default locale is prefixed is not a setting — the
        // filesystem already states it, per Astro's own convention: a
        // `{pagesDir}/{defaultLocale}/` directory exists exactly when the
        // default locale is prefixed. (An unprefixed site would have to name
        // a content section after its own default locale to fool this, which
        // is its own problem.)
        const prefixDefaultLocale = fs.existsSync(
          path.resolve(projectRoot, content.pagesDir, defaultLocale),
        );

        // Inject the library's CMS routes. Each consumer site that registers
        // the plinto() integration gets these routes mounted automatically.
        //
        // The package-specifier entrypoints resolve through the @plinto/astro
        // exports field in package.json. Probe in Astro 6.1.4 confirmed this
        // works for both .astro and .ts route files.
        injectRoute({
          pattern: '/plinto/admin',
          entrypoint: '@plinto/astro/routes/admin.astro',
          prerender: true,
        });
        injectRoute({
          pattern: '/plinto/admin/edit',
          entrypoint: '@plinto/astro/routes/edit.astro',
          prerender: true,
        });
        injectRoute({
          pattern: '/plinto/admin/edit-collection',
          entrypoint: '@plinto/astro/routes/edit-collection.astro',
          prerender: true,
        });
        injectRoute({
          pattern: '/plinto/preview',
          entrypoint: '@plinto/astro/routes/preview.astro',
          prerender: true,
        });

        // The dev API — reads and writes against the real working tree — only
        // exists while `astro dev` runs. Not injecting it during builds is
        // what lets a site build with no adapter at all: with the on-demand
        // routes absent, the whole output is prerendered static files.
        if (command === 'dev') {
          injectRoute({ pattern: '/api/plinto/files', entrypoint: '@plinto/astro/routes/api/files' });
          injectRoute({ pattern: '/api/plinto/git', entrypoint: '@plinto/astro/routes/api/git' });
        }

        const absoluteBlocksPath = path.resolve(projectRoot, config.blocksPath);

        // Generated import specifiers must use file:// URLs to work
        // cross-platform (Windows paths with backslashes break in
        // import statements; file:// URLs are universal).
        const blocksUrl = pathToFileURL(absoluteBlocksPath).href;

        // Where each block's component is imported from, for generated MDX.
        // Derived here because the generator runs in the browser and cannot
        // read the registry off disk; it travels with the rest of the config.
        const blockImports = deriveBlockImports(absoluteBlocksPath);

        // Partials, found by reading the directory rather than declared. Same
        // reason as above: the admin needs the list synchronously in a browser
        // with no filesystem, so it is resolved here and shipped with the config.
        const partials = derivePartials(
          path.resolve(projectRoot, content.partialsDir),
          locales,
        );

        // Nothing may claim two addresses. A document's contentPath is either
        // `page/{slug}`, `{collection}/{slug}` or a bare partial name, so a
        // collection called 'page', or a partial whose derived name is also a
        // collection's, makes one string mean two documents — and the
        // ambiguity surfaces as the wrong file being read, silently. This is
        // the only place that can see all three at once.
        const collectionNames = Object.keys(content.collections ?? {});
        if (collectionNames.includes('page')) {
          throw new Error(
            `[@plinto/astro] "page" is reserved as a collection name: a document's ` +
            `address is either page/{slug} or {collection}/{slug}, so the two would ` +
            `be the same string. Rename the collection.`,
          );
        }
        const shadowed = partials.find(p => collectionNames.includes(p.name) || p.name === 'page');
        if (shadowed) {
          throw new Error(
            `[@plinto/astro] partial ${shadowed.file} resolves to the name "${shadowed.name}", ` +
            `which is already ${shadowed.name === 'page' ? 'reserved for pages' : `a collection`}. ` +
            `A partial's name is its whole address, so it would shadow that. Rename one.`,
          );
        }

        // The shell the editor and preview draw around the page. A component,
        // so it cannot be serialised like the rest of the config — re-exported
        // live through the module graph, the same way the block registry is.
        const previewUrl = config.previewPath
          ? pathToFileURL(path.resolve(projectRoot, config.previewPath)).href
          : null;

        /**
         * The URL a saved page is served at, or null if the file is not a page.
         * Astro's routing read backwards: the path under pagesDir is the URL,
         * minus the extension, with `index` standing for its directory.
         */
        const pagesRoot = path.resolve(projectRoot, content.pagesDir);
        const savedPageUrl = (file: string): string | null => {
          const rel = path.relative(pagesRoot, file);
          if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
          if (!rel.endsWith('.mdx')) return null;
          const parts = rel.slice(0, -'.mdx'.length).split(path.sep);
          if (parts[parts.length - 1] === 'index') parts.pop();
          return `/${parts.map(encodeURIComponent).join('/')}${parts.length ? '/' : ''}`;
        };

        updateConfig({
          // Dev only. Astro's CSRF check (security.checkOrigin) treats the
          // dev API's text/plain PUTs as form submissions that need an Origin
          // match; the API is same-origin and devGuard()ed, so the check only
          // gets in the way. Never touched for builds — a site that later
          // flips to SSR keeps Astro's default protection.
          ...(command === 'dev' ? { security: { checkOrigin: false } } : {}),
          vite: {
            // The icon picker imports Font Awesome's set lazily, so Vite's
            // scanner never sees it at startup. Left alone, the first click on
            // "Choose icon" makes Vite optimise the package on the spot — and
            // that forces a full page reload, so the modal never opens and the
            // editor resets instead. Pre-bundling it means the import resolves
            // from the cache and the picker just opens. Only when it is
            // actually installed — see FONTAWESOME_AVAILABLE.
            optimizeDeps: {
              include: FONTAWESOME_AVAILABLE ? [FONTAWESOME_PKG] : [],
              // @anthropic-ai/sdk reaches for node builtins behind guarded
              // dynamic imports — its credential chain reads `node:fs` when no
              // key was passed. Pre-bundling it for the browser makes esbuild
              // try to resolve those at build time and fail, so the whole
              // optimisation fails, the dep URL answers 504, and the agent's
              // `import('@anthropic-ai/sdk')` rejects with "Failed to fetch
              // dynamically imported module" — the translation run dies while
              // everything that does not touch Claude keeps working.
              //
              // Marking them external leaves the bare `import("node:fs")` in
              // the output, where it can only throw if it runs, and it cannot:
              // the admin always constructs the client with an explicit key.
              // Vite's types omit `external` from esbuildOptions because it
              // manages externals itself, so this says the same thing as a
              // resolver.
              esbuildOptions: {
                plugins: [{
                  name: 'plinto:external-node-builtins',
                  setup(build: EsbuildPluginBuild) {
                    build.onResolve({ filter: /^node:/ }, (args: { path: string }) => ({
                      path: args.path,
                      external: true,
                    }));
                  },
                }],
              },
            },
            // See ISOMORPHIC_GIT_ESM above and docs/compat-vite-node-polyfills.md
            // for the full story. Applied in both client and SSR bundles.
            resolve: ISOMORPHIC_GIT_ESM
              ? {
                  alias: [
                    { find: /^isomorphic-git$/, replacement: ISOMORPHIC_GIT_ESM },
                  ],
                }
              : undefined,
            plugins: [
              // The stub half of FONTAWESOME_AVAILABLE: with the package
              // absent, the icon field's lazy import resolves to an empty
              // module — the picker offers uploads and an empty search set,
              // and the site builds. Installing the package (it needs a Font
              // Awesome Pro token) makes this plugin disappear.
              ...(!FONTAWESOME_AVAILABLE ? [{
                name: 'plinto:fontawesome-stub',
                resolveId(id: string) {
                  if (id === FONTAWESOME_PKG) return '\0' + FONTAWESOME_PKG;
                },
                load(id: string) {
                  if (id === '\0' + FONTAWESOME_PKG) return 'export {};';
                },
              }] : []),
              // Dev only: a save from the CMS editor writes the .mdx to disk,
              // the dev server sees a source change and full-reloads every
              // connected page — including the editor that just saved, yanking
              // it out from under the author. The files API marks its own
              // writes (see routes/api/files.ts PUT); this replaces the blanket
              // reload for exactly those with one addressed to the saved page,
              // so IDE edits still hot-reload normally.
              //
              // Vite's client only narrows a full-reload when `path` ends in
              // .html: it reloads if `location.pathname + 'index.html'` equals
              // it. So a tab previewing the saved page refreshes, and the
              // editor — on /plinto/admin/edit/ — does not. This used to return
              // [] and swallow the reload for every client, which meant the
              // author had to know to reload the other tab by hand.
              ...(command === 'dev' ? [{
                name: 'plinto:redirect-editor-save-reload',
                handleHotUpdate(ctx: EditorSaveHotContext) {
                  const g = globalThis as { __plintoEditorWrites?: Map<string, number> };
                  const stamp = g.__plintoEditorWrites?.get(ctx.file);
                  if (stamp === undefined) return;
                  g.__plintoEditorWrites!.delete(ctx.file);
                  // Watcher events can lag a save by a beat, but an old mark
                  // must not eat a later manual edit of the same file.
                  if (Date.now() - stamp >= 5000) return;

                  // Only a page has one URL to address. A partial or a
                  // collection entry feeds many, and guessing which would
                  // reload the wrong tab — those stay silent, as before.
                  const pageUrl = savedPageUrl(ctx.file);
                  if (pageUrl && astroConfig.trailingSlash === 'always') {
                    ctx.server.hot.send({ type: 'full-reload', path: `${pageUrl}index.html` });
                  }
                  return [];
                },
              }] : []),
              {
                name: '@plinto/astro:virtual-config',
                // Vite plugin hook: claim the virtual module id when it's
                // imported. Returning the resolved id (with \0 prefix)
                // tells Vite "I own this — call my load() for it."
                resolveId(id: string) {
                  if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
                  if (id === VIRTUAL_PREVIEW_ID) return RESOLVED_VIRTUAL_PREVIEW_ID;
                  if (id === VIRTUAL_BLOCKS_ID) return RESOLVED_VIRTUAL_BLOCKS_ID;
                  return null;
                },
                // Vite plugin hook: return generated source code for the
                // resolved virtual module id.
                load(id: string) {
                  if (id === RESOLVED_VIRTUAL_PREVIEW_ID) {
                    return previewUrl
                      ? `export { default as previewShell } from ${JSON.stringify(previewUrl)};`
                      : `export const previewShell = null;`;
                  }
                  if (id === RESOLVED_VIRTUAL_BLOCKS_ID) {
                    // A real re-export, so the component references stay
                    // live — you cannot serialize a React component into
                    // source. Deliberately alone in its own module: see
                    // VIRTUAL_BLOCKS_ID.
                    return `export { blocks } from ${JSON.stringify(blocksUrl)};`;
                  }
                  if (id !== RESOLVED_VIRTUAL_MODULE_ID) return null;

                  // Primitives only, every one of them JSON. Anything that
                  // has to stay a live reference goes in a module of its own.
                  return [
                    `// Generated by @plinto/astro integration`,
                    `export const i18n = ${JSON.stringify({ locales, defaultLocale, labels, prefixDefaultLocale })};`,
                    `export const content = ${JSON.stringify(content)};`,
                    `export const git = ${JSON.stringify(git)};`,
                    `export const storage = ${JSON.stringify(storage)};`,
                    `export const blockImports = ${JSON.stringify(blockImports)};`,
                    `export const partials = ${JSON.stringify(partials)};`,
                    `export const trailingSlash = ${JSON.stringify(astroConfig.trailingSlash)};`,
                  ].join('\n');
                },
              },
            ],
          },
        });
      },

      // Type the virtual modules for the site, so a default Astro tsconfig
      // (which includes .astro/types.d.ts) sees them with no extra setup.
      'astro:config:done': ({ injectTypes, config: astroConfig }) => {
        const libSrcDir = path.dirname(fileURLToPath(import.meta.url));
        const declarations = fs.readFileSync(path.join(libSrcDir, 'virtual-plinto-config.d.ts'), 'utf8');
        // The declaration file's import('./…') types resolve beside the
        // library source; the injected copy lands in
        // {root}/.astro/integrations/…/, so each one is rewritten to point
        // back at the source from there.
        const injectedDir = path.join(fileURLToPath(astroConfig.root), '.astro', 'integrations', '_plinto_astro');
        const toLib = path.relative(injectedDir, libSrcDir).replace(/\\/g, '/');
        injectTypes({
          filename: 'plinto.d.ts',
          content: declarations.replace(/import\('\.\//g, `import('${toLib}/`),
        });
      },
    },
  };
}
