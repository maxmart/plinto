/**
 * Clicking the site's chrome in the editor preview opens that chrome for
 * editing.
 *
 * The TopBar and Footer are partials — real documents with their own editor
 * route — but inside a page's canvas they are just the shell around the
 * blocks. Without this they look editable and are not.
 */
import { useEffect, useRef } from 'react';
import type { Data } from '@puckeditor/core';
import type { Frontmatter } from '../../mdx/parser';
import { usePlinto } from '../../context';

export function usePartialLink(opts: {
  /** Skip it entirely while editing a partial — it has no chrome of its own. */
  enabled: boolean;
  lang: string;
  /** Site-relative path of the document being edited. */
  file: string;
  hasChanges: boolean;
  latestData: React.RefObject<Data>;
  frontmatter: React.RefObject<Frontmatter>;
  /** This content is now what the file holds. */
  onSaved: (mdx: string) => void;
}) {
  const plinto = usePlinto();
  const { toContentPath, toFilePath, findPartial, ops } = plinto;
  const { generate: generateDocument } = plinto.mdx;
  const { fixContent } = ops;
  // The handler reads these at click time, not at bind time, so they stay out
  // of the dependency array below. They were in it — `data` and `frontmatter`
  // both — which tore down two click listeners and restarted a 300 ms poll
  // every time the document changed, for a handler that reads neither.
  const live = useRef(opts);
  live.current = opts;

  const { enabled, file, lang, hasChanges } = opts;

  useEffect(() => {
    if (!enabled) return;

    const onClick = async (e: MouseEvent) => {
      const overlay = (e.target as HTMLElement).closest<HTMLElement>('[data-plinto-partial]');
      if (!overlay) return;
      const partial = findPartial(overlay.dataset.plintoPartial ?? '');
      if (!partial) return;

      e.preventDefault();
      e.stopPropagation();

      if (hasChanges && window.confirm(`You have unsaved changes. Save before editing ${partial.label}?`)) {
        try {
          const mdx = generateDocument(live.current.latestData.current!, live.current.frontmatter.current!);
          // A minor fix: leaving this page to edit its top bar is not a
          // revision of this page, and must not mark every other language
          // stale.
          await fixContent(toContentPath(file).contentPath, lang, mdx);
          live.current.onSaved(mdx);
        } catch (err) {
          alert('Failed to save: ' + (err instanceof Error ? err.message : 'Unknown error'));
          return;
        }
      }

      // Canonical editor route. This used to point at `/{lang}/edit/`, a path
      // from the pre-Astro layout that no longer exists — the click just
      // navigated into a 404.
      const partialFile = toFilePath(partial.name, lang);
      window.location.href = `/plinto/admin/edit/?file=${encodeURIComponent(partialFile)}&lang=${lang}`;
    };

    // The overlay is rendered by the Puck config's root, which lives inside
    // Puck's preview iframe (#preview-frame) — a listener on the host document
    // never sees the click, which is why the button did nothing. Bind inside
    // the frame as well, retrying until it mounts and re-binding if Puck swaps
    // the document out from under us.
    const bound = new Set<Document>();
    const bind = (doc: Document | null | undefined) => {
      if (!doc || bound.has(doc)) return;
      doc.addEventListener('click', onClick);
      bound.add(doc);
    };

    bind(document);
    const poll = window.setInterval(() => {
      bind((document.getElementById('preview-frame') as HTMLIFrameElement | null)?.contentDocument);
    }, 300);

    return () => {
      window.clearInterval(poll);
      bound.forEach(doc => doc.removeEventListener('click', onClick));
    };
  }, [enabled, file, lang, hasChanges]);
}
