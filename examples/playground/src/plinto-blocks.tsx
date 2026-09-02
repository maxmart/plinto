/**
 * Block registry for the playground.
 *
 * Deliberately small and nobody's brand — but real: the richtext bodies
 * (Prose, Callout, Testimonial), the media picker (Hero, Figure), the page
 * links (Hero, LinkButton), the slot layout (Columns/Column) and the hydrated
 * island (Faq) are the paths the library's corpus test has to reach, so this
 * registry is what makes the playground a fixture rather than a demo.
 */
import type { BlockRegistry, AstroBlockPaths } from '@plinto/astro/config';

import { Hero } from './blocks/Hero';
import { Prose } from './blocks/Prose';
import { Callout } from './blocks/Callout';
import { Testimonial } from './blocks/Testimonial';
import { Columns, Column } from './blocks/Columns';
import { Figure } from './blocks/Figure';
import { LinkButton } from './blocks/LinkButton';
import { Faq } from './blocks/Faq';
import { NavBar } from './blocks/NavBar';

export const blocks: BlockRegistry = {
  Hero,
  Prose,
  Callout,
  Testimonial,
  Columns,
  Column,
  Figure,
  LinkButton,
  Faq,
  NavBar,
};

/**
 * Blocks a page imports as Astro rather than React — hydrated islands. The
 * editor and preview keep using the React components above.
 */
export const astroBlocks: AstroBlockPaths = {
  Faq: './blocks/Faq.astro',
};
