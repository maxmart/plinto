import type { BlockConfig } from '@plinto/astro/config';
import { mediaPicker, pageLink } from '@plinto/astro/config';

export interface HeroProps {
  title: string;
  tagline?: string;
  image?: string;
  imageAlt?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

/**
 * The page-opening band: a big heading and a tagline beside an image, with an
 * optional call-to-action underneath. `ctaHref` is a pageLink field, so the
 * editor offers the site's own pages as targets.
 */
export const Hero = ({ title, tagline, image, imageAlt, ctaLabel, ctaHref }: HeroProps) => (
  <section className="pg-hero">
    <style>{`
      .pg-hero { display: flex; align-items: center; gap: 48px; padding: 64px 8%; }
      .pg-hero-text { flex: 1; }
      .pg-hero h1 { font-family: var(--font-heading); font-size: 2.4rem; line-height: 1.2; margin: 0 0 16px; color: var(--ink); }
      .pg-hero p { font-size: 1.15rem; line-height: 1.6; color: var(--ink-soft); margin: 0 0 24px; }
      .pg-hero img { width: 260px; max-width: 35vw; height: auto; }
      .pg-hero-cta { display: inline-block; background: var(--brand); color: #fff; padding: 10px 24px; border-radius: 4px; text-decoration: none; }
      .pg-hero-cta:hover { filter: brightness(1.1); }
      @media (max-width: 640px) { .pg-hero { flex-direction: column-reverse; padding: 40px 8%; } }
    `}</style>
    <div className="pg-hero-text">
      <h1>{title}</h1>
      {tagline && <p>{tagline}</p>}
      {ctaLabel && ctaHref && (
        <a className="pg-hero-cta" href={ctaHref}>{ctaLabel}</a>
      )}
    </div>
    {image && <img src={image} alt={imageAlt ?? ''} />}
  </section>
);

Hero.config = {
  fields: {
    title: { type: 'text', label: 'Title', contentEditable: true },
    tagline: { type: 'textarea', label: 'Tagline' },
    image: mediaPicker('Image', 'image'),
    imageAlt: { type: 'text', label: 'Image alt text' },
    ctaLabel: { type: 'text', label: 'CTA label' },
    ctaHref: pageLink('CTA target'),
  },
  defaultProps: {
    title: '',
    tagline: '',
    image: '',
    imageAlt: '',
    ctaLabel: '',
    ctaHref: '',
  },
} satisfies BlockConfig<HeroProps>;
