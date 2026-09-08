import { CollectionEntry } from '../listing/types';
import { useState, useEffect } from 'react';
import { readCollectionFromDisk } from './server-collection';

export interface UseCollectionResult {
  entries: CollectionEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * Unified collection loader that works on both server and client.
 *
 * - Server (typeof window === 'undefined'): Synchronously reads from the
 *   filesystem via node:fs. Returns immediately with loading: false. No React
 *   hooks used.
 *
 * - Client (typeof window !== 'undefined'): Uses React hooks (useState, useEffect)
 *   to load data asynchronously via the storage service.
 *
 * The typeof window check is stable per environment — it never changes during a
 * component's lifetime, so the same branch always executes.
 *
 * Usage:
 *   const { entries, loading, error } = useCollection('staff', lang, { slugs: 'a,b', group: 'support' });
 *
 * @param collection - Collection name (e.g. 'staff', 'news'), or null to skip loading
 * @param lang - Language code (e.g. 'sv', 'en', 'no')
 * @param options - Optional filters (slugs, group)
 */
export interface CollectionFilterOptions {
  slugs?: string;
  group?: string;
}

export function useCollection(
  collection: string | null,
  lang: string,
  options?: CollectionFilterOptions
): UseCollectionResult {
  if (collection === null) {
    return { entries: [], loading: false, error: null };
  }

  // ── Server path ──────────────────────────────────────────────────────
  if (typeof window === 'undefined') {
    const entries = readCollectionFromDisk(collection, lang, options);
    return { entries, loading: false, error: null };
  }

  // ── Client path ──────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [error, setError] = useState<string | null>(null);

  const slugs = options?.slugs;
  const group = options?.group;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const { getCollection } = await import('@plinto/admin/listing/index');
        const { applyCollectionFilters } = await import('../listing/types');
        const { plinto } = await import('../../plinto');
        const result = await getCollection(plinto, collection!, lang);

        if (!cancelled) {
          setEntries(applyCollectionFilters(result, { slugs, group }));
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : `Failed to load ${collection}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [collection, lang, slugs, group]);

  return { entries, loading, error };
}
