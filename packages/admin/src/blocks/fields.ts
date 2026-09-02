/**
 * Finding fields of a given kind in a block's field declarations.
 *
 * A block declares its editor fields beside the props they describe, and
 * three separate things need to ask that declaration a question: which fields
 * hold richtext (the MDX storage boundary), which hold media (the blob-URL
 * wrapper), and which are sentinels to be turned into real Puck fields (the
 * editor config).
 *
 * All three walked the tree themselves, and they disagreed about recursion —
 * media recursed into array and object fields, richtext did not. That
 * disagreement is why `build-config.tsx` had to *throw* on a richtext field
 * nested inside an array: not because nesting is unreasonable, but because
 * one walker would have found it and another would not, and the file that
 * found it had to refuse on the other's behalf.
 *
 * One walk now. The disagreement is not expressible.
 */

/** A field's position in a block's props. `'*'` stands for every array index. */
export type FieldPath = string[];

/**
 * Every field declared with `type`, as a path from the block's props:
 * `['src']` for a top-level one, `['logos', '*', 'src']` for one inside an
 * array field.
 *
 * A matching field is not descended into — a media picker is a leaf, whatever
 * else its declaration happens to carry.
 */
export function fieldPaths(fields: unknown, type: string): FieldPath[] {
  const out: FieldPath[] = [];

  const walk = (f: Record<string, unknown>, prefix: FieldPath) => {
    for (const [name, field] of Object.entries(f)) {
      if (!field || typeof field !== 'object') continue;
      const ff = field as { type?: string; arrayFields?: unknown; objectFields?: unknown };

      if (ff.type === type) {
        out.push([...prefix, name]);
        continue;
      }
      // Puck's two composite field types. Without descending, a block whose
      // images live in `logos[].src` could never declare a picker for them.
      if (ff.type === 'array' && ff.arrayFields && typeof ff.arrayFields === 'object') {
        walk(ff.arrayFields as Record<string, unknown>, [...prefix, name, '*']);
      } else if (ff.type === 'object' && ff.objectFields && typeof ff.objectFields === 'object') {
        walk(ff.objectFields as Record<string, unknown>, [...prefix, name]);
      }
    }
  };

  if (fields && typeof fields === 'object') walk(fields as Record<string, unknown>, []);
  return out;
}
