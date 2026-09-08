import { useState } from 'react';
import type { BlockConfig } from '@plinto/astro/config';

export interface FaqProps {
  id?: string;
  heading?: string;
  items?: Array<{ question: string; answer: string }>;
}

/**
 * An accordion of questions — the playground's interactive block. Opening an
 * answer is client-side state, so pages import the hydrated Faq.astro wrapper
 * (see astroBlocks in plinto-blocks.tsx) while the editor and preview keep
 * using this React component directly.
 */
export const Faq = ({ id, heading, items = [] }: FaqProps) => {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="pg-faq" data-component-id={id}>
      <style>{`
        .pg-faq { max-width: 720px; margin: 0 auto; padding: 32px 8%; }
        .pg-faq > h2 { font-family: var(--font-heading); font-size: 1.6rem; color: var(--ink); margin: 0 0 16px; }
        .pg-faq-item { border-bottom: 1px solid rgba(0,0,0,0.12); }
        .pg-faq-item > button {
          width: 100%; display: flex; justify-content: space-between; align-items: center;
          background: none; border: 0; cursor: pointer; font: inherit; text-align: left;
          padding: 14px 4px; color: var(--ink); font-weight: 600;
        }
        .pg-faq-item > button:hover { color: var(--brand); }
        .pg-faq-marker { transition: transform 0.15s ease; }
        .pg-faq-marker.pg-open { transform: rotate(90deg); }
        .pg-faq-answer { padding: 0 4px 16px; color: var(--ink-soft); line-height: 1.6; white-space: pre-line; }
      `}</style>
      {heading && <h2>{heading}</h2>}
      {items.map((item, i) => (
        <div className="pg-faq-item" key={i}>
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            {item.question}
            <span className={`pg-faq-marker${open === i ? ' pg-open' : ''}`} aria-hidden="true">›</span>
          </button>
          {open === i && <div className="pg-faq-answer">{item.answer}</div>}
        </div>
      ))}
    </section>
  );
};

Faq.config = {
  fields: {
    heading: { type: 'text', label: 'Heading', contentEditable: true },
    items: {
      type: 'array',
      label: 'Questions',
      getItemSummary: (item: { question?: string }) => item.question || 'Question',
      arrayFields: {
        question: { type: 'text', label: 'Question' },
        answer: { type: 'textarea', label: 'Answer' },
      },
    },
  },
  defaultProps: {
    heading: '',
    items: [],
  },
} satisfies BlockConfig<FaqProps>;
