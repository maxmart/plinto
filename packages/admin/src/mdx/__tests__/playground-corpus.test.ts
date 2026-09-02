/**
 * The playground as a test corpus.
 *
 * `examples/playground` is the publishable fixture site: a real block
 * registry with real richtext fields, and content authored to hold the
 * shapes that have actually destroyed data — a GFM table, an ordered list
 * with nested content, an inline image inside richtext, a typed `<` in
 * prose, a code fence, non-ASCII. Every document is opened the way the
 * editor opens it and written back the way a save writes it.
 *
 * Deliberately a separate file from corpus.test.ts: that one walks the three
 * commercial sites, which cannot travel when the library is open-sourced.
 * This corpus can, and it is the one that must keep the dangerous half of
 * the markdown ⇄ HTML conversion reachable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMdx } from '../parser';
import { puckToMdx } from '../generator';
import type { BlockImportMap } from '../../block-imports';

/**
 * The field names the playground's registry declares with richtext().
 * `isRichtextField` decides whether a value takes the markdown ↔ HTML round
 * trip through Tiptap and turndown — the conversion the plain fixture's
 * empty registry made unreachable while three content-destroying bugs lived
 * on it. The guard test below keeps this list honest against the sources.
 */
const RICHTEXT_FIELDS = ['children', 'quote'];

const richtext = (_type: string, field: string) => RICHTEXT_FIELDS.includes(field);

/**
 * The playground's import map, spelled the way its registry derives: named
 * exports from '@/blocks/*', except the hydrated island, which pages import
 * as the default export of its .astro wrapper (see astroBlocks in
 * examples/playground/src/plinto-blocks.tsx).
 */
const named = (module: string, ...names: string[]) =>
  Object.fromEntries(names.map(n => [n, { module, export: n }]));
const blockImports: BlockImportMap = {
  ...named('@/blocks/Hero', 'Hero'),
  ...named('@/blocks/Prose', 'Prose'),
  ...named('@/blocks/Callout', 'Callout'),
  ...named('@/blocks/Testimonial', 'Testimonial'),
  ...named('@/blocks/Columns', 'Columns', 'Column'),
  ...named('@/blocks/Figure', 'Figure'),
  ...named('@/blocks/LinkButton', 'LinkButton'),
  ...named('@/blocks/NavBar', 'NavBar'),
  Faq: { module: '@/blocks/Faq.astro' },
};
const gen = { richtext, blockImports };

/**
 * Found by walking up to the directory that holds `examples/`, not by
 * counting `..` — a count is wrong the moment the file moves, and the
 * sibling corpus test has already moved once.
 */
const repoRoot = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url));
  while (!fs.existsSync(path.join(dir, 'examples'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error('playground corpus: no repository root above ' + import.meta.url);
    dir = up;
  }
  return dir;
})();

const playground = path.join(repoRoot, 'examples', 'playground');

function mdxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(full);
    return entry.name.endsWith('.mdx') ? [full] : [];
  });
}

const corpus = [
  ...mdxFiles(path.join(playground, 'src', 'pages')),
  ...mdxFiles(path.join(playground, 'src', 'partials')),
].filter(f => !f.includes('node_modules') && !f.includes(`${path.sep}dist${path.sep}`));

/** Block types and nesting, ignoring props — what must never be lost. */
function outline(nodes: unknown[]): unknown[] {
  return nodes.map(node => {
    const block = node as { type: string; props?: { children?: unknown } };
    const children = block.props?.children;
    return {
      type: block.type,
      children: Array.isArray(children) ? outline(children) : typeof children === 'string' ? 'text' : null,
    };
  });
}

/**
 * Every value, compared for what it says rather than how it is spaced. See
 * corpus.test.ts for why a loose list legitimately reads back tight.
 */
const saidTheSame = (nodes: unknown[]): unknown =>
  JSON.parse(JSON.stringify(nodes, (_key, value) =>
    typeof value === 'string'
      ? value
          .replace(/<li>\s*<p>([\s\S]*?)<\/p>\s*<\/li>/g, '<li>$1</li>')
          .replace(/\s+/g, ' ')
          .trim()
      : value));

/** Every string value in a parsed document, flattened for the reach checks. */
function allStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) value.forEach(v => allStrings(v, into));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => allStrings(v, into));
  return into;
}

describe('the playground as a corpus', () => {
  it('found documents to check', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(25);
  });

  it('declares the same richtext fields as the block sources', () => {
    // The list above is a fixture, and a fixture drifts. Scan the real block
    // sources for `field: richtext(...)` declarations and require the two to
    // agree in both directions — a field the scan finds that the list lacks
    // would silently skip the dangerous conversion in every test below.
    const blocksDir = path.join(playground, 'src', 'blocks');
    const declared = new Set<string>();
    for (const file of fs.readdirSync(blocksDir).filter(f => f.endsWith('.tsx'))) {
      const source = fs.readFileSync(path.join(blocksDir, file), 'utf8');
      for (const m of source.matchAll(/(\w+):\s*richtext\(/g)) declared.add(m[1]);
    }
    expect([...declared].sort()).toEqual([...RICHTEXT_FIELDS].sort());
  });

  it('reaches the markdown ⇄ HTML conversion, in the shapes that have broken', () => {
    // The point of this corpus: with richtext on, the values coming out of
    // the parser are Tiptap's HTML, so the dangerous conversion has provably
    // run — over a table, a nested ordered list, an inline image and a code
    // fence, each of which has destroyed content before. If one of these
    // stops matching, the fixture no longer covers that shape; fix the
    // content, not the assertion.
    const strings = corpus.flatMap(file =>
      allStrings(parseMdx(fs.readFileSync(file, 'utf8'), { strict: false, richtext }).data.content));
    expect(strings.some(s => s.includes('<table'))).toBe(true);
    expect(strings.some(s => s.includes('<ol'))).toBe(true);
    expect(strings.some(s => s.includes('<img'))).toBe(true);
    expect(strings.some(s => s.includes('<pre') || s.includes('<code'))).toBe(true);
  });

  for (const file of corpus) {
    const label = path.relative(repoRoot, file).replace(/\\/g, '/');

    it(`round-trips ${label}`, () => {
      const source = fs.readFileSync(file, 'utf8');

      // richtext ON, which is how the editor actually opens a document:
      // every richtext body goes out through remark to HTML for Tiptap and
      // comes back through turndown.
      const read = (mdx: string) => parseMdx(mdx, { strict: false, richtext });

      const first = read(source);

      // The playground ships canonicalized, so the first write is already
      // the fixpoint: opening and saving a page must not drift by a byte.
      const written = puckToMdx(first.data, first.frontmatter, gen);
      expect(written).toBe(source);

      const second = read(written);
      const rewritten = puckToMdx(second.data, second.frontmatter, gen);

      expect(rewritten).toBe(written);
      expect(second.data.content).toEqual(first.data.content);
      expect(second.frontmatter).toEqual(first.frontmatter);

      // And nothing may vanish: the same blocks, in the same order, nested
      // the same way, saying the same things.
      expect(outline(second.data.content)).toEqual(outline(first.data.content));
      expect(saidTheSame(second.data.content)).toEqual(saidTheSame(first.data.content));
    });
  }
});
