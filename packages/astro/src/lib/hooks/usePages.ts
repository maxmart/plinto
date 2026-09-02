import type { PageEntry } from '../listing/types';
import matter from 'gray-matter';
import { useState, useEffect } from 'react';
import { readPagesFromDisk } from './server-pages';

export interface UsePagesResult {
  entries: PageEntry[];
  loading: boolean;
  error: string | null;
}

export interface UsePagesOptions {
  /** Keep only the first N entries after sorting. */
  limit?: number;
  /** Frontmatter field to order by. Defaults to `date`. */
  sortBy?: string;
  /** Defaults to `desc` — newest first, which is what a news list wants. */
  order?: 'asc' | 'desc';
}

/**
 * A frontmatter value as something sortable.
 *
 * Dates need the care. `date: 2025-09-26` unquoted is a *timestamp* to YAML,
 * so the same field arrives as a Date from one reader and as a string from
 * another depending on whether the quotes survived a round-trip through the
 * editor. Normalizing to ISO makes both compare identically, and leaves plain
 * strings and numbers alone.
 */
function sortKey(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * Every page in a section of the site — `src/pages/{lang}/{prefix}/**` — with
 * its frontmatter and its body, newest first.
 *
 * The counterpart to useCollection, for content that is a set of real pages
 * rather than a collection of fragments. A news index is the motivating case:
 * the articles are routes with their own URLs, and the listing is derived from
 * them rather than maintained alongside them by hand.
 *
 * Like useCollection it works on both sides of the build:
 *
 * - Server (typeof window === 'undefined'): reads the pages directory
 *   synchronously with node:fs. Returns immediately, loading: false, no hooks.
 *
 * - Client (typeof window !== 'undefined'): loads through listPages() and the
 *   storage service. This is the half that matters in the Puck editor, where
 *   there is no filesystem — only lightning-fs behind the storage abstraction
 *   — so a block using this hook renders its real content while being edited
 *   instead of going blank.
 *
 * The `typeof window` check is stable per environment: it never changes during
 * a component's lifetime, so the same branch always runs and the rules of
 * hooks hold within each.
 *
 * Usage:
 *   const { entries, loading, error } = usePages('news', lang, { limit: 3 });
 *
 * @param prefix - Directory below the locale (e.g. 'news'), or null to skip
 * @param lang   - Language code (e.g. 'sv', 'en', 'no')
 * @param options - limit / sortBy / order
 */
export function usePages(
  prefix: string | null,
  lang: string,
  options?: UsePagesOptions,
): UsePagesResult {
  const limit = options?.limit;
  const sortBy = options?.sortBy ?? 'date';
  const order = options?.order ?? 'desc';

  // Ordering is applied identically to both halves so the editor and the build
  // agree. Ties break on the slug ascending, which keeps a same-day group in a
  // fixed order rather than at the mercy of directory listing order.
  //
  // Compared by code unit, deliberately. This order becomes the order of a
  // listing in a built page, and `localeCompare` asks the runtime for its
  // locale: `Ångest` sorts after Z on a Swedish machine and before B on an
  // English one, so the same content produced two different pages depending on
  // who ran the build. CLAUDE.md records the same trap in the block-import
  // writer; this is that trap one step removed, in the half of the promise
  // above that says the editor and the build agree.
  const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const arrange = (files: PageEntry[]): PageEntry[] => {
    const sorted = [...files].sort((a, b) => {
      const av = sortKey(a.data?.[sortBy]);
      const bv = sortKey(b.data?.[sortBy]);
      if (av !== bv) return order === 'asc' ? byCodeUnit(av, bv) : byCodeUnit(bv, av);
      return byCodeUnit(a.name, b.name);
    });
    return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
  };

  if (prefix === null) {
    return { entries: [], loading: false, error: null };
  }

  // ── Server path ──────────────────────────────────────────────────────
  if (typeof window === 'undefined') {
    return { entries: arrange(readPagesFromDisk(prefix, lang)), loading: false, error: null };
  }

  // ── Client path ──────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [entries, setEntries] = useState<PageEntry[]>([]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const { listPages } = await import('@plinto/admin/listing/index');
        const { plinto } = await import('../../plinto');
        const { getContent } = plinto.ops;

        const all = await listPages(plinto, lang);
        const clean = prefix!.replace(/^\/+|\/+$/g, '');
        const inSection = all.filter(f => f.name.startsWith(`${clean}/`));

        // listPages answers from the directory listing's frontmatter without
        // opening the files, so the bodies are a second read — but only for
        // this one section, not for every page of the site.
        const result = await Promise.all(inSection.map(async (file): Promise<PageEntry> => {
          try {
            return { ...file, body: matter(await getContent(file.path)).content.trim() };
          } catch {
            return { ...file, body: '' };
          }
        }));

        if (!cancelled) setEntries(arrange(result));
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : `Failed to load pages under ${prefix}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [prefix, lang, limit, sortBy, order]);

  return { entries, loading, error };
}
