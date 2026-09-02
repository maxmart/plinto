import React, { useMemo, useState } from 'react';
import { Skeleton } from '../ui/skeleton';
import { ContentRow } from './ContentRow';
import type { ContentItem } from './types';

interface ContentListProps {
  items: ContentItem[];
  loading: boolean;
  /** Message from a failed load, shown in place of the empty state. */
  error?: string;
  onRetry?: () => void;
  activeLang: string;
  modifiedPaths: Set<string>;
  devMode: boolean;
  onSync: (contentPath: string) => void;
  /**
   * Group items whose slug has a directory prefix (docs/…, news/…) under an
   * expandable header. Only the pages view sets this — partials and
   * collections are flat namespaces where a "/" carries no hierarchy.
   */
  grouped?: boolean;
  /**
   * The items arrive already ordered (a section sorted by its orderBy) —
   * keep that order instead of the default home-first alphabetical sort.
   */
  presorted?: boolean;
}

/** Home first, then top-level pages, alphabetical within each. */
function sortItems(items: ContentItem[]): ContentItem[] {
  return [...items].sort((a, b) => {
    if (a.slug === 'home') return -1;
    if (b.slug === 'home') return 1;
    return a.slug.localeCompare(b.slug);
  });
}

function matches(item: ContentItem, query: string): boolean {
  const q = query.toLowerCase();
  return item.slug.toLowerCase().includes(q) || (item.title ?? '').toLowerCase().includes(q);
}

export function ContentList({ items, loading, error, onRetry, activeLang, modifiedPaths, devMode, onSync, grouped, presorted }: ContentListProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const sorted = presorted ? items : sortItems(items);
    return query.trim() ? sorted.filter(i => matches(i, query.trim())) : sorted;
  }, [items, query, presorted]);

  // Split into top-level items and directory groups. While a search query is
  // active the hierarchy collapses to a flat list — hiding matches inside a
  // closed group would make the search look broken.
  const { topLevel, groups } = useMemo(() => {
    if (!grouped || query.trim()) {
      return { topLevel: filtered, groups: new Map<string, ContentItem[]>() };
    }
    const topLevel: ContentItem[] = [];
    const groups = new Map<string, ContentItem[]>();
    for (const item of filtered) {
      const slash = item.slug.indexOf('/');
      if (slash === -1) {
        topLevel.push(item);
      } else {
        const dir = item.slug.slice(0, slash);
        if (!groups.has(dir)) groups.set(dir, []);
        groups.get(dir)!.push(item);
      }
    }
    return { topLevel, groups };
  }, [filtered, grouped, query]);

  // Before the skeleton: a failed load leaves loaded:false, which the caller
  // maps to `loading`, so without this the list would spin forever instead of
  // saying what went wrong.
  //
  // `!== undefined`, not truthiness. An Error carrying an empty message is
  // still a failure, and testing the message let it through to the skeleton
  // above — which then spun forever with no Try again, because that button
  // only exists in this branch. The presence of the field is the fact; its
  // contents are only what we can say about it.
  if (error !== undefined) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm font-medium text-red-700">Could not load content</p>
        <p className="mt-1 text-sm text-gray-600 break-words">
          {error || 'The reason was not recorded.'}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="divide-y divide-gray-100">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-gray-500">
        No content found
      </div>
    );
  }

  const toggleGroup = (dir: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
  };

  const renderRow = (item: ContentItem) => (
    <ContentRow
      key={item.contentPath}
      item={item}
      activeLang={activeLang}
      modifiedPaths={modifiedPaths}
      devMode={devMode}
      onSync={onSync}
    />
  );

  return (
    <div>
      <div className="px-4 pt-3 pb-2 border-b border-gray-100">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter…"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          No matches for “{query.trim()}”
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {topLevel.map(renderRow)}
          {[...groups.keys()].sort().map(dir => (
            <div key={dir}>
              <button
                onClick={() => toggleGroup(dir)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-gray-50"
              >
                <span
                  className={`text-gray-400 transition-transform ${expanded.has(dir) ? 'rotate-90' : ''}`}
                  aria-hidden
                >
                  ▸
                </span>
                {dir}/
                <span className="text-xs font-normal text-gray-400">
                  {groups.get(dir)!.length} page{groups.get(dir)!.length === 1 ? '' : 's'}
                </span>
              </button>
              {expanded.has(dir) && (
                <div className="divide-y divide-gray-100 border-t border-gray-100 pl-6">
                  {groups.get(dir)!.map(renderRow)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
