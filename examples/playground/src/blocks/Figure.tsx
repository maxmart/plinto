import type { BlockConfig } from '@plinto/astro/config';
import { mediaPicker } from '@plinto/astro/config';

export interface FigureProps {
  src?: string;
  alt?: string;
  caption?: string;
}

/** An image with an optional caption, picked from the media library. */
export const Figure = ({ src, alt, caption }: FigureProps) => (
  <figure className="pg-figure">
    <style>{`
      .pg-figure { margin: 0; padding: 8px 0; text-align: center; }
      .pg-figure img { max-width: 100%; height: auto; }
      .pg-figure figcaption { margin-top: 8px; font-size: 0.9rem; color: var(--ink-soft); font-style: italic; }
    `}</style>
    {src ? (
      <img src={src} alt={alt ?? ''} />
    ) : (
      <div style={{ background: '#f0f0ee', borderRadius: 8, padding: '48px 0', color: '#999' }}>
        No image selected
      </div>
    )}
    {caption && <figcaption>{caption}</figcaption>}
  </figure>
);

Figure.config = {
  fields: {
    src: mediaPicker('Image', 'image'),
    alt: { type: 'text', label: 'Alt text' },
    caption: { type: 'text', label: 'Caption' },
  },
  defaultProps: {
    src: '',
    alt: '',
    caption: '',
  },
} satisfies BlockConfig<FigureProps>;
