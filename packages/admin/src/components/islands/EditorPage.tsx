import { Puck, usePuck, type Data } from '@puckeditor/core';
import { createConfig } from '../puck/build-config';
import '@puckeditor/core/puck.css';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Frontmatter } from '../../mdx/parser';
import { usePartialLink } from './use-partial-link';
import SaveFlow from '../SaveFlow';
import { usePlinto } from '../../context';
import type { ResolvedContent } from '@plinto/core';


/**
 * Give a page the layout that wraps it in the site's shell.
 *
 * Astro renders the MDX file itself, and a page whose frontmatter names no
 * layout renders as a bare stack of blocks — no <head>, no top bar, no footer.
 * So the setting is applied on the way into the editor rather than on the way
 * out: a new page gets it, an older page missing one is repaired the next time
 * it is saved, and either way what the editor holds matches what the file will
 * say. Partials and collection entries are never routed and keep none.
 */
/** Short display name from a file path: "src/pages/sv/support.mdx" → "support". */
function getPageName(file: string): string {
  const base = file.split('/').pop()?.replace(/\.mdx$/, '');
  if (!base) return file;
  return base === 'index' ? 'home' : base;
}

function withPageLayout(frontmatter: Frontmatter, file: string, content: ResolvedContent): Frontmatter {
  const layout = content.pageLayout;
  if (!layout || frontmatter.layout) return frontmatter;
  if (!file.startsWith(content.pagesDir + '/')) return frontmatter;
  return { layout, ...frontmatter };
}

/**
 * Undo/redo buttons driven by Puck's built-in history. Rendered inside the
 * Puck header override so usePuck() resolves against the surrounding <Puck>
 * context.
 */
function HistoryButtons() {
  const { history } = usePuck();
  const baseStyle: React.CSSProperties = {
    backgroundColor: 'white',
    color: '#374151',
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    cursor: 'pointer',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
  };
  const disabledStyle: React.CSSProperties = {
    ...baseStyle,
    opacity: 0.4,
    cursor: 'not-allowed',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <button
        onClick={() => history.back()}
        disabled={!history.hasPast}
        style={history.hasPast ? baseStyle : disabledStyle}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 3L3 13" />
        </svg>
      </button>
      <button
        onClick={() => history.forward()}
        disabled={!history.hasFuture}
        style={history.hasFuture ? baseStyle : disabledStyle}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6" />
          <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3L21 13" />
        </svg>
      </button>
    </div>
  );
}

