import { useEffect, useState } from 'react';
import { listPages } from '../listing';
import type { ContentFile } from '../listing/types';
import { usePlinto } from '../context';

interface PageBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (href: string) => void;
  currentValue?: string;
  /** Restrict the list to this locale. If omitted, all locales are shown. */
  lang?: string;
}

/**
 * Resolve a `listPages(plinto)` path to the site href it is served at, e.g.
 * src/pages/sv/streaming.mdx -> /sv/streaming.
 */
export function PageBrowser({ isOpen, onClose, onSelect, currentValue, lang }: PageBrowserProps) {
  const plinto = usePlinto();
  const { toContentPath, toPageHref, config } = plinto;

  /** The URL a listed file is served at. */
  const pathToHref = (path: string): string => {
    const { contentPath, lang: fileLang } = toContentPath(path);
    return toPageHref(contentPath, fileLang);
  };

  const [pages, setPages] = useState<ContentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await listPages(plinto, lang);
        if (!cancelled) setPages(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load pages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, lang]);

  if (!isOpen) return null;

  // Group by lang, preserving config.i18n.locales order
  const byLang: Record<string, ContentFile[]> = {};
  for (const locale of config.i18n.locales) byLang[locale] = [];
  for (const page of pages) {
    if (byLang[page.lang]) byLang[page.lang].push(page);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Select a page</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="w-8 h-8 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : (
            config.i18n.locales.map(locale => {
              const group = byLang[locale] ?? [];
              if (group.length === 0) return null;
              return (
                <section key={locale}>
                  {!lang && (
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {locale}
                    </h3>
                  )}
                  <ul className="divide-y border border-gray-200 rounded-lg overflow-hidden">
                    {group.map(page => {
                      const href = pathToHref(page.path);
                      const isSelected = currentValue === href;
                      return (
                        <li key={page.path}>
                          <button
                            onClick={() => {
                              onSelect(href);
                              onClose();
                            }}
                            className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors ${
                              isSelected ? 'bg-blue-50' : ''
                            }`}
                          >
                            <span>
                              <span className="block font-medium text-gray-900 text-sm">
                                {page.title || page.name}
                              </span>
                              <span className="block text-xs text-gray-500 font-mono mt-0.5">
                                {href}
                              </span>
                            </span>
                            {isSelected && (
                              <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
