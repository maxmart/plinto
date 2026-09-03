/**
 * Where a document lives: the rules that turn a contentPath into a file path
 * and back, and the locale directory rule both of them are built on.
 *
 * Pure functions of the config, which arrives as the first argument. They were
 * four modules (locale-dir, collection-dir, partials, paths) each reaching into
 * `virtual:plinto-config` for the same handful of fields, which is one idea
 * spread over four files and a hidden dependency in each.
 */
import type { PartialConfig } from './content-model';
import type { ResolvedConfig } from './resolved-config';

/**
 * Basename of a locale's home page. Astro's routing convention, not a setting:
 * `src/pages/sv/index.mdx` is what serves `/sv/`.
 */
const HOME_FILE = 'index';

/** Escape a string for use as a literal inside a RegExp. */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The directory (and URL) segment a locale occupies — Astro's i18n routing
 * rule in one line: every locale is its own segment, except an unprefixed
 * default locale, which lives at the root ('').
 */
export function localeDir(c: ResolvedConfig, lang: string): string {
  return lang === c.i18n.defaultLocale && !c.i18n.prefixDefaultLocale ? '' : lang;
}

/**
 * A page's address, from its slug below the locale directory. The empty slug
 * is the locale's home page, which is why the address keeps its trailing
 * slash: `page/`.
 *
 * Here so the format has one author. `page/` was hand-spelled in three UI
 * files and parsed in three more — the same reason frontmatter has one reader
 * and one writer.
 */
export function pageContentPath(slug: string): string {
  return `page/${slug}`;
}

/** The slug of a page address, or null if the address is not a page. */
export function pageSlugOf(contentPath: string): string | null {
  return contentPath.startsWith('page/') ? contentPath.slice('page/'.length) : null;
}

/**
 * Where a collection's entries live, as `{dir}/{lang}/{slug}.mdx`.
 *
 * A collection may declare its own `dir`, and that dir may climb out of the
 * site (`'../../shared/staff'`) — which is how a monorepo shares one
 * collection between several sites.
 */
export function collectionDir(c: ResolvedConfig, name: string): string {
  const cfg = (c.content.collections ?? {})[name];
  return cfg?.dir ?? `${c.content.collectionsDir}/${name}`;
}

/** The collections that declare a dir of their own, for reverse path lookups. */
export function collectionsWithOwnDir(c: ResolvedConfig): Array<{ name: string; dir: string }> {
  const out: Array<{ name: string; dir: string }> = [];
  for (const [name, cfg] of Object.entries(c.content.collections ?? {})) {
    if (typeof cfg.dir === 'string') out.push({ name, dir: cfg.dir });
  }
  return out;
}

/** The partial with this name (which is also its contentPath), if any. */
export function findPartial(c: ResolvedConfig, name: string): PartialConfig | undefined {
  return c.partials.find(p => p.name === name);
}

/** The partial a file path belongs to, if any — matched on the basename. */
export function partialForFile(c: ResolvedConfig, file: string): PartialConfig | undefined {
  return c.partials.find(p => file === p.file || file.endsWith(`/${p.file}`));
}

/**
 * Translate a filesystem path under the configured pages/partials/collections
 * dirs into the abstract `contentPath` form used by the ops layer.
 *
 * Patterns recognized (with config values pagesDir='src/pages',
 * partialsDir='src/partials', collectionsDir='content', and a partial declared
 * as {name:'topbar', file:'TopBar.mdx'}):
 *
 *   src/partials/{lang}/TopBar.mdx            → contentPath 'topbar'
 *   src/pages/{lang}/index.mdx                → contentPath 'page/'
 *   src/pages/{lang}/{slug}.mdx               → contentPath 'page/{slug}'
 *   content/{collection}/{lang}/{slug}.mdx    → contentPath '{collection}/{slug}'
 */
