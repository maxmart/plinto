import type { AdminRuntime } from '../runtime';
import type { ContentFile, CollectionEntry } from './types';
import matter from 'gray-matter';

export type { ContentFile, CollectionEntry } from './types';

/**
 * What a listing walk needs: the directories, the locale rule, the storage to
 * read through, and — because which files are pages is the site generator's
 * convention, not the CMS's — the host's page rules.
 */
export type ListingDeps = Pick<AdminRuntime, 'config' | 'localeDir' | 'collectionDir' | 'ops' | 'pageRules'>;

function parseCollectionEntry(raw: string, slug: string): CollectionEntry {
  const { data, content } = matter(raw);
  return { slug, data, body: content.trim() };
}

/**
 * Every page of a locale, walking subdirectories.
 *
 * Descending matters as soon as a site has a section rather than a flat set of
 * pages — 40 documentation articles under docs/{category}/ are 40 pages the
 * admin has to be able to see. Astro routes them by path either way; this is
 * only about the CMS finding them.
 *
 * `_`- and `[`-prefixed names are skipped, following Astro's own conventions:
 * the first is "not a route", the second is a dynamic route, and neither is
 * content the CMS owns.
 */
async function collectPages(plinto: ListingDeps, dir: string, locale: string, slugPrefix: string, skipDirs: string[] = []): Promise<ContentFile[]> {
  const { getContent, listContent } = plinto.ops;
  const { isRoutable, pageSlug } = plinto.pageRules;
  const files: ContentFile[] = [];

  for (const entry of await listContent(dir)) {
    if (!isRoutable(entry.name)) continue;
    if (entry.type === 'directory' && !slugPrefix && skipDirs.includes(entry.name)) continue;

    if (entry.type === 'directory') {
      files.push(...await collectPages(plinto, `${dir}/${entry.name}`, locale, `${slugPrefix}${entry.name}/`, skipDirs));
      continue;
    }
    if (!entry.name.endsWith('.mdx')) continue;

    const path = `${dir}/${entry.name}`;
    try {
      const data = entry.frontmatter ?? matter(await getContent(path)).data;
      files.push({
        lang: locale,
        path,
        name: pageSlug(`${slugPrefix}${entry.name}`),
        title: data.title as string,
        data,
      });
    } catch { /* unreadable or malformed — not a page we can list */ }
  }

  return files;
}

/**
 * Every page of every requested locale, as `{pagesDir}/{lang}/{slug}.mdx`.
 */
export async function listPages(plinto: ListingDeps, lang?: string): Promise<ContentFile[]> {
  const { config, localeDir, ops: { getContent, listContent } } = plinto;
  const { isRoutable, pageSlug } = plinto.pageRules;
  const PAGES_DIR = config.content.pagesDir;
  const locales = lang ? [lang] : config.i18n.locales;
  const files: ContentFile[] = [];

  for (const locale of locales) {
    const dir = localeDir(locale);
    // An unprefixed default locale lives at the pagesDir root, where the
    // prefixed locales' directories also sit — skip those while walking.
    const skip = dir ? [] : config.i18n.locales.map(localeDir).filter(Boolean);
    files.push(...await collectPages(plinto, dir ? `${PAGES_DIR}/${dir}` : PAGES_DIR, locale, '', skip));
  }

  return files;
}

export async function getCollection(plinto: ListingDeps, collection: string, lang: string): Promise<CollectionEntry[]> {
  const { collectionDir, ops: { getContent, listContent } } = plinto;
  const dirPath = `${collectionDir(collection)}/${lang}`;
  const entries = await listContent(dirPath);
  const mdxFiles = entries.filter(e => e.name.endsWith('.mdx')).map(e => e.name);
  const results: CollectionEntry[] = [];

  for (const file of mdxFiles) {
    try {
      const raw = await getContent(`${dirPath}/${file}`);
      results.push(parseCollectionEntry(raw, file.replace(/\.mdx$/, '')));
    } catch { /* skip */ }
  }

  return results;
}
