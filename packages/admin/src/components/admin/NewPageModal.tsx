import { useState, useMemo } from 'react';
import type { ContentItem } from './types';
import { usePlinto } from '../../context';
import type { Section } from '@plinto/core';

/** New Page modal: title, slug, and an existing page to copy from. */
export function NewPageModal({
  lang,
  pages,
  section,
  onClose,
  onCreatePage,
}: {
  lang: string;
  /** For a section this is the section's own (pre-ordered) list. */
  pages: ContentItem[];
  /** Set when creating inside a section — the new page goes in its folder. */
  section?: Section;
  onClose: () => void;
  onCreatePage: (slug: string, title: string, copyFrom?: string) => void;
}) {
  const { toFilePath } = usePlinto();
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  // Section entries are usually structurally identical, so seed from the most
  // recent one (the list is already in the section's order). Plain pages
  // default to empty.
  const [copyFrom, setCopyFrom] = useState(section ? pages[0]?.filePath ?? '' : '');
  const [error, setError] = useState<string | null>(null);

  // Hierarchy for the copy-from select: top-level pages first, then one
  // <optgroup> per full directory path (docs/, docs/setup/, …) — optgroups
  // can't nest, so deeper directories become their own labeled group.
  const { topLevel, groups } = useMemo(() => {
    // A section's copy candidates are its own entries, already in order.
    if (section) {
      return { topLevel: pages.filter(p => p.filePath), groups: new Map<string, ContentItem[]>() };
    }
    const sorted = pages
      .filter(p => p.filePath)
      .sort((a, b) => {
        if (a.slug === 'home') return -1;
        if (b.slug === 'home') return 1;
        return a.slug.localeCompare(b.slug);
      });
    const topLevel: ContentItem[] = [];
    const groups = new Map<string, ContentItem[]>();
    for (const item of sorted) {
      const slash = item.slug.lastIndexOf('/');
      if (slash === -1) {
        topLevel.push(item);
      } else {
        const dir = item.slug.slice(0, slash);
        if (!groups.has(dir)) groups.set(dir, []);
        groups.get(dir)!.push(item);
      }
    }
    return { topLevel, groups };
  }, [pages, section]);

  // Auto-generate slug from title
  const handleTitleChange = (value: string) => {
    setTitle(value);
    // Generate slug from title (lowercase, replace spaces with hyphens, remove special chars)
    const generatedSlug = value
      .toLowerCase()
      .replace(/[åä]/g, 'a')
      .replace(/[ö]/g, 'o')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    setSlug(generatedSlug);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate slug
    if (!slug) {
      setError('Please enter a page slug');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError('Slug can only contain lowercase letters, numbers, and hyphens');
      return;
    }
    onCreatePage(`${section?.folder ?? ''}${slug}`, title || slug, copyFrom || undefined);
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[400px] overflow-hidden">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="font-bold text-lg">{section ? `Add ${section.label}` : 'New Page'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Page Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="About Us"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              URL Slug
            </label>
            <div className="flex items-center">
              <span className="text-gray-500 text-sm mr-1">/{lang}/{section?.folder}</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="about-us"
                className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              This will create: {toFilePath(`page/${section?.folder ?? ''}${slug || 'slug'}`, lang)}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start from
            </label>
            <select
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Empty page</option>
              {topLevel.map(p => (
                <option key={p.filePath} value={p.filePath}>
                  Copy of “{p.title || p.slug}”
                </option>
              ))}
              {[...groups.keys()].sort().map(dir => (
                <optgroup key={dir} label={`${dir}/`}>
                  {groups.get(dir)!.map(p => (
                    <option key={p.filePath} value={p.filePath}>
                      Copy of “{p.title || p.slug}”
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border rounded hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {section ? `Add ${section.label}` : 'Create Page'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