export function toContentPath(c: ResolvedConfig, file: string): { contentPath: string; lang: string } {
  const pagesDir = reEscape(c.content.pagesDir);
  const partialsDir = reEscape(c.content.partialsDir);
  const collectionsDir = reEscape(c.content.collectionsDir);

  // Partials: {partialsDir}/{lang}/{partial.file}
  for (const partial of c.partials) {
    const match = file.match(new RegExp(`^${partialsDir}/([^/]+)/${reEscape(partial.file)}$`));
    if (match) {
      return { contentPath: partial.name, lang: match[1] };
    }
  }

  // Page: {pagesDir}/{localeDir}/{slug}.mdx, where an unprefixed default
  // locale's dir is empty — Astro's i18n layout. Prefixed locales are
  // matched first so `sv/foo.mdx` is Swedish rather than a default-locale
  // page in a directory that happens to be called "sv". The slug 'index' is
  // the home page — both as a whole file and as the last segment of a
  // nested one.
  const prefixed = c.i18n.locales.filter(l => localeDir(c, l) !== '');
  const localeAlt = prefixed.map(reEscape).join('|');
  const pagePatterns = [
    ...(localeAlt ? [new RegExp(`^${pagesDir}/(${localeAlt})/(.+)\\.mdx$`)] : []),
    ...(prefixed.length < c.i18n.locales.length ? [new RegExp(`^${pagesDir}/()(.+)\\.mdx$`)] : []),
  ];
  for (const pattern of pagePatterns) {
    const pageMatch = file.match(pattern);
    if (!pageMatch) continue;
    const lang = pageMatch[1] || c.i18n.defaultLocale;
    const slug = pageMatch[2] === HOME_FILE
      ? ''
      : pageMatch[2].replace(new RegExp(`/${HOME_FILE}$`), '');
    return { contentPath: `page/${slug}`, lang };
  }

  // Collection with its own dir (shared collections): {dir}/{lang}/{slug}.mdx.
  // Tried before the generic pattern — a dir like '../../shared/staff'
  // is not under collectionsDir and would never match below.
  for (const { name, dir } of collectionsWithOwnDir(c)) {
    const match = file.match(new RegExp(`^${reEscape(dir)}/([^/]+)/(.+)\\.mdx$`));
    if (match) {
      return { contentPath: `${name}/${match[2]}`, lang: match[1] };
    }
  }

  // Collection: {collectionsDir}/{collection}/{lang}/{slug}.mdx
  const collMatch = file.match(new RegExp(`^${collectionsDir}/([^/]+)/([^/]+)/(.+)\\.mdx$`));
  if (collMatch) {
    const collection = collMatch[1];
    const lang = collMatch[2];
    const slug = collMatch[3];
    return { contentPath: `${collection}/${slug}`, lang };
  }

  throw new Error(`Cannot parse content path from file: ${file}`);
}

/**
 * Translate an abstract `contentPath` + lang back to a filesystem path under
 * the configured directories.
 */
export function toFilePath(c: ResolvedConfig, contentPath: string, lang: string): string {
  const partial = findPartial(c, contentPath);
  if (partial) {
    return `${c.content.partialsDir}/${lang}/${partial.file}`;
  }

  const [first, ...rest] = contentPath.split('/');
  const slug = rest.join('/');

  if (first === 'page') {
    const dir = localeDir(c, lang);
    return dir
      ? `${c.content.pagesDir}/${dir}/${slug || HOME_FILE}.mdx`
      : `${c.content.pagesDir}/${slug || HOME_FILE}.mdx`;
  }

  return `${collectionDir(c, first)}/${lang}/${slug}.mdx`;
}

/**
 * The file layouts a page slug can resolve to. Astro routes docs/foo.mdx and
 * docs/foo/index.mdx to the same URL, and the slug collapses both to
 * "docs/foo" — so any reverse mapping has to try both, flat form first (new
 * pages are created flat). Partials, collections and the home page are
 * unambiguous and get a single candidate.
 */
export function candidateFilePaths(c: ResolvedConfig, contentPath: string, lang: string): string[] {
  const flat = toFilePath(c, contentPath, lang);
  const [first, ...rest] = contentPath.split('/');
  const slug = rest.join('/');
  if (first !== 'page' || !slug) return [flat];
  const dir = localeDir(c, lang);
  return [
    flat,
    dir
      ? `${c.content.pagesDir}/${dir}/${slug}/${HOME_FILE}.mdx`
      : `${c.content.pagesDir}/${slug}/${HOME_FILE}.mdx`,
  ];
}

// Not here: the URL a page is served at, and the same-page-other-language path
// a language switcher is built from. Both are routing, which belongs to
// whatever generates the site — they live in the adapter's lib/urls.ts. This
// module is where a document *lives*; that one is where it is *served*.
