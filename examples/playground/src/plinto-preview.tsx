import { usePartial } from '@plinto/astro/preview';
import type { ReactNode } from 'react';

/**
 * The site's own stylesheet, which the editor would otherwise never load — it
 * renders this shell, not Layout.astro. Without it the design tokens are
 * undefined on the canvas and every block reading var(--brand) would draw
 * unstyled.
 *
 * Aliased, not relative: this module is reached through a file:// URL from
 * virtual:plinto-preview, and Vite cannot resolve a relative CSS import from
 * there.
 */
import '@/assets/styles/global.css';

/**
 * What the editor and the preview draw around a page.
 *
 * The real page is arranged by src/layouts/Layout.astro, and this is the same
 * arrangement written for a browser, which cannot run Astro. Keep the two in
 * step: everything below has a counterpart there.
 */
export default function PreviewShell({ children }: { children?: ReactNode }) {
  const topBar = usePartial('TopBar.mdx');
  const footer = usePartial('Footer.mdx');

  return (
    <>
      {topBar && <header>{topBar}</header>}
      <main>{children}</main>
      {footer && <footer className="pg-footer">{footer}</footer>}
    </>
  );
}
