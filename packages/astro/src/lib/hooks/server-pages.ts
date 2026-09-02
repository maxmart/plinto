/**
 * Server-only page reader using node:fs — the build-time half of usePages.
 *
 * The sibling of server-collection.ts, and split out for the same reason:
 * Vite externalizes `node:` imports during SSR and stubs them out of client
 * bundles, so the filesystem read has to live in a module the client half
 * never actually calls into.
 *
 * The one substantive difference from server-collection.ts is the directory.
 * Collections live under `collectionsDir`; these are *pages* — real routes
 * with their own URLs — so they come from `pagesDir/{lang}/{prefix}`.
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { localeDir } from '@plinto/core';
import { config } from '../site-config';
import type { PageEntry } from '../listing/types';
import { isRoutable, pageSlug } from '../listing/page-rules';

/**
 * Every page below `{pagesDir}/{lang}/{prefix}`, walking subdirectories.
 *
 * `_`- and `[`-prefixed names are skipped, following Astro's own conventions
 * and matching `collectPages` in lib/content — the first is "not a route",
 * the second is a dynamic route, and neither is content the CMS owns.
 */
export function readPagesFromDisk(prefix: string, lang: string): PageEntry[] {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  // An unprefixed default locale has no directory of its own to descend into.
  const langSeg = localeDir(config, lang);
  const rootDir = path.join(process.cwd(), config.content.pagesDir, langSeg, cleanPrefix);
  if (!fs.existsSync(rootDir)) return [];

  const files: PageEntry[] = [];

  const walk = (dir: string, slugPrefix: string) => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirents) {
      if (!isRoutable(entry.name)) continue;

      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${slugPrefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.mdx')) continue;

      try {
        const abs = path.join(dir, entry.name);
        const { data, content: body } = matter(fs.readFileSync(abs, 'utf-8'));
        // The path stays the real file; the slug is the URL below the locale,
        // which is not the same string.
        const rel = `${slugPrefix}${entry.name}`;
        const slug = pageSlug(rel);
        files.push({
          lang,
          path: langSeg ? `${config.content.pagesDir}/${langSeg}/${rel}` : `${config.content.pagesDir}/${rel}`,
          name: slug,
          title: data.title as string | undefined,
          data,
          body: body.trim(),
        });
      } catch { /* unreadable or malformed — not a page we can list */ }
    }
  };

  walk(rootDir, `${cleanPrefix}/`);
  return files;
}
