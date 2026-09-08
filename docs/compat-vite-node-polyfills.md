# Vite, Node built-ins, and the Webpack-era library compat hole

This document explains why `packages/astro/src/integration.ts` has a
hand-written `resolve.alias` for `isomorphic-git`, why we don't use
`vite-plugin-node-polyfills`, and what to try next if a similar crash
resurfaces.

If you're debugging a `createHash is not a function`, `process is not defined`,
or `Buffer is not a function` error in a browser bundle — start here.

## The symptom

```
[ops] translateError: k.createHash is not a function
TypeError: k.createHash is not a function
    at Qc (index.<hash>.js:18:9970)
    at tf (...)
    at async cf.readdir (...)
```

Happens in production (the static GitHub Pages build), after the admin page
loads and the `BrowserGitStore` starts reading pack files from the cloned
repo in lightning-fs. The call chain `cf.readdir → tf → wa → Jc → Qc` is
isomorphic-git's "list pack files, read each `.idx`, verify SHA-1." `Qc` is
the `shasum` function that calls `crypto.createHash("sha1")` to hash pack
contents in 8MB chunks.

Browsers don't have `crypto.createHash`. They have `crypto.subtle.digest`
(Web Crypto API), which is async and has a different shape entirely. So the
call throws the moment any git operation touches a packfile.

## The root cause

Two ecosystems with different philosophies, and a pile of npm packages that
only work under one of them:

**Webpack / Browserify world.** These bundlers auto-substitute Node built-ins
(`crypto`, `buffer`, `stream`, `process`, `fs`) with browser polyfills when
targeting the browser. It's been the default since ~2014. Thousands of npm
packages were written under this assumption. They `import 'crypto'` and call
`createHash` directly, knowing the bundler will silently swap it for
`crypto-browserify` in the browser.

**Vite / ESM-strict world.** Vite explicitly does NOT auto-polyfill. The
reasoning: auto-polyfilling hides Node-vs-browser distinctions, produces
bloat, encourages shipping Node code into browsers by accident. If your code
does `import 'crypto'` in a client bundle, Vite externalizes it, the import
becomes `undefined` at runtime, and your code crashes.

Both positions are defensible. **But every npm package written under Webpack
assumptions now breaks under Vite.**

Plinto uses two such packages, both necessary:

- **`isomorphic-git`** — browser-safe in intent (uses sha.js, no fs reliance),
  but as of 1.37.x its `package.json` ships only `exports: { ".": { default:
  "./index.cjs" } }`. The CJS bundle hardcodes `var crypto$1 =
  require('crypto')`. No `browser` field, no `browser` condition. Vite always
  picks `index.cjs`. **There IS an ESM sibling on disk, `index.js`, which
  imports `sha.js/sha1.js` and has ZERO `crypto` imports** — but the exports
  field doesn't expose it as a public subpath, so resolvers can't find it.

- **`object-hash`** (transitive dep of `@puckeditor/core`) — same shape. Its
  `index.js` calls `crypto.createHash`. There's a browserified
  `dist/object_hash.js` meant to be loaded via `<script>` tag in pre-bundler
  days. Modern imports get the Node version.

Neither maintainer considers this their problem. The isomorphic-git issue is
marked `wontfix`: https://github.com/isomorphic-git/isomorphic-git/issues/1356

## The fix we chose

**A targeted `resolve.alias` for `isomorphic-git` only.** Lives in
`packages/astro/src/integration.ts`:

```ts
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ISOMORPHIC_GIT_ESM = (() => {
  try {
    const cjsPath = require.resolve('isomorphic-git');
    return path.join(path.dirname(cjsPath), 'index.js');
  } catch {
    return null;
  }
})();

// inside astro:config:setup's updateConfig:
vite: {
  resolve: ISOMORPHIC_GIT_ESM
    ? {
        alias: [
          { find: /^isomorphic-git$/, replacement: ISOMORPHIC_GIT_ESM },
        ],
      }
    : undefined,
  // ...
}
```

### Why the roundabout resolution

- **Can't `import 'isomorphic-git/index.js'` directly.** isomorphic-git's
  broken `exports` field rejects it — neither `./index.js` nor
  `./package.json` is a declared public subpath.
- **Can't hardcode a relative path** like `../../../node_modules/...`.
  Consumer sites of `@plinto/astro` could have node_modules hoisted anywhere.
- **Can use `require.resolve('isomorphic-git')`** — this calls into the
  broken exports and gets `index.cjs`, which is at least a real file path.
  We then walk to the sibling `index.js` by string manipulation.

### Why apply the alias to both client AND SSR

The ESM version of isomorphic-git imports `sha.js/sha1.js`, which is a pure
JS implementation. It works in Node too. There's no reason to gate the alias
by build target, and gating *would* require the filtering approach that
failed below.

## Why NOT `vite-plugin-node-polyfills`

`vite-plugin-node-polyfills` is the community-standard answer to
"I need crypto/buffer/process in a browser bundle" across Vite-based stacks.
It adds `crypto-browserify` aliases, injects Buffer as a global, etc. It
catches isomorphic-git AND object-hash AND future offenders all at once.

**It does not work in Astro `output: 'server'` mode.** We tried it in
commit `c769df8` and reverted in `cab10cf`. The failure mode:

1. Astro in server mode orchestrates **multiple Vite build invocations** —
   server entrypoints, client islands, prerender, possibly more — in sequence
   during a single `astro build` call.
