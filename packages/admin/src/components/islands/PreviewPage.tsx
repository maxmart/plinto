import { useState, useEffect, useCallback, useMemo } from 'react';
import matter from 'gray-matter';
import { useMdx } from '../../mdx/runtime';
import { PreviewShell } from '../../preview';
import { usePlinto } from '../../context';

function PreviewBanner({
  onExit,
  onEdit,
}: {
  onExit: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="fixed top-0 left-0 right-0 bg-amber-500 text-black px-4 py-2 flex items-center justify-between z-50 shadow-md">
      <div className="flex items-center gap-2">
        <span className="font-bold">PREVIEW MODE</span>
        <span className="text-sm opacity-80">Viewing uncommitted changes from local storage</span>
      </div>
      <div className="flex items-center gap-2">
        <a
          href="/plinto/admin/"
          className="px-3 py-1 bg-black/20 text-black rounded text-sm hover:bg-black/30 transition-colors"
        >
          Admin
        </a>
        <button
          onClick={onEdit}
          className="px-3 py-1 bg-black/20 text-black rounded text-sm hover:bg-black/30 transition-colors"
        >
          Edit Page
        </button>
        <button
          onClick={onExit}
          className="px-3 py-1 bg-black text-white rounded text-sm hover:bg-gray-800 transition-colors"
        >
          Exit Preview
        </button>
      </div>
    </div>
  );
}

/**
 * The ?file escape hatch: some callers link here with the document's path
 * rather than its slug. Anything that isn't a page has no preview URL, so it
 * resolves to the locale's home page rather than an error.
 */
function PreviewLinkWrapper({ children, lang }: { children: React.ReactNode; lang: string }) {
  const handleClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');

    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    if (href.startsWith('http://') || href.startsWith('https://')) return;
    if (href.startsWith('#')) return;
    if (href.includes('/admin') || href.includes('/edit')) return;

    e.preventDefault();

    let previewPath = href;
    if (href.startsWith('/')) {
      // New URL shape: /plinto/preview/?slug=<slug>&lang=<locale>
      // Strip any leading lang segment from the original href so we extract
      // just the slug portion.
      const langMatch = href.match(/^\/([a-z]{2})(\/|$)/);
      if (!href.startsWith('/plinto/preview')) {
        const targetLang = langMatch ? langMatch[1] : lang;
        const rest = langMatch
          ? href.slice(langMatch[0].length - (langMatch[2] === '/' ? 1 : 0))
          : href;
        const slug = rest.replace(/^\/+/, '').replace(/\/+$/, '');
        const params = new URLSearchParams({ lang: targetLang });
        if (slug) params.set('slug', slug);
        previewPath = `/plinto/preview/?${params.toString()}`;
      }
    } else {
      const slug = href.replace(/^\/+/, '').replace(/\/+$/, '');
      const params = new URLSearchParams({ lang });
      if (slug) params.set('slug', slug);
      previewPath = `/plinto/preview/?${params.toString()}`;
    }

    window.location.href = previewPath;
  }, [lang]);

  useEffect(() => {
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [handleClick]);

  return <>{children}</>;
}

export default function PreviewPage() {
  const {
    toContentPath, toFilePath, pageContentPath, pageSlugOf, config, dev, ops, toPageHref,
    blockComponents,
  } = usePlinto();
  const { getContent, getRepoInfo, resolveFilePath } = ops;

  /** The slug a file path answers to, or '' if it is not a page. */
  const slugFromFile = (file: string): string => {
    try {
      return pageSlugOf(toContentPath(file).contentPath) ?? '';
    } catch {
      return '';
    }
  };
  // URL shape: /plinto/preview/?slug=<slug>&lang=<locale>[&file=<path>]
  // The slug and lang ride in the query string so the route is a single
  // static URL and works under any trailingSlash config.
  const searchParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();

  const lang = searchParams.get('lang') ?? config.i18n.defaultLocale;

  const slugFromQuery = searchParams.get('slug') ?? '';
  const fileParam = searchParams.get('file');
  const slug = slugFromQuery || (fileParam ? slugFromFile(fileParam) : '');

  const contentPath = pageContentPath(slug);

  const [source, setSource] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  // The slug alone can't say whether the page lives at docs/foo.mdx or
  // docs/foo/index.mdx — start from the flat guess, correct once resolved.
  const [file, setFile] = useState(() => toFilePath(contentPath, lang));

  useEffect(() => {
    let cancelled = false;
    async function loadContent() {
      try {
        setSource(null);
        setLoadError(null);

        const { initialized } = await getRepoInfo();
        if (cancelled) return;
        if (!initialized && !dev) {
          setNotConnected(true);
          return;
        }

        const resolved = await resolveFilePath(contentPath, lang);
        if (cancelled) return;
        setFile(resolved);
        const content = await getContent(resolved);
        if (!cancelled) setSource(content);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load page');
      }
    }

    loadContent();
    return () => { cancelled = true; };
  }, [contentPath, lang]);

  const { Content, error: compileError } = useMdx(source);

  // The shell gets the page's metadata, as the editor gives it the live root
  // props — a shell that draws a dateline under a news headline needs the date
  // in the preview too.
  const frontmatter = useMemo(() => {
    if (!source) return undefined;
    try {
      const data = matter(source).data as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(data).map(([k, v]) => [
          k,
          v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? undefined : String(v),
        ]),
      );
    } catch {
      return undefined;
    }
  }, [source]);
  const error = loadError ?? compileError?.message ?? null;
  const loading = !notConnected && !error && !Content;

  const handleExit = () => {
    window.location.href = toPageHref(contentPath, lang);
  };

  const handleEdit = () => {
    window.location.href = `/plinto/admin/edit/?file=${encodeURIComponent(file)}&lang=${lang}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading preview...</p>
        </div>
      </div>
    );
  }

  if (notConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">No Repository Connected</h1>
          <p className="text-gray-600 mb-6">
            To preview changes, you need to connect a GitHub repository first.
          </p>
          <a
            href="/plinto/admin/"
            className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Admin
          </a>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">
            {loadError ? 'Page Not Found' : "This page won't render"}
          </h1>
          <p className="text-gray-600 mb-6 whitespace-pre-wrap text-left">{error}</p>
          <button
            onClick={handleExit}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Exit Preview
          </button>
        </div>
      </div>
    );
  }

  return (
    <PreviewLinkWrapper lang={lang}>
      <PreviewBanner onExit={handleExit} onEdit={handleEdit} />
      <div className="pt-10">
        <PreviewShell lang={lang} pageFile={file} frontmatter={frontmatter}>
          {Content && <Content components={blockComponents} />}
        </PreviewShell>
      </div>
    </PreviewLinkWrapper>
  );
}
