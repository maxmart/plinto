/**
 * A save keeps what it did not change.
 *
 * Opening a hand-written page and saving it untouched used to produce a
 * 33-line diff of formatting alone (asewerner-site, #4). The generator now
 * writes each part of the document the edit left alone — frontmatter,
 * imports, a block, a child block — as its original text.
 */
import { parseMdx, type ParsedMdx } from '../parser';
import { puckToMdx } from '../generator';
import type { BlockImportMap } from '../../block-imports';

const richtext = (_type: string, field: string) => field === 'children';
const blockImports: BlockImportMap = {
  Hero: { module: '@/components', export: 'Hero' },
  Cards: { module: '@/components', export: 'Cards' },
  Card: { module: '@/components', export: 'Card' },
  Note: { module: '@/components', export: 'Note' },
};

// Every way a hand-written page differs from the generator's own form: a
// relative import in another order, the id on its own line, single quotes
// inside an expression, a body indented by four, a single newline between
// blocks, a frontmatter key order and quoting of its own.
const page = `---
description: "About us"
title: Om oss
---

import { Note, Hero, Cards, Card } from '../components';

<Hero
  title="Hej"
  actions={[{ href: 'mailto:a@b.se', label: 'Mejla' }]}
/>
<Note>
    Some *markdown* here.
</Note>

<Cards title="Kort">
  <Card title="Ett" />
  <Card title="Två" />
</Cards>
`;

const open = (source: string): ParsedMdx => parseMdx(source, { richtext, ensureIds: true });
const original = (source: string): ParsedMdx => parseMdx(source, { strict: false, richtext });
const save = (doc: ParsedMdx, source: string, frontmatter = doc.frontmatter) =>
  puckToMdx(doc.data, frontmatter, { richtext, blockImports, original: original(source) });

type Block = { type: string; props: Record<string, any> };
const blocks = (doc: ParsedMdx) => doc.data.content as unknown as Block[];

describe('keeping the source', () => {
  it('writes an untouched page back byte for byte', () => {
    expect(save(open(page), page)).toBe(page);
  });

  it('rewrites only the block that changed', () => {
    const doc = open(page);
    blocks(doc)[0].props.title = 'Hallå';
    const out = save(doc, page);
    expect(out).toContain('<Hero id="Hero-');
    expect(out).toContain('title="Hallå"');
    // Everything else as it was, imports included.
    expect(out).toContain(`import { Note, Hero, Cards, Card } from '../components';`);
    expect(out).toContain('<Note>\n    Some *markdown* here.\n</Note>');
    expect(out).toContain('<Cards title="Kort">\n  <Card title="Ett" />\n  <Card title="Två" />\n</Cards>');
    expect(out.startsWith('---\ndescription: "About us"\ntitle: Om oss\n---\n')).toBe(true);
  });

  it('keeps the other children of a block whose children changed', () => {
    const doc = open(page);
    const cards = blocks(doc)[2];
    cards.props.children.push({ type: 'Card', props: { id: 'Card-new', title: 'Tre' } });
    const out = save(doc, page);
    expect(out).toContain('  <Card title="Ett" />\n  <Card title="Två" />\n  <Card id="Card-new"');
  });

  it('separates neighbours afresh when a block between them is deleted', () => {
    const doc = open(page);
    blocks(doc).splice(1, 1);
    const out = save(doc, page);
    expect(out).not.toContain('<Note>');
    expect(out).toContain('/>\n\n<Cards title="Kort">');
  });

  it('writes the imports fresh when the set of blocks changes', () => {
    const doc = open(page);
    blocks(doc).splice(1, 1);
    expect(save(doc, page)).toContain(`import { Card, Cards, Hero } from '@/components';`);
  });

  it('writes the frontmatter fresh when it changes, and keeps the blocks', () => {
    const doc = open(page);
    const out = save(doc, page, { ...doc.frontmatter, title: 'Ny' });
    expect(out.startsWith('---\ndescription: About us\ntitle: Ny\n---\n')).toBe(true);
    expect(out).toContain('<Note>\n    Some *markdown* here.\n</Note>');
  });

  it('writes a duplicated id fresh, keeping the first holder', () => {
    const dup = `<Note id="a">\n  One\n</Note>\n\n<Note id="a">\n  Two\n</Note>\n`;
    const out = puckToMdx(open(dup).data, undefined, { richtext, blockImports, original: original(dup) });
    expect(out).toContain('<Note id="a">\n  One\n</Note>');
    expect(out).toMatch(/<Note id="Note-[0-9a-f-]{36}">\n {2}Two\n<\/Note>/);
  });

  it('reads the same as what the generator would have written', () => {
    const doc = open(page);
    blocks(doc)[0].props.title = 'Hallå';
    const fresh = puckToMdx(doc.data, doc.frontmatter, { richtext, blockImports });
    const kept = save(doc, page);
    const strip = (d: ParsedMdx) => JSON.stringify(d.data.content, (k, v) => (k === 'id' ? undefined : v));
    expect(strip(original(kept))).toBe(strip(original(fresh)));
  });
});
