/**
 * The shell the editor and preview draw around a page.
 *
 * The real page is arranged by the site's Astro layout, which cannot run in a
 * browser, so a site states that arrangement a second time as React — a module
 * default-exporting a component, pointed at by `previewPath`. This module is
 * what that component is written against:
 *
 *   import { usePartial } from '@plinto/astro/preview';
 *
 *   export default function PreviewShell({ children }) {
 *     const topBar = usePartial('TopBar.mdx');
 *     const footer = usePartial('Footer.mdx');
 *     return (
 *       <>
 *         {topBar && <header className="plinto-header">{topBar}</header>}
 *         <main>{children}</main>
 *         {footer && <footer>{footer}</footer>}
 *       </>
 *     );
 *   }
 *
 * The site says where things go and what wraps them. Everything else — which
 * locale, loading the file, compiling the MDX, making it click-to-edit, and
 * handing back the live canvas for the document actually being edited — is
 * this module's, and none of it appears in the site's code.
 */
import {
  createContext, useContext, useEffect, useState,
  type ReactNode,
} from 'react';
import { useMdx } from './mdx/runtime';
import { usePlinto } from './context';

export interface ShellContext {
  /** Locale being edited or previewed. */
  lang: string;
  /**
   * Site-relative path of the document on the canvas, when that document is
   * itself a partial. Its `usePartial` call gets the canvas instead of a
   * read-only copy, so a top bar is edited in its real place in the shell.
   */
  editingFile?: string;
  /** The live canvas, for the partial named by `editingFile`. */
  canvas?: ReactNode;
  /** Whether partials are click-to-edit. Off in the standalone preview. */
  interactive?: boolean;
  /**
   * Site-relative path of the *page* on the canvas (e.g.
   * 'src/pages/no/news/foo.mdx'), for shells that arrange something by where
   * the page lives — a dateline on news articles, say. Unset when the document
   * being edited is a partial.
   */
  pageFile?: string;
  /**
   * The page's document-level metadata (title, description, date). In the
   * editor these are the live root props, so the shell updates as they are
   * edited; in the preview they come from the file's frontmatter.
   */
  frontmatter?: Record<string, string | undefined>;
}

const Ctx = createContext<ShellContext>({ lang: '' });

/**
 * Both this marker and Puck's DropZone are block boxes by default, which would
 * break any flex or grid the site wraps a partial in. `display: contents` takes
 * them out of the layout so the site's element sees the partial's own children,
 * exactly as it does on the real page.
 *
 * That leaves the marker with no box to hang a hover overlay on, so the overlay
 * is positioned against the site's own wrapping element instead — `:has()`
 * makes whatever that element turns out to be the positioning context, without
 * the library needing to know what it is.
 */
const shellStyles = `
  .plinto-partial, .plinto-partial > [class*="DropZone"] { display: contents; }

  :has(> .plinto-partial-editable) { position: relative; }
  .plinto-partial-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.6);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  /* Descendant, not child: display:contents changes layout, not the DOM tree,
     so the overlay is a grandchild of the site's element. */
  :has(> .plinto-partial-editable):hover .plinto-partial-overlay { opacity: 1; }
  .plinto-partial-overlay > span {
    background: #2563eb;
    color: #fff;
    padding: 8px 16px;
    border-radius: 8px;
    font: 500 15px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
  }
`;

/**
 * The partial in `file` ('TopBar.mdx'), ready to render, or null when this
 * locale doesn't have it yet or it hasn't loaded. Call it from a preview shell.
 *
 * A node rather than a component on purpose: the canvas changes on every
 * keystroke, and a component built per render would remount the editor's own
 * canvas with it. A node reconciles in place.
 */
export function usePartial(file: string): ReactNode | null {
  const { config, partialForFile, blockComponents, ops } = usePlinto();
  const { getContent } = ops;
  const { lang, editingFile, canvas, interactive } = useContext(Ctx);
  const path = `${config.content.partialsDir}/${lang}/${file}`;
  const isCanvas = !!editingFile && editingFile === path;

  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    if (isCanvas) return;
    let cancelled = false;
    setSource(null);
    getContent(path).then(
      text => { if (!cancelled) setSource(text); },
      () => { /* this locale may not have it */ },
    );
    return () => { cancelled = true; };
  }, [path, isCanvas]);

  // Called unconditionally: the canvas branch simply never has a source to compile.
  const { Content } = useMdx(isCanvas ? null : source);

  if (isCanvas) {
    return <div className="plinto-partial">{canvas}</div>;
  }
  // Editing a partial means editing that partial, not the page it sits in. The
  // shell still runs — the canvas needs its real wrapper — but everything the
  // document being edited isn't drops out of it.
  if (editingFile) return null;
  if (!Content) return null;

  const partial = partialForFile(file);
  const editable = interactive ?? false;
  return (
    <div className={`plinto-partial${editable ? ' plinto-partial-editable' : ''}`}>
      <Content components={blockComponents} />
      {editable && partial && (
        <div className="plinto-partial-overlay" data-plinto-partial={partial.name}>
          <span>Edit {partial.label}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The page being drawn: its locale, site-relative path, and document metadata.
 * For a preview shell that arranges something by what the page is — e.g. a
 * dateline under a news article's headline, mirroring what the site's Astro
 * layout does with the same frontmatter.
 */
export function usePageMeta(): Pick<ShellContext, 'lang' | 'pageFile' | 'frontmatter'> {
  const { lang, pageFile, frontmatter } = useContext(Ctx);
  return { lang, pageFile, frontmatter };
}

/**
 * Render the site's preview shell around `children`.
 *
 * With no `previewPath` the children are rendered bare: a site that wants its
 * shell in the editor says so, and the library does not invent one. The last
 * version guessed `<header>` above and `<footer>` below, which could not order
 * two partials on the same side or know what wrapped them.
 */
export function PreviewShell({ children, ...ctx }: ShellContext & { children?: ReactNode }) {
  const Shell = usePlinto().previewShell;
  return (
    <Ctx.Provider value={ctx}>
      <style>{shellStyles}</style>
      {Shell ? <Shell>{children}</Shell> : children}
    </Ctx.Provider>
  );
}
