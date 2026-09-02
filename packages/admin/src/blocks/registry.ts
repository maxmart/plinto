/**
 * What a block is, and the field sentinels a block declares.
 *
 * The editor's vocabulary, so it lives with the editor. `@plinto/astro/config`
 * re-exports every name here, and a site still writes one import — but a
 * second adapter would reuse these unchanged, because nothing about a block
 * is Astro's.
 */
import type { Slot, SlotComponent } from '@puckeditor/core';
import type { ComponentType } from 'react';

/**
 * A block: the component, carrying its own editor config.
 *
 * The config is declared in the same file as the component, beside the props
 * it describes — `CmHero.config = { fields: … } satisfies BlockConfig<Props>` —
 * so a registry is a list of components and nothing else.
 *
 * `config` is typed loosely here for the same reason BlockConfig exists: it
 * may hold plinto's sentinel field types (richtext, media-picker, page-link),
 * which build-config.tsx resolves into real Puck fields before registration,
 * and Puck's own ComponentConfig rejects those via excess property checks. The
 * `satisfies BlockConfig<Props>` at the declaration is what actually checks a
 * block's fields against its props.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlockComponent = ComponentType<any> & { config: Record<string, any> };

/**
 * A map from component name — the tag as written in MDX — to its block.
 *
 * Example:
 *   export const blocks: BlockRegistry = { Hero, CmHero, CmFeatureRow };
 */
export type BlockRegistry = Record<string, BlockComponent>;


/**
 * What Puck actually passes to `render`: the block's props, except that a
 * field declared as a Slot arrives as a renderable component rather than the
 * slot data, plus whatever extras Puck adds (`puck` context).
 */
type RenderProps<P> = {
  [K in keyof P]: P[K] extends Slot | undefined ? SlotComponent : P[K];
} & Record<string, any>;

/**
 * A block's own Puck config, with the plinto sentinels permitted as field
 * values, so a block can declare `image: mediaPicker(...)` next to the prop it
 * describes rather than have the block registry patch it in afterwards.
 *
 * Declared independently of Puck's ComponentConfig rather than wrapping it.
 * ComponentConfig<P> constrains P through internal conditional types
 * (LeftOrExactRight, ComponentConfigParams) that a generic wrapper cannot
 * satisfy without re-deriving them — the same wall that leaves BlockComponent's
 * `config` above as Record<string, any>.
 *
 * Field keys are still checked against the component's props: an object
 * literal with a key that is not a prop is an excess-property error. Values
 * are deliberately unchecked, since they may be a Puck field or a sentinel.
 * Unlike ComponentConfig, a prop is not required to have a field — plenty of
 * props (data fetched at render time, layout hints) are not editor-facing.
 */
export interface BlockConfig<P> {
  fields: Partial<Record<keyof P, unknown>>;
  defaultProps?: Partial<P>;
  /**
   * Puck hands the component its props plus extras it supplies itself: `puck`
   * context, and a Slot renderer for any slot field. Typed as P intersected
   * with an index signature so destructuring a declared prop stays checked
   * while those extras don't read as implicit any.
   */
  render?: (props: RenderProps<P>) => any;
  /** Puck renders inline blocks without its own wrapper element. */
  inline?: boolean;
  /**
   * Puck's hook for filling props from somewhere else before render — a block
   * that fetches a live list uses it. Passed straight through to Puck.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveData?: (data: any, params: any) => any;
}

// ── Field sentinel factories ──────────────────────────────────────────
// These produce field descriptors that the library's build-config factory
// transforms into real Puck field types at editor registration time.
// Sites import these instead of hand-crafting the sentinel objects.

export const richtext = (label: string, contentEditable = false) => ({
  type: 'richtext' as const,
  label,
  contentEditable,
});

export const mediaPicker = (
  label: string,
  mediaType: 'image' | 'video' | 'all' | 'svg' = 'image',
  /** Subfolder of the media library to browse and upload into, e.g. 'icons'. */
  folder?: string,
) => ({
  type: 'media-picker' as const,
  label,
  mediaType,
  folder,
});

/**
 * One icon field: search Font Awesome, or upload your own SVG. Stores a JSON
 * string the block reads with parseIconValue — see IconField for the shape.
 */
export const iconPicker = (label: string, folder = 'icons') => ({
  type: 'icon-picker' as const,
  label,
  folder,
});

export const pageLink = (label: string) => ({
  type: 'page-link' as const,
  label,
});
