import type { BlockConfig } from '@plinto/astro/config';
import { pageLink } from '@plinto/astro/config';

export interface LinkButtonProps {
  label?: string;
  href?: string;
}

/**
 * A button-styled link to another page of the site. `href` is a pageLink
 * field: the editor offers the site's own pages rather than a bare URL box.
 */
export const LinkButton = ({ label, href }: LinkButtonProps) => (
  <p style={{ margin: '8px 0' }}>
    <a
      href={href || '#'}
      style={{
        display: 'inline-block',
        border: '2px solid var(--brand)',
        color: 'var(--brand)',
        padding: '8px 20px',
        borderRadius: 4,
        textDecoration: 'none',
        fontWeight: 600,
      }}
    >
      {label || 'Read more'}
    </a>
  </p>
);

LinkButton.config = {
  fields: {
    label: { type: 'text', label: 'Label', contentEditable: true },
    href: pageLink('Target page'),
  },
  defaultProps: {
    label: '',
    href: '',
  },
} satisfies BlockConfig<LinkButtonProps>;