2. Every one of those invocations reports `env.isSsrBuild === true` to the
   polyfill plugin's `config` hook. There is **no invocation** where
   `isSsrBuild === false`. Logged and verified with an instrumented wrapper.
3. Apply the polyfill to ALL invocations → SSR breaks because the polyfill
   replaces Node's real `process.cwd()` with a shim that returns `'/'`,
   which makes `path.join(process.cwd(), 'app/sv/page.mdx')` produce
   `C:\app\sv\page.mdx` (drive root!) and prerender fails with ENOENT.
4. Apply it to NONE → client bundle still has the broken `crypto.createHash`
   calls, admin still crashes.
5. Apply it only when `!env.isSsrBuild` → same as step 4, because the
   condition is never true.

There is no clean gating signal in Astro's pipeline that says "this
particular Vite invocation is the client bundle." The polyfill plugin's
`config` hook can't distinguish. A hypothetical fix would need to hook into
`astro:build:setup` (which has a `target: 'client' | 'server'` parameter)
and apply polyfills via a different mechanism, but that's a significant
restructuring and we haven't done it.

**Bottom line:** `vite-plugin-node-polyfills` is the wrong tool for Astro
server-mode projects in 2026. Avoid.

## Known latent issues

### object-hash from @puckeditor/core

The alias fix only targets `isomorphic-git`. **`object-hash` still has the
same bug**: `EditorPage.<hash>.js` in the built client bundle contains
`m.createHash("sha1")` where `m` is an unresolved `crypto` import.

**Why it hasn't crashed (yet):** Puck only hashes component props in certain
memo/diff codepaths. The common editor flow (open page, edit fields, save)
doesn't reach them. Specific combinations of drag-drop, component selection,
and viewport changes eventually will.

**When it crashes, options:**

1. **Second targeted alias.** Map `object-hash` to `object-hash/dist/object_hash.js`
   (the browserified UMD bundle that exists on disk). UMD-in-Vite is its own
   can of worms — the file has no `export` statements, it writes to
   `window.objectHash`. Would need a small interop shim.
2. **Replace Puck.** Significant scope.
3. **Revisit polyfills via `astro:build:setup`.** The restructuring mentioned
   above. Would need to invent a cleaner mechanism than
   `vite-plugin-node-polyfills` to hook per-target.

No decision yet. Filed in memory under "Small followups."

### Next offender

If a third Webpack-era package with the same flaw enters the dep tree,
symptoms to look for:

- Runtime `TypeError: <something> is not a function` where `<something>` is
  `createHash`, `randomBytes`, `pbkdf2`, `createHmac`, etc. — anything from
  Node `crypto`.
- Runtime `ReferenceError: Buffer is not defined` or `process is not defined`.
- Build-time Vite warning `Module "crypto" has been externalized for browser
  compatibility, imported by "<file>"` — this is a pre-warning that the
  runtime will fail.

The diagnosis recipe:

```bash
# 1. Find which chunk has the broken call
find examples/playground/dist/_astro -name "*.js" | \
  xargs grep -l "createHash" 2>/dev/null

# 2. Find which npm package it came from
grep -ob "createHash" <chunk>.js | head -1 | awk -F: '{print $1}' | \
  while read o; do dd if=<chunk>.js bs=1 skip=$((o-300)) count=600 2>/dev/null; done

# 3. Check the package's package.json exports and disk layout
cat node_modules/<suspect-package>/package.json
ls node_modules/<suspect-package>/
```

If the package has a browser-safe ESM or UMD variant on disk that its
`exports` field doesn't declare, add a targeted alias following the
isomorphic-git pattern. Otherwise, you're looking at replacement or
polyfill-plugin-with-astro-build-setup as the next step.

## The mime-types pitfall (same class of problem, different fix)

Noted here because anyone digging into this doc may hit it next. The
`mime-types` npm package imports Node's `path.extname` and crashes in
browser bundles with `Module "path" has been externalized`. Fixed separately
in commit `531bc07`: we wrote a tiny client-safe `lookupMime()` helper in
`packages/astro/src/lib/storage/file-store/mime.ts` and use it in all
browser-side code (`BrowserFileStore`, `ops.ts`). Server-side code
(`routes/api/_shared.ts`, `node.ts`) still uses the full `mime-types` package.

That fix used the "write a local replacement" approach instead of an alias
because `mime-types`' logic is simple enough to reimplement (a ~40-line map
lookup with a regex extractor). For `isomorphic-git` we can't reimplement —
it's 17k lines of git protocol logic — so aliasing to the ESM sibling is
the only tractable option.

## When this workaround can be removed

- **isomorphic-git publishes a proper `browser` condition in its `exports`
  field.** Unlikely; tracked upstream as wontfix.
- **We replace isomorphic-git with a minimal browser-native git client**
  using Web Crypto directly. Long-term plan, see
  `~/.claude/projects/C--Users-max-workspace-plinto/memory/project_git_client.md`.
  When that ships, delete the alias in `integration.ts` and this doc.
- **A new Vite/Astro convention emerges** for per-target plugin application.
  Check Astro's release notes when updating major versions; a new hook or
  config slot could simplify this.

## Related commits

- `c769df8` (reverted) — first attempt with `vite-plugin-node-polyfills`
- `cab10cf` — revert of the above
- `a27a453` — the alias fix that actually works
- `531bc07` — unrelated but same class: `mime-types` → local `lookupMime` shim
