/**
 * Server-only collection reader using node:fs.
 * Vite externalizes node: imports during SSR and strips them from client bundles.
 * This replaces the old eval('require') hack that broke in Vite/Astro.
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { collectionDir } from '@plinto/core';
import { config } from '../site-config';
import { applyCollectionFilters, type CollectionEntry } from '../listing/types';

export function readCollectionFromDisk(
  collection: string,
  lang: string,
  options?: { slugs?: string; group?: string }
): CollectionEntry[] {
  try {
    const dirPath = path.join(process.cwd(), collectionDir(config, collection), lang);

    if (!fs.existsSync(dirPath)) return [];

    const files = fs.readdirSync(dirPath);
    const mdxFiles = files.filter(f => f.endsWith('.mdx'));

    const entries: CollectionEntry[] = mdxFiles.map(file => {
      const raw = fs.readFileSync(path.join(dirPath, file), 'utf-8');
      const { data, content } = matter(raw);
      return { slug: file.replace(/\.mdx$/, ''), data, body: content.trim() };
    });

    return applyCollectionFilters(entries, options);
  } catch {
    return [];
  }
}
