/**
 * The playground as a test corpus.
 *
 * Every page, partial and collection entry the example site holds is opened the
 * way the editor opens it and written back the way a save writes it. What the
 * generator produces must parse to the same blocks — the property that makes
 * "open a page, change one word, save" safe.
 *
 * This is the test that would have caught the truncation bugs: a real document
 * with a '>' inside an attribute value only exists in the corpus.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The corpus spans every block type the example uses. Spelling each one
// into the shared test config would test the fixture rather than the
// documents, so this file alone resolves any block name to a plausible
// import; the generator's real refusal of an unknown block is covered by its
// own test against the honest fixture.
// The field names the example actually declares with richtext(). They
// matter more than they look: `isRichtextField` decides whether a value takes
// the markdown↔HTML round trip through Tiptap and turndown, and with the
// plain fixture — whose `blocks` is empty — it answers false for everything,
// so every test skipped the conversion entirely. Three separate content-
// destroying bugs lived on that path for two review rounds because of it.
const RICHTEXT_FIELDS = ['answer', 'bio', 'body', 'children', 'content'];

// Both handed in, because the parser and the generator take them as
// arguments now. This test used to mock two modules to get here — and the
// reason it had to is the reason it once proved nothing: a module that reads
// its own registry cannot be given a different one.
const richtext = (_type: string, field: string) => RICHTEXT_FIELDS.includes(field);
const blockImports = new Proxy({} as Record<string, { module: string; export: string }>, {
  get: (_t, name: string) => ({ module: `@example/blocks/${name}`, export: name }),
  has: () => true,
});
const gen = { richtext, blockImports };

import { parseMdx } from '../parser';
import { puckToMdx } from '../generator';

/**
 * Found by walking up to the directory that holds `examples/`, not by counting
 * `..` — a count is wrong the moment the file moves, and it moved: this test
 * lived four package levels deeper before the admin became its own package,
 * and it failed by finding nothing rather than by finding the wrong thing.
 */
const repoRoot = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url));
  while (!fs.existsSync(path.join(dir, 'examples'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error('corpus test: no repository root above ' + import.meta.url);
    dir = up;
  }
  return dir;
})();

function mdxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(full);
    return entry.name.endsWith('.mdx') ? [full] : [];
  });
}

const corpus = [
  ...mdxFiles(path.join(repoRoot, 'examples')),
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
 * Every value, compared for what it says rather than how it is spaced.
 *
 * A richtext body goes out to HTML and back, and a soft line break inside a
 * paragraph — a bare newline in the markdown — returns as the space it always
 * rendered as. That is spelling. Structure is not: a lost list nesting, a
 * table flattened into paragraphs, a loose list tightened all change the
 * tags, and collapsing whitespace hides none of them.
 */
const saidTheSame = (nodes: unknown[]): unknown =>
  JSON.parse(JSON.stringify(nodes, (_key, value) =>
    typeof value === 'string'
      ? value
          // A loose list becomes a tight one, and that is deliberate: Tiptap
          // wraps every list item's text in a <p> regardless, so the
          // distinction cannot survive an edit. Preserving it in this path
          // while the editor destroys it in the other is the incoherence,
          // not the normalisation. See the markdown-html tests.
          .replace(/<li>\s*<p>([\s\S]*?)<\/p>\s*<\/li>/g, '<li>$1</li>')
          .replace(/\s+/g, ' ')
          .trim()
      : value));

describe('the repository as a corpus', () => {
  it('found documents to check', () => {
    expect(corpus.length).toBeGreaterThan(20);
  });

  for (const file of corpus) {
    const label = path.relative(repoRoot, file).replace(/\\/g, '/');

    it(`round-trips ${label}`, () => {
      const source = fs.readFileSync(file, 'utf8');

      // richtext ON, which is how the editor actually opens a document: every
      // richtext body goes out through remark to HTML for Tiptap and comes
      // back through turndown. This test used to pass `richtext: false` and
      // so exercised the one path that skips all of that — the path where a
      // GFM table was flattened into loose cells, every list marker was
      // repadded, and a typed `<` produced a file that could not be reopened.
      // A safety net that avoids the dangerous half is not one.
      //
      // Not strict: a few documents legitimately hold prose the block editor
      // cannot represent, and the editor refuses those loudly.
      const read = (mdx: string) => parseMdx(mdx, { strict: false, richtext });

      const first = read(source);

      // The first write canonicalizes hand-authored formatting: indentation,
      // trailing spaces on blank lines, props whose value is the empty string
      // (which the format has no spelling for). That is the one allowed
      // difference, and it happens once.
      const written = puckToMdx(first.data, first.frontmatter, gen);
      const second = read(written);
      const rewritten = puckToMdx(second.data, second.frontmatter, gen);
      const third = read(rewritten);

      // From there on, editing is safe: opening and saving must not drift by
      // a byte, and the data must be identical.
      expect(rewritten).toBe(written);
      expect(third.data.content).toEqual(second.data.content);
      expect(third.frontmatter).toEqual(second.frontmatter);

      // And nothing may vanish in the canonicalizing pass either: the same
      // blocks, in the same order, nested the same way.
      expect(outline(second.data.content)).toEqual(outline(first.data.content));

      // Down to the values, not just the shape. `outline` compares block
      // types and nesting and never looks at a body, so every content bug
      // this suite has caught — a flattened nested list, a table turned into
      // loose cells, a tightened list — was invisible to it and had to be
      // found by reading instead.
      expect(saidTheSame(second.data.content)).toEqual(saidTheSame(first.data.content));

      // The canonicalizing pass reformats frontmatter — quote style, flow
      // style — so it must be provably about spelling and nothing else. Same
      // keys, same values, same types as the file on disk. `rev` is why this
      // matters: it reaches the sync engine through a `typeof === 'number'`
      // guard, so a re-spelling that turned it into a string would silently
      // restart every document's vector clock at 0.
      expect(second.frontmatter).toEqual(first.frontmatter);
    });
  }
});
