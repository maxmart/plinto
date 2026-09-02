import type { ReactNode } from 'react';
import type { BlockConfig } from '@plinto/astro/config';
import { richtext } from '@plinto/astro/config';
import { RichText } from './RichText';

export interface CalloutProps {
  tone?: 'info' | 'tip' | 'warning';
  children?: string | ReactNode;
}

const TONES = {
  info: { bg: '#EEF4FB', edge: '#B7CFEA', ink: '#27415E' },
  tip: { bg: '#EDF7EC', edge: '#BBDDB7', ink: '#2C4A28' },
  warning: { bg: '#FDF3E0', edge: '#EDD09A', ink: '#5E4419' },
} as const;

/**
 * An aside that interrupts the prose — the caveat under an instruction, the
 * tip beside a route. A second richtext body, so the corpus exercises the
 * dangerous conversion from more than one field name.
 */
export const Callout = ({ tone = 'info', children }: CalloutProps) => {
  const t = TONES[tone] ?? TONES.info;
  return (
    <aside className="pg-callout" style={{
      maxWidth: 720,
      margin: '0 auto',
      padding: '16px 24px',
      backgroundColor: t.bg,
      borderLeft: `4px solid ${t.edge}`,
      borderRadius: 4,
      color: t.ink,
      lineHeight: 1.6,
    }}>
      <RichText>{children}</RichText>
    </aside>
  );
};

Callout.config = {
  fields: {
    tone: {
      type: 'select',
      label: 'Tone',
      options: [
        { label: 'Info (blue)', value: 'info' },
        { label: 'Tip (green)', value: 'tip' },
        { label: 'Warning (amber)', value: 'warning' },
      ],
    },
    children: richtext('Content'),
  },
  defaultProps: {
    tone: 'info',
    children: '',
  },
} satisfies BlockConfig<CalloutProps>;
