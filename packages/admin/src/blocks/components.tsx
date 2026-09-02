/**
 * The site's blocks as a plain name → React component map, ready to render.
 *
 * One map, two consumers: the MDX runtime that renders a document in the
 * browser (preview), and the Puck renderer that draws partials as context on
 * the editor canvas. Pages themselves don't come through here at all — Astro
 * imports each block directly from the MDX file's own import statements.
 *
 * Blocks that declare a `media-picker` field get their component wrapped with
 * a hook that resolves /media/ URLs to blob URLs in the browser — needed
 * wherever the media lives only in lightning-fs, because the file on disk is a
 * git-LFS pointer. During SSR the effect never fires and the raw /media/ path
 * is emitted, which is the right answer for a statically built page.
 */

import { ComponentType, useState, useEffect } from 'react';
import { fieldPaths } from './fields';
import type { BlockRegistry } from './registry';

/** Resolve a /media/ path to something the browser can show. */
export type MediaResolver = (path: string) => Promise<string>;

/**
 * Field paths that hold media URLs, from the block's field declarations:
 * ['src'] for a top-level picker, ['logos', '*', 'src'] for one nested in an
 * array field ('*' stands for every index). Derived from the block registry
 * so the library has no hard-coded knowledge of site blocks.
 */
export function getMediaPaths(fields: unknown): string[][] {
  return fieldPaths(fields, 'media-picker');
}

/** The /media/ strings found at `path` inside `value`, in document order. */
function collectMediaSrcs(value: unknown, path: string[], out: string[]): void {
  if (value == null) return;
  if (path.length === 0) {
    if (typeof value === 'string' && value.startsWith('/media/')) out.push(value);
    return;
  }
  const [head, ...rest] = path;
  if (head === '*') {
    if (Array.isArray(value)) for (const item of value) collectMediaSrcs(item, rest, out);
  } else if (typeof value === 'object') {
    collectMediaSrcs((value as Record<string, unknown>)[head], rest, out);
  }
}

/** `value` with each media path's string swapped for its entry in `urls`, cloning only along the path. */
function substituteMedia(value: unknown, path: string[], urls: Record<string, string>): unknown {
  if (value == null) return value;
  if (path.length === 0) {
    return typeof value === 'string' && urls[value] ? urls[value] : value;
  }
  const [head, ...rest] = path;
  if (head === '*') {
    return Array.isArray(value) ? value.map(item => substituteMedia(item, rest, urls)) : value;
  }
  if (typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  return { ...obj, [head]: substituteMedia(obj[head], rest, urls) };
}

/**
 * Wrap a block component so every media path is resolved to a blob URL in the
 * browser. One effect resolves them all — nested ones included, which
 * per-prop hooks could not do (array lengths vary, hook counts must not).
 * During SSR the effect never fires and the raw /media/ path is emitted,
 * which is the right answer for a statically built page.
 */
export function wrapWithMediaUrl<P extends Record<string, unknown>>(
  Component: ComponentType<P>,
  mediaPaths: string[][],
  getMediaUrl: MediaResolver,
): ComponentType<P> {
  function Wrapped(props: P) {
    const srcs: string[] = [];
    for (const path of mediaPaths) collectMediaSrcs(props, path, srcs);
    const depKey = srcs.join('\n');
    const [urls, setUrls] = useState<Record<string, string>>({});
    useEffect(() => {
      let alive = true;
      Promise.all(srcs.map(async src => {
        try {
          // The #filename fragment keeps the original name readable on the
          // blob URL, for anything that derives a label from it.
          const filename = src.split('/').pop() ?? '';
          return [src, `${await getMediaUrl(src)}#${filename}`] as const;
        } catch {
          // One unresolvable file (LFS fetch failed, token expired) must not
          // take the block's other images down with it.
          return [src, src] as const;
        }
      })).then(pairs => { if (alive) setUrls(Object.fromEntries(pairs)); });
      return () => { alive = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [depKey]);
    let enhanced: Record<string, unknown> = props;
    for (const path of mediaPaths) enhanced = substituteMedia(enhanced, path, urls) as Record<string, unknown>;
    return <Component {...(enhanced as P)} />;
  }
  Wrapped.displayName = `${Component.displayName ?? Component.name ?? 'Block'}WithMediaUrl`;
  return Wrapped;
}

/**
 * Every block, keyed by the name it is written under in MDX, with the ones
 * that declare media wrapped so their paths resolve.
 *
 * Memoized on the registry object: the wrappers are component identities, and
 * rebuilding them on every render would remount every block on the canvas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new WeakMap<BlockRegistry, Record<string, ComponentType<any>>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function blockComponentsOf(blocks: BlockRegistry, getMediaUrl: MediaResolver): Record<string, ComponentType<any>> {
  const hit = cache.get(blocks);
  if (hit) return hit;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, ComponentType<any>> = {};
  for (const [name, block] of Object.entries(blocks)) {
    // Name the block. An entry is undefined when its import in the site's
    // registry resolved to nothing -- a renamed package, a moved file, a
    // missing export, or a module cycle that has not finished initialising --
    // and reading .config off it produced a stack pointing here, at the loop,
    // which is the one place that cannot say which block is at fault.
    if (!block) {
      throw new Error(
        `plinto: the block "${name}" is undefined. Its import in the site's ` +
        `block registry (src/plinto-blocks.tsx) resolved to nothing — check the ` +
        `specifier and that the module exports "${name}" by that name.`,
      );
    }
    const mediaPaths = getMediaPaths(block.config?.fields);
    out[name] = mediaPaths.length > 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? wrapWithMediaUrl(block as ComponentType<any>, mediaPaths, getMediaUrl)
      : block;
  }
  cache.set(blocks, out);
  return out;
}
