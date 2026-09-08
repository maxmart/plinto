/**
 * Which block fields hold richtext — markdown in the MDX file, HTML in the
 * editor.
 *
 * Derived from the site's own block registry rather than hardcoded: a block
 * declares a field as richtext with the `richtext()` sentinel, and both halves
 * of the storage boundary read that same declaration, so the parser and the
 * generator cannot disagree about which props to convert.
 *
 * The registry is an argument. It used to be imported from
 * `virtual:plinto-blocks` and memoized in a module-level `let`, which is how
 * the corpus test came to prove nothing about half of this code: its fixture
 * registry is `{}`, so `isRichtextField` answered false for every field, the
 * markdown⇄HTML conversion was never called from either the parser or the
 * generator in any test, and three content-destroying bugs lived on that path
 * through two review rounds. A test cannot inject a registry into a module
 * that reaches for its own.
 *
 * Top-level only, and that is a real limit rather than an oversight: the
 * conversion in the parser and generator reaches a block's own props and its
 * child blocks, not the insides of an array or object field. So a richtext
 * field nested in one would get an editor and then save raw HTML into the MDX.
 * `build-config.tsx` refuses that at registration, using the same walk this
 * does — which is the point of the walk being shared. It used to be two
 * walks that disagreed, and the refusal existed to cover the gap.
 */
import type { BlockRegistry } from '../blocks/registry';
import { fieldPaths } from '../blocks/fields';

/**
 * Whether a component's field holds richtext.
 *
 * The parser and the generator take one of these rather than a registry: it is
 * the only question either of them asks, and a predicate is something a test
 * can write in a line.
 */
export type RichtextFields = (componentType: string, fieldName: string) => boolean;

/**
 * Memoized on the registry object itself, so deriving the map costs one walk
 * per registry rather than one per document — without a module-level cache
 * that a second registry could never displace.
 */
const cache = new WeakMap<BlockRegistry, Record<string, Set<string>>>();

/** component type -> set of top-level field names declared as richtext */
export function getRichtextFields(blocks: BlockRegistry): Record<string, Set<string>> {
  const hit = cache.get(blocks);
  if (hit) return hit;

  const map: Record<string, Set<string>> = {};
  for (const [name, block] of Object.entries(blocks)) {
    const top = fieldPaths(block?.config?.fields, 'richtext')
      .filter(path => path.length === 1)
      .map(path => path[0]);
    if (top.length > 0) map[name] = new Set(top);
  }

  cache.set(blocks, map);
  return map;
}

/** The `RichtextFields` predicate for a registry. */
export function richtextFieldsOf(blocks: BlockRegistry): RichtextFields {
  const map = getRichtextFields(blocks);
  return (componentType, fieldName) => map[componentType]?.has(fieldName) ?? false;
}
