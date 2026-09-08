import { localeDir } from './layout';
import type { PageField } from './content-model';
import type { ResolvedConfig } from './resolved-config';

/**
 * Resolution of content.pageFields (folder-prefix scoped) and content.sections.
 * Pure functions of the config, which arrives as the first argument.
 */

/** 'news' and 'news/' both mean the folder news/ — normalize to 'news/'. */
function normalizeFolder(prefix: string): string {
  if (prefix === '') return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

/**
 * A page's path below the locale directory, from its site-relative file path:
 * 'src/pages/sv/news/foo.mdx' -> 'news/foo.mdx'. An unprefixed default
 * locale's pages sit directly under pagesDir.
 */
export function pageRelPath(c: ResolvedConfig, filePath?: string): string | undefined {
  if (filePath === undefined) return undefined;
  const localeDirs = c.i18n.locales.map(l => localeDir(c, l)).filter(Boolean);
  const stripPattern = localeDirs.length
    ? new RegExp(`^${c.content.pagesDir}/(?:(?:${localeDirs.join('|')})/)?`)
    : new RegExp(`^${c.content.pagesDir}/`);
  return filePath.replace(stripPattern, '');
}

/**
 * The page fields that apply to a page: the unscoped '' entry plus every
 * folder prefix that matches, shallower prefixes first so deeper ones win.
 * An undefined path (no file known) gets only the unscoped fields.
 */
export function pageFieldsFor(c: ResolvedConfig, relPath: string | undefined): Record<string, PageField> {
  const declared = c.content.pageFields ?? {};
  const matching = Object.entries(declared)
    .map(([prefix, fields]) => ({ prefix: normalizeFolder(prefix), fields }))
    .filter(({ prefix }) => prefix === '' || (relPath !== undefined && relPath.startsWith(prefix)))
    .sort((a, b) => a.prefix.length - b.prefix.length);
  const merged: Record<string, PageField> = {};
  for (const { fields } of matching) {
    Object.assign(merged, fields);
  }
  return merged;
}

/** Every declared field key across all folders — the editor's ride-along set. */
export function allPageFieldKeys(c: ResolvedConfig): string[] {
  return [...new Set(Object.values(c.content.pageFields ?? {}).flatMap(fields => Object.keys(fields)))];
}

export interface Section {
  label: string;
  folder: string;   // normalized, always trailing-slashed: 'news/'
  /** Frontmatter key to order by, and direction. Undefined = alphabetical. */
  orderKey?: string;
  orderDesc: boolean;
}

/**
 * The declared sections, normalized and validated. Throws on an orderBy key
 * that no pageFields entry for the folder declares — a silent typo there
 * would just quietly scramble the list order.
 */
export function sections(c: ResolvedConfig): Section[] {
  return (c.content.sections ?? []).map(({ label, folder, orderBy }) => {
    const normalized = normalizeFolder(folder);
    let orderKey: string | undefined;
    let orderDesc = false;
    if (orderBy) {
      orderDesc = orderBy.startsWith('-');
      orderKey = orderDesc ? orderBy.slice(1) : orderBy;
      if (!(orderKey in pageFieldsFor(c, normalized))) {
        throw new Error(
          `plinto: section "${label}" orders by "${orderKey}" but no pageFields entry for "${normalized}" declares it`
        );
      }
    }
    return { label, folder: normalized, orderKey, orderDesc };
  });
}

/** The section a page belongs to, by its slug ('news/summer-cup'), if any. */
export function sectionForSlug(c: ResolvedConfig, slug: string): Section | undefined {
  return sections(c).find(s => slug.startsWith(s.folder));
}
