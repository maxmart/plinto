import type { ReactNode } from 'react';
import type { BlockConfig } from '@plinto/astro/config';
import { richtext } from '@plinto/astro/config';
import { RichText } from './RichText';

export interface ProseProps {
  heading?: string;
  children?: string | ReactNode;
}

/**
 * A run of article prose — the workhorse block, and the one whose body takes
 * the full markdown ⇄ HTML round trip through the richtext editor. Tables,
 * nested lists, code fences and inline images all live in here, which is
 * exactly why the playground leans on it: those are the shapes that have
 * broken.
 */
export const Prose = ({ heading, children }: ProseProps) => (
  <section className="pg-prose">
    <style>{`
      .pg-prose { max-width: 720px; margin: 0 auto; padding: 24px 8%; font-size: 1.05rem; line-height: 1.7; color: var(--ink-soft); }
      .pg-prose > h2 { font-family: var(--font-heading); font-size: 1.6rem; color: var(--ink); margin: 0 0 16px; }
    `}</style>
    {heading && <h2>{heading}</h2>}
    <RichText>{children}</RichText>
  </section>
);

Prose.config = {
  fields: {
    heading: { type: 'text', label: 'Heading', contentEditable: true },
    children: richtext('Body'),
  },
  defaultProps: {
    heading: '',
    children: '',
  },
} satisfies BlockConfig<ProseProps>;
