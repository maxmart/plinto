import React from 'react';
import { Button } from '../ui/button';
import type { ContentItem, StalenessStatus } from './types';
import { usePlinto } from '../../context';

function DotColor({ status }: { status: StalenessStatus | undefined }) {
  if (!status) return <span className="size-2.5 rounded-full bg-gray-200 inline-block" />;
  if (status === 'synced') return <span className="size-2.5 rounded-full bg-green-500 inline-block" />;
  if (status === 'stale') return <span className="size-2.5 rounded-full bg-amber-400 inline-block" />;
  if (status === 'missing') return <span className="size-2.5 rounded-full bg-gray-300 inline-block" />;
  return null; // exhaustive
}

interface ContentRowProps {
  item: ContentItem;
  activeLang: string;
  modifiedPaths: Set<string>;
  devMode: boolean;
  onSync: (contentPath: string) => void;
}

export function ContentRow({ item, activeLang, modifiedPaths, devMode, onSync }: ContentRowProps) {
  const { toFilePath, pageSlugOf, config, toPageHref } = usePlinto();
  // Prefer the real path the lister found: toFilePath can't tell whether a
  // nested slug lives at docs/foo.mdx or docs/foo/index.mdx.
  const fullPath = item.filePath ?? toFilePath(item.contentPath, activeLang);

  // A collection entry's contentPath looks like "{collection}/{entry}" where
  // {collection} is declared in content.collections. Pages use "page/…", and
  // a partial uses its own name. Route collection Edits to the dedicated editor.
  const collections = config.content.collections ?? {};
  const [firstSeg, ...restSeg] = item.contentPath.split('/');
  const isCollection = firstSeg in collections;
  const collectionEntry = isCollection ? restSeg.join('/') : '';

  const editHref = isCollection
    ? `/plinto/admin/edit-collection/?collection=${firstSeg}&entry=${encodeURIComponent(collectionEntry)}&lang=${activeLang}`
    : `/plinto/admin/edit/?file=${encodeURIComponent(fullPath)}&lang=${activeLang}`;

  const hasAction = item.staleness
    ? Object.values(item.staleness).some(s => s === 'stale' || s === 'missing')
    : false;

  // getCommitLog returns paths relative to the site root (no siteSubdir prefix),
  // so we match fullPath directly.
  const isModified = modifiedPaths.has(fullPath);

  // Preview/View links only apply to pages — a partial has no URL of its own,
  // and a collection entry is not routed at all.
  const slug = pageSlugOf(item.contentPath);
  const isPage = slug !== null;
  const previewParams = new URLSearchParams({ lang: activeLang });
  if (slug) previewParams.set('slug', slug);
  const previewHref = `/plinto/preview/?${previewParams.toString()}`;
  const viewHref = isPage ? toPageHref(item.contentPath, activeLang) : '';

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 hover:bg-gray-50">
      {/* Title */}
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm truncate block">
          {item.title ?? item.slug}
          {isModified && (
            <span className="ml-2 inline-flex items-center gap-1 bg-amber-100 text-amber-800 border border-amber-300 text-[10px] uppercase font-semibold rounded overflow-hidden align-middle">
              <span className="px-1.5 py-0.5">Modified</span>
              {isPage && (
                <a
                  href={previewHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-1.5 py-0.5 border-l border-amber-300 hover:bg-amber-200 transition-colors"
                  title="Preview uncommitted changes"
                >
                  Preview
                </a>
              )}
            </span>
          )}
        </span>
        {item.title && (
          <span className="text-xs text-gray-400">{item.slug}</span>
        )}
      </div>

      {/* The section's ordering value (e.g. the publish date) */}
      {item.orderValue !== undefined && (
        <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">{item.orderValue}</span>
      )}

      {/* Staleness dots — one per lang. With a single locale there is
          nothing to be stale against, so none are shown. */}
      <div className="flex items-center gap-3">
        {config.i18n.locales.length > 1 && config.i18n.locales.map((lang: string) => (
          <div key={lang} className="flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase text-gray-400 font-semibold">{lang}</span>
            <DotColor status={item.staleness?.[lang]} />
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {hasAction && (
          <Button
            variant="outline"
            size="sm"
            className="text-amber-600 border-amber-300 hover:bg-amber-50"
            onClick={() => onSync(item.contentPath)}
          >
            Sync
          </Button>
        )}
        {isPage && devMode && (
          <Button asChild variant="outline" size="sm">
            <a href={viewHref} target="_blank" rel="noopener noreferrer">View</a>
          </Button>
        )}
        <Button asChild size="sm">
          <a href={editHref}>Edit</a>
        </Button>
      </div>
    </div>
  );
}
