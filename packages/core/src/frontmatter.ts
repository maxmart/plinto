/**
 * Reading and writing the YAML block at the top of a document.
 *
 * There is one spelling of plinto's frontmatter, and it lives here. Two
 * callers need it — the block editor saving a page, and the translation sync
 * stamping a revision — and when they each had their own writer they
 * disagreed: one wrote `synced: {sv: 1}`, the other wrote it across three
 * indented lines, so translating and then editing reformatted each other's
 * work forever.
 *
 * gray-matter reads the block, so gray-matter writes it: the dumper is the
 * exact inverse of the parser, and every value it decides to quote is one the
 * parser would otherwise read back as something else — a date, a number, a
 * YAML keyword. Deciding that by hand was the old approach and it was wrong
 * in both directions.
 */

import matter from 'gray-matter';

export interface Frontmatter {
  title?: string;
  description?: string;
  date?: string;
  /**
   * Scalars arrive as strings; numbers, booleans and null keep their type,
   * and arrays and maps (which the editor never edits) pass through as-is so
   * they can be written back as YAML instead of mangled into "[object
   * Object]".
   */
  [key: string]: unknown;
}

/**
 * Dumper settings, both about not reformatting the author's data:
 * `lineWidth: -1` stops a long description being folded onto a second line,
 * and `flowLevel: 1` keeps nested arrays and maps inline (`tags: [a, b]`)
 * rather than exploding them into block style.
 *
 * gray-matter forwards its options object to js-yaml verbatim — "Options to
 * pass to gray-matter and js-yaml", as its own docs put it — but its type
 * describes only gray-matter's half. Spelling out the other half is more
 * honest than asserting the type away, and it keeps these two names checked.
 */
type DumpOptions = Parameters<typeof matter.stringify>[2] & {
  lineWidth?: number;
  flowLevel?: number;
};

const YAML_DUMP: DumpOptions = { lineWidth: -1, flowLevel: 1 };

/**
 * An unquoted `date: 2020-12-23` is a YAML timestamp: js-yaml hands back a
 * Date, and String(Date) is "Wed Dec 23 2020 …". Keep it ISO, and keep it
 * short — a date-only value stays date-only.
 */
function shortIso(date: Date): string {
  const iso = date.toISOString();
  // Date-only when it is a bare UTC midnight, and otherwise the whole thing.
  // It used to truncate to minutes, which quietly dropped the seconds and the
  // Z from `date: 2026-06-01 10:30:45` — and disagreed with the nested case
  // one level down in the same file, which kept them.
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

/** Dates anywhere inside a list or map become ISO strings too — without
 *  this, a nested `- 2026-05-01` is rewritten as a full UTC timestamp on the
 *  way out. Nested values keep their full precision (only a bare UTC-midnight
 *  collapses to date-only, the same heuristic as top level); every other
 *  nested value keeps its parsed type. The seen-set breaks cyclic YAML
 *  anchors, which js-yaml resolves into genuinely cyclic objects — recursion
 *  without it dies on a stack overflow. */
function normalizeNestedDates(value: unknown, done = new Map<object, unknown>()): unknown {
  if (value instanceof Date) return shortIso(value);
  if (value === null || typeof value !== 'object') return value;

  // Memoized rather than merely visited: a YAML alias resolves to the SAME
  // object as its anchor, and returning the raw original for the second
  // occurrence would leave a Date in it — the exact rewrite this prevents.
  // The entry is registered before recursing, so a genuine cycle terminates.
  const cached = done.get(value);
  if (cached !== undefined) return cached;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    done.set(value, out);
    for (const v of value) out.push(normalizeNestedDates(v, done));
    return out;
  }

  const out: Record<string, unknown> = {};
  done.set(value, out);
  for (const [k, v] of Object.entries(value)) out[k] = normalizeNestedDates(v, done);
  return out;
}

/**
 * A frontmatter value as plinto holds it: dates as short ISO strings, other
 * text as the strings the form inputs edit, arrays and maps passed through
 * with their dates fixed.
 */
function normalizeValue(value: unknown): unknown {
  // null survives as null rather than becoming the string "null": the writer
  // preserves it, and a reader that quietly dropped what the writer keeps is
  // how a save loses a line.
  if (value === null) return null;
  if (value instanceof Date) return shortIso(value);
  if (value && typeof value === 'object') return normalizeNestedDates(value);
  // Numbers and booleans keep their type. Stringifying them here used to be
  // invisible, because the old writer spelled every scalar bare and `1` came
  // back a number by accident — two errors cancelling. Now that the writer
  // quotes what it is given, a stringified `rev` would reach the sync engine
  // as `rev: '1'`, whose `typeof === 'number'` guard reads it as 0 and
  // restarts the vector clock. Translation state is not a thing to lose to a
  // cast.
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/**
 * The document's frontmatter and the body below it.
 *
 * Use this wherever a value might be written back — the editor, the sync
 * engine, the collection hook. Elsewhere in the codebase frontmatter is read
 * with a bare `matter()`: listings, previews and the build-time hooks only
 * inspect values, never restore them, and they want a Date to stay a Date for
 * sorting. The rule is the one that matters: normalize what you will write,
 * and only that.
 *
 * A caveat worth knowing when reading someone's frontmatter: YAML decides
 * types, and gray-matter's js-yaml is 1.1, where `007` is 7 and `12:30` is
 * 750. Nothing here can undo that — an author who means a string writes
 * quotes — but the writer holds up its end: a value that *is* the string
 * "007" goes back out quoted, so nothing plinto stores degrades on a round
 * trip.
 */
export function readFrontmatter(source: string): { data: Frontmatter; body: string } {
  const { data, content } = matter(source);
  const out: Frontmatter = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    out[key] = normalizeValue(value);
  }
  return { data: out, body: content };
}

/**
 * The frontmatter block for these values, with the body appended.
 *
 * Emits LF; a caller holding a CRLF document converts the result. An empty
 * set of values writes no block at all rather than an empty `---\n---`.
 */
export function writeFrontmatter(data: Frontmatter, body: string): string {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return body;
  return matter.stringify(body, Object.fromEntries(entries), YAML_DUMP);
}
