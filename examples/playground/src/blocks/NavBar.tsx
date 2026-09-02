import type { BlockConfig } from '@plinto/astro/config';

export interface NavBarProps {
  brand?: string;
  brandHref?: string;
  links?: Array<{ label: string; href: string }>;
}

/**
 * The top navigation — lives in the TopBar partial, one per language, so the
 * labels and targets are translated content like everything else.
 */
export const NavBar = ({ brand, brandHref, links = [] }: NavBarProps) => (
  <nav className="pg-nav">
    <style>{`
      .pg-nav { display: flex; align-items: baseline; gap: 24px; padding: 16px 8%; border-bottom: 1px solid rgba(0,0,0,0.1); flex-wrap: wrap; }
      .pg-nav-brand { font-family: var(--font-heading); font-weight: 800; font-size: 1.2rem; color: var(--ink); text-decoration: none; }
      .pg-nav a:not(.pg-nav-brand) { color: var(--ink-soft); text-decoration: none; }
      .pg-nav a:not(.pg-nav-brand):hover { color: var(--brand); }
    `}</style>
    <a className="pg-nav-brand" href={brandHref || '/'}>{brand}</a>
    {links.map((link, i) => (
      <a key={i} href={link.href}>{link.label}</a>
    ))}
  </nav>
);

NavBar.config = {
  fields: {
    brand: { type: 'text', label: 'Brand', contentEditable: true },
    brandHref: { type: 'text', label: 'Brand link' },
    links: {
      type: 'array',
      label: 'Links',
      getItemSummary: (item: { label?: string }) => item.label || 'Link',
      arrayFields: {
        label: { type: 'text', label: 'Label' },
        href: { type: 'text', label: 'URL' },
      },
    },
  },
  defaultProps: {
    brand: '',
    brandHref: '',
    links: [],
  },
} satisfies BlockConfig<NavBarProps>;
