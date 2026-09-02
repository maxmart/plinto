/**
 * Astro's rules about what a page file is, in one place.
 *
 * Two directory walks need them — the async one over the storage abstraction
 * that the admin and the editor use, and the synchronous `node:fs` one that
 * runs during the build. Their traversal genuinely differs and should; their
 * rules do not.
 *
 * They had a copy each, and the copies had already drifted: `pageSlug` mapped
 * a bare `index` to `'home'`, and the other did not. Invisible so far only
 * because the build-time walk is always given a section prefix and never sees
 * a bare `index` — a disagreement waiting for the first caller that does.
 */

/**
 * Whether a directory entry is content the CMS owns.
 *
 * Astro's own conventions: `_`-prefixed is "not a route", `[`-prefixed is a
 * dynamic route. Neither is a document anyone edits here.
 */
export function isRoutable(name: string): boolean {
  return !name.startsWith('_') && !name.startsWith('[');
}

/**
 * The slug a page file answers to, below its locale.
 *
 * `index.mdx` is the locale's home page, and `news/index.mdx` is the section
 * itself rather than a page called "index" — Astro's routing, so the same
 * rule the URL follows.
 */
export function pageSlug(relative: string): string {
  const withoutExt = relative.replace(/\.mdx$/, '');
  if (withoutExt === 'index') return 'home';
  return withoutExt.replace(/\/index$/, '');
}
