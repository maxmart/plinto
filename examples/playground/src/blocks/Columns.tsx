import type { ReactNode } from 'react';
import type { BlockConfig } from '@plinto/astro/config';
import type { Slot } from '@puckeditor/core';

/* ── Columns: a multi-column grid whose cells are dropped in ── */

/** Viewport width at which the grid collapses to a single column. */
const COLLAPSE_AT = 640;

export interface ColumnsProps {
  columns?: number;
  gap?: number;
  children?: ReactNode;
}

export const Columns = ({ columns = 2, gap = 40, children }: ColumnsProps) => {
  const cls = `pg-cols-${columns}`;
  return (
    <section style={{ padding: '32px 8%' }}>
      <style>{`
        .${cls} { display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: ${gap}px; max-width: ${columns * 380}px; margin: 0 auto; }
        /* In the editor Puck wraps the columns in a DropZone. display:contents
           would discard the DropZone's own box (0x0 while empty, so a freshly
           dropped Columns could never be filled); instead the DropZone spans
           the outer tracks and repeats them inside. The rendered page has no
           DropZone, so there the rule above does the work. */
        .${cls} > [class*="DropZone"] {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(${columns}, 1fr);
          gap: ${gap}px;
        }
        @media (max-width: ${COLLAPSE_AT}px) {
          .${cls} { grid-template-columns: 1fr; }
          .${cls} > [class*="DropZone"] { grid-template-columns: 1fr; }
        }
      `}</style>
      <div className={cls}>
        {children}
      </div>
    </section>
  );
};

interface ColumnsPuckProps {
  columns?: number;
  gap?: number;
  children?: Slot;
}

Columns.config = {
  fields: {
    columns: { type: 'number', label: 'Columns' },
    gap: { type: 'number', label: 'Gap (px)' },
    children: { type: 'slot' },
  },
  defaultProps: {
    columns: 2,
    gap: 40,
  },
  render: ({ children: Children, ...rest }) => {
    return <Columns {...rest}>{Children && <Children />}</Columns>;
  },
} satisfies BlockConfig<ColumnsPuckProps>;

/* ── Column: one cell, with an optional heading ── */

export interface ColumnProps {
  heading?: string;
  children?: ReactNode;
}

export const Column = ({ heading, children }: ColumnProps) => (
  <div className="pg-col">
    <style>{`
      .pg-col > h3 { font-family: var(--font-heading); font-size: 1.2rem; color: var(--ink); margin: 0 0 12px; }
    `}</style>
    {heading && <h3>{heading}</h3>}
    {children}
  </div>
);

interface ColumnPuckProps {
  heading?: string;
  children?: Slot;
}

Column.config = {
  fields: {
    heading: { type: 'text', label: 'Heading', contentEditable: true },
    children: { type: 'slot' },
  },
  defaultProps: {
    heading: '',
  },
  render: ({ children: Children, ...rest }) => {
    return <Column {...rest}>{Children && <Children />}</Column>;
  },
} satisfies BlockConfig<ColumnPuckProps>;
