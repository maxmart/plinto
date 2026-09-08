import type { ReactNode } from 'react';
import type { BlockConfig } from '@plinto/astro/config';
import { richtext } from '@plinto/astro/config';
import { RichText } from './RichText';

export interface TestimonialProps {
  quote?: string | ReactNode;
  name?: string;
  role?: string;
}

/**
 * A pull quote with attribution. The quote itself is richtext (a third
 * richtext field name for the corpus); the attribution is plain text.
 */
export const Testimonial = ({ quote, name, role }: TestimonialProps) => (
  <figure className="pg-testimonial">
    <style>{`
      .pg-testimonial { max-width: 640px; margin: 0 auto; padding: 32px 8%; text-align: center; }
      .pg-testimonial-quote { font-size: 1.25rem; line-height: 1.6; font-style: italic; color: var(--ink); }
      .pg-testimonial figcaption { margin-top: 16px; color: var(--ink-soft); }
      .pg-testimonial figcaption strong { color: var(--ink); }
    `}</style>
    <div className="pg-testimonial-quote">
      <RichText>{quote}</RichText>
    </div>
    {(name || role) && (
      <figcaption>
        {name && <strong>{name}</strong>}
        {name && role && ' — '}
        {role}
      </figcaption>
    )}
  </figure>
);

Testimonial.config = {
  fields: {
    quote: richtext('Quote'),
    name: { type: 'text', label: 'Name' },
    role: { type: 'text', label: 'Role' },
  },
  defaultProps: {
    quote: '',
    name: '',
    role: '',
  },
} satisfies BlockConfig<TestimonialProps>;