export default function EditorPage() {
  const {
    toContentPath, toFilePath, partialForFile, pageContentPath,
    pageFieldsFor, pageRelPath, config, ops,
  } = usePlinto();
  const plinto = usePlinto();
  const { parse: parseDocument, generate: generateDocument } = plinto.mdx;
  const { getContent, editContent, fixContent } = ops;
  const searchParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();

  const effectiveLang = searchParams.get('lang') ?? config.i18n.defaultLocale;

  // Site-relative path of the document being edited, e.g.
  // "src/pages/sv/support.mdx", "src/partials/sv/TopBar.mdx",
  // "content/staff/sv/havard.mdx". Defaults to the locale's home page.
  const file = searchParams.get('file') || toFilePath(pageContentPath(''), effectiveLang);

  // Check if this is a new page (not yet saved to disk)
  const isNewPage = searchParams.get('new') === 'true';
  const initialTitle = searchParams.get('title') || '';
  // Optional site-relative path of an existing page to seed the new page from.
  const copyFrom = searchParams.get('copyFrom') || '';

  const [data, setData] = useState<Data>({ content: [], root: {} });
  const latestData = useRef<Data>({ content: [], root: {} });
  const [frontmatter, setFrontmatter] = useState<Frontmatter>({});
  const frontmatterRef = useRef<Frontmatter>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Content tracking
  const originalMdx = useRef<string>('');
  const [hasChanges, setHasChanges] = useState(false);

  // Save panel state
  const [translationNotice, setTranslationNotice] = useState(false);
  const [showSaveDropdown, setShowSaveDropdown] = useState(false);
  const [isMinorFix, setIsMinorFix] = useState(false);
  const dropdownBtnRef = useRef<HTMLButtonElement>(null);

  // Set when the document being edited is a declared partial rather than a page.
  const editingPartial = partialForFile(file) ?? null;

  // Modal state
  const [showQuickPublish, setShowQuickPublish] = useState(false);
  const [showSaveSync, setShowSaveSync] = useState(false);
  const [pendingPublishMdx, setPendingPublishMdx] = useState('');

  useEffect(() => {
    async function loadContent() {
      try {
        setLoading(true);

        if (isNewPage) {
          // Seed from an existing page when requested; otherwise start empty.
          const initialContent = copyFrom
            ? await getContent(copyFrom)
            : `---\ntitle: ${initialTitle}\n---\n`;
          originalMdx.current = '';
          const parsed = parseDocument(initialContent);
          // Date-typed fields scoped to this page start at today — a new
          // news post's publish date is almost always "now", even when the
          // content was copied from an older post. Mirrored into the root
          // props so the page panel shows it (and doesn't write the empty
          // ride-along value back over it on the first edit).
          const fm: Frontmatter = { ...parsed.frontmatter, title: initialTitle };
          (parsed.data.root!.props as Record<string, unknown>).title = initialTitle;
          for (const [key, field] of Object.entries(pageFieldsFor(pageRelPath(file)))) {
            if (field.type === 'date') {
              fm[key] = new Date().toLocaleDateString('sv-SE');
              (parsed.data.root!.props as Record<string, unknown>)[key] = fm[key];
            }
          }
          setData(parsed.data);
          latestData.current = parsed.data;
          setFrontmatter(withPageLayout(fm, file, config.content));
          setHasChanges(true);
          setError(null);
        } else {
          const content = await getContent(file);
          originalMdx.current = content;
          const parsed = parseDocument(content);
          setData(parsed.data);
          latestData.current = parsed.data;
          setFrontmatter(withPageLayout(parsed.frontmatter, file, config.content));
          setHasChanges(false);
          setError(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    loadContent();
  }, [file, isNewPage, initialTitle, copyFrom, editingPartial, effectiveLang]);

  usePartialLink({
    enabled: !editingPartial,
    lang: effectiveLang,
    file,
    hasChanges,
    latestData,
    frontmatter: frontmatterRef,
    onSaved: mdx => { originalMdx.current = mdx; },
  });

  useEffect(() => {
    frontmatterRef.current = frontmatter;
  }, [frontmatter]);

  const handleDataChange = useCallback((newData: Data) => {
    latestData.current = newData;
    const fm = frontmatterRef.current;

    // Only the fields scoped to this page write back to frontmatter — an
    // out-of-scope field still rides along in the root props (as ''), and
    // stamping that empty value onto the page would be data damage.
    const rootKeys = ['title', 'description', ...Object.keys(pageFieldsFor(pageRelPath(file)))];
    const rootProps = newData.root?.props as Partial<Record<string, string>> | undefined;

    // One rule, used both for what gets saved and for whether anything
    // changed. Those were two expressions once, and they disagreed: the
    // dirty check fell back to the old value whenever a box was empty, so
    // clearing a field left the page looking unmodified and the Save button
    // disabled — the one edit you could not make.
    const next = { ...fm };
    for (const key of rootProps ? rootKeys : []) {
      const value = rootProps![key];
      if (value === undefined) continue;
      // An empty box means the page has no such field, not that it has an
      // empty one. Clearing a value therefore removes the line.
      if (value === '') delete next[key];
      else next[key] = value;
    }

    if (rootKeys.some(key => next[key] !== fm[key])) setFrontmatter(next);

    // The dirty flag is "differs from what is on disk", which means
    // generating the file on every change. If that generation throws — an
    // unknown block type, content the writer cannot represent — the document
    // is certainly not what is on disk, so it counts as dirty. Saying so
    // silently is deliberate: the message belongs on the save, which is where
    // it is asked for, not in a dialog on every keystroke.
    let newMdx: string | null = null;
    try {
      newMdx = generateDocument(newData, next);
    } catch { /* reported by currentMdx() when the user saves */ }
    setHasChanges(newMdx === null || newMdx !== originalMdx.current);
  }, []);

  /**
   * The MDX this editor would write right now, or null if it cannot be
   * written — in which case the reason has already been shown.
   *
   * All three save paths start here. They each used to call puckToMdx as
   * their first statement, *outside* their own try block, so a generator
   * failure rejected unhandled: Save did nothing at all and said nothing
   * either.
   */
  const currentMdx = (): string | null => {
    try {
      return generateDocument(latestData.current, frontmatterRef.current);
    } catch (err) {
      alert('This page cannot be saved as it stands: ' + (err instanceof Error ? err.message : String(err)));
      return null;
    }
  };

  /**
   * This content is now what the file holds.
   *
   * The dirty flag is derived, not owned — every change recomputes it as
   * "differs from originalMdx" — so clearing the flag without moving the
   * baseline leaves it measured against a version that is no longer on disk.
   * Undo back to that version then reads as *not* dirty, and the edit can be
   * navigated away from and lost.
   */
  const markSaved = (mdx: string) => {
    originalMdx.current = mdx;
    setHasChanges(false);
  };

  async function handleDirectSave() {
    const mdxContent = currentMdx();
    if (mdxContent === null) return;
    try {
      setSaving(true);
      const { contentPath } = toContentPath(file);

      if (isMinorFix) {
        await fixContent(contentPath, effectiveLang, mdxContent);
      } else {
        await editContent(contentPath, effectiveLang, mdxContent);
      }

      markSaved(mdxContent);
      setIsMinorFix(false);
      setTranslationNotice(true);
    } catch (err) {
      alert('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  }

  function handleQuickPublish() {
    const mdxContent = currentMdx();
    if (mdxContent === null) return;
    setPendingPublishMdx(mdxContent);
    setShowQuickPublish(true);
  }

  function handleSaveAndSync() {
    const mdxContent = currentMdx();
    if (mdxContent === null) return;
    setPendingPublishMdx(mdxContent);
    setShowSaveSync(true);
  }

  const puckConfig = useMemo(
    () => createConfig(plinto, {
      editingFile: editingPartial ? file : undefined,
      pageFile: editingPartial ? undefined : file,
      lang: effectiveLang,
    }),
    [editingPartial, file, effectiveLang]
  );

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-lg">Loading editor...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-red-600 mb-4">Error: {error}</p>
          <a href={`/${effectiveLang}`} className="text-blue-600 underline">
            Go back
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen relative">
      <Puck
        config={puckConfig}
        data={data}
        onChange={handleDataChange}
        onPublish={handleQuickPublish}
        iframe={{
          enabled: true,
        }}
        viewports={[
          { width: 375, height: 'auto', label: 'Mobile', icon: 'Smartphone' },
          { width: 768, height: 'auto', label: 'Tablet', icon: 'Tablet' },
          { width: 1280, height: 'auto', label: 'Desktop', icon: 'Monitor' },
        ]}
        overrides={{
          header: ({ children }) => (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              borderBottom: '1px solid #e5e7eb',
              background: 'white',
              height: '52px',
              boxSizing: 'border-box',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <a
                  href="/plinto/admin/"
                  style={{
                    color: '#6b7280',
                    textDecoration: 'none',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  &larr; Back
                </a>
                <span style={{
                  fontWeight: 600,
                  fontSize: '15px',
                  color: '#111827',
                }}>
                  {frontmatter.title || getPageName(file)}
                  {config.i18n.locales.length > 1 && (
                    <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: '6px' }}>
                      {effectiveLang.toUpperCase()}
                    </span>
                  )}
                </span>
                <HistoryButtons />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                {hasChanges && (
                  <span
                    style={{
                      backgroundColor: '#fef3c7',
                      color: '#92400e',
                      border: '1px solid #fcd34d',
                      borderRadius: '9999px',
                      padding: '3px 10px',
                      fontSize: '12px',
                      fontWeight: 500,
                      marginRight: '4px',
                    }}
                  >
                    Unsaved changes
                  </span>
                )}
                <button
                  onClick={handleQuickPublish}
                  disabled={saving}
                  style={{
                    backgroundColor: saving ? '#a78bfa' : '#7c3aed',
                    color: 'white',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontWeight: 500,
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  &#9889; Quick Publish
                </button>
                <button
                  onClick={handleSaveAndSync}
                  disabled={saving}
                  style={{
                    backgroundColor: saving ? '#93c5fd' : '#2563eb',
                    color: 'white',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontWeight: 500,
                    fontSize: '13px',
                  }}
                >
                  {saving ? 'Saving...' : config.i18n.locales.length > 1 ? 'Save & Sync' : 'Save'}
                </button>
                <div>
                  <button
                    ref={dropdownBtnRef}
                    onClick={() => setShowSaveDropdown(v => !v)}
                    style={{
                      backgroundColor: 'white',
                      color: '#374151',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      cursor: 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="More save options"
                  >
                    &#9660;
                  </button>
                  {showSaveDropdown && (
                    <>
                      <div
                        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                        onClick={() => setShowSaveDropdown(false)}
                      />
                      <div style={{
                        position: 'fixed',
                        top: (() => { const r = dropdownBtnRef.current?.getBoundingClientRect(); return r ? r.bottom + 4 : 0; })(),
                        right: (() => { const r = dropdownBtnRef.current?.getBoundingClientRect(); return r ? window.innerWidth - r.right : 0; })(),
                        background: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        zIndex: 50,
                        minWidth: '140px',
                        overflow: 'hidden',
                      }}>
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '8px 14px',
                            fontSize: '13px',
                            color: '#374151',
                            cursor: 'pointer',
                            borderBottom: '1px solid #e5e7eb',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                          <input
                            type="checkbox"
                            checked={isMinorFix}
                            onChange={e => setIsMinorFix(e.target.checked)}
                            style={{ margin: 0 }}
                          />
                          Minor fix
                        </label>
                        <button
                          onClick={() => { setShowSaveDropdown(false); handleDirectSave(); }}
                          disabled={saving}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 14px',
                            fontSize: '13px',
                            color: '#374151',
                            background: 'none',
                            border: 'none',
                            cursor: saving ? 'not-allowed' : 'pointer',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                          {isMinorFix ? 'Save (no sync)' : 'Save only'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ),
        }}
      />

      {saving && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <p className="bg-white px-6 py-4 rounded-lg">Saving...</p>
        </div>
      )}

      {(showQuickPublish || showSaveSync) && (
        <SaveFlow
          publish={showQuickPublish}
          contentPath={toContentPath(file).contentPath}
          lang={effectiveLang}
          mdxContent={pendingPublishMdx}
          onSaved={() => markSaved(pendingPublishMdx)}
          onDone={() => {
            if (showQuickPublish) window.location.href = '/plinto/admin/';
            else setShowSaveSync(false);
          }}
          onCancel={() => { setShowQuickPublish(false); setShowSaveSync(false); }}
        />
      )}

      {translationNotice && (
        <div className="fixed bottom-4 right-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 shadow-lg text-sm z-40">
          <p>Other language versions may need updating.</p>
          <a href="/plinto/admin/" className="text-blue-600 underline">Go to Translations &rarr;</a>
          <button onClick={() => setTranslationNotice(false)} className="ml-2 text-gray-400 hover:text-gray-600">&times;</button>
        </div>
      )}
    </div>
  );
}

