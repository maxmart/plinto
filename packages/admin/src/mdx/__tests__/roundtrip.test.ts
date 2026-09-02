/**
 * The editor's hard requirement: parse → generate must be byte-stable.
 * A document the generator wrote, opened and saved unchanged, must come back
 * identical — anything else dirties git history and, worse, can lose content.
 */
import type { Data } from '@puckeditor/core';
import { parseMdx, UnrepresentableContentError } from '../parser';
import { puckToMdx } from '../generator';
import { setSyncMeta } from '@plinto/core/sync-meta';
// A block map with one default-import entry (no `export`), because that is
// how the .astro block components are declared and the branch needs reaching.
const blockImports = {
  CmHero: { module: '@example/blocks/CmHero', export: 'CmHero' },
  CmText: { module: '@example/blocks/CmText', export: 'CmText' },
  CmColumns: { module: '@example/blocks/CmColumns', export: 'CmColumns' },
  CmColumn: { module: '@example/blocks/CmColumns', export: 'CmColumn' },
  CmNations: { module: '@/components/blocks/CmNations.astro' },
};

// These cases are about the *shape* of the format, not the richtext boundary —
// richtext-body.test.ts owns that. Stating it as a predicate that answers no
// keeps this suite on the syntax it is testing.
const gen = { richtext: () => false, blockImports };
const read = (mdx: string) => parseMdx(mdx, { richtext: false });

const doc = (content: unknown[], frontmatter?: Record<string, unknown>): string =>
  puckToMdx({ content, root: { props: {} } } as Data, frontmatter, gen);

/** generate → parse → generate again must reproduce the bytes. */
function expectStable(mdx: string): void {
  const parsed = read(mdx);
  const regenerated = puckToMdx(parsed.data, parsed.frontmatter, gen);
  expect(regenerated).toBe(mdx);
}

describe('puckToMdx → parseMdx round-trip', () => {
  it('is byte-stable for a full page', () => {
    expectStable(doc(
      [
        {
          type: 'CmHero',
          props: {
            id: 'CmHero-abc123',
            title: 'Welcome',
            subtitle: 'A subtitle with åäö',
            count: 3,
            featured: true,
            hidden: false,
          },
        },
        {
          type: 'CmColumns',
          props: {
            id: 'CmColumns-xyz',
            children: [
              { type: 'CmColumn', props: { id: 'CmColumn-1', children: [
                { type: 'CmText', props: { id: 'CmText-1', children: 'Some **markdown** text.' } },
              ] } },
              { type: 'CmColumn', props: { id: 'CmColumn-2', children: [] } },
            ],
          },
        },
      ],
      { layout: '@/layouts/LangLayout.astro', title: 'Home', rev: '3' },
    ));
  });

  it('is byte-stable for array and object props', () => {
    expectStable(doc([
      {
        type: 'CmHero',
        props: {
          id: 'CmHero-1',
          rows: [{ label: 'a', marks: [{ included: true }] }, { label: 'b [c]', marks: [] }],
          meta: { align: 'left', width: 3 },
        },
      },
    ]));
  });

  it('is byte-stable for multi-line string props', () => {
    expectStable(doc([
      { type: 'CmText', props: { id: 'CmText-1', body: 'line one\n\nline two with "quotes"' } },
    ]));
  });

  it('keeps indentation inside a multi-line prop', () => {
    // Why multi-line values go out as key={"…"} and not as a quoted attribute
    // spanning lines. MDX accepts the quoted form and then strips leading
    // whitespace from every continuation line, so a nested list flattens and
    // an indented code block becomes a paragraph — silent damage to any
    // markdown-bodied block. Do not "simplify" the generator into the
    // prettier form; this is the test that says why.
    const nested = '- one\n  - nested\n\n    code()\n\n\ttabbed';
    const mdx = doc([{ type: 'CmText', props: { id: 'CmText-1', body: nested } }]);
    expect((read(mdx).data.content[0] as { props: Record<string, unknown> }).props.body).toBe(nested);
    expectStable(mdx);

    // And the quoted form really does lose it — the reason above, verified.
    const quoted = `<CmText id="CmText-1" body="- one\n  - nested" />`;
    expect((read(quoted).data.content[0] as { props: Record<string, unknown> }).props.body)
      .toBe('- one\n- nested');
  });

  it('parses numbers and booleans back to their types', () => {
    const mdx = doc([
      { type: 'CmHero', props: { id: 'h', count: 42, on: true, off: false } },
    ]);
    const { data } = read(mdx);
    const props = (data.content[0] as { props: Record<string, unknown> }).props;
    expect(props.count).toBe(42);
    expect(props.on).toBe(true);
    expect(props.off).toBe(false);
  });
});

describe('frontmatter round-trip', () => {
  it('escapes double quotes inside quoted values', () => {
    const mdx = doc([], { title: 'He said: "hello"' });
    expect(read(mdx).frontmatter.title).toBe('He said: "hello"');
  });

  it('quotes date-shaped strings so they stay strings', () => {
    // The property, not the spelling: bare `date: 2025-12-11` is a YAML
    // timestamp and would come back as a Date. Which quote character the
    // dumper reaches for is its business.
    const mdx = doc([], { date: '2025-12-11' });
    expect(mdx).toMatch(/date: ['"]2025-12-11['"]/);
    expect(read(mdx).frontmatter.date).toBe('2025-12-11');
  });

  it('quotes a value whose leading whitespace would otherwise be eaten', () => {
    // The hand-rolled writer tested for indicators with a ^-anchored regex,
    // so a leading space defeated it: the value went out bare and the next
    // parse threw, leaving a page the editor had saved but could not open.
    const mdx = doc([], { title: ' "Bergen" Basket Festival' });
    expect(read(mdx).frontmatter.title).toBe(' "Bergen" Basket Festival');
  });

  it('keeps a null and an empty string instead of dropping them', () => {
    // Dropping a value the document set is data loss, however small.
    const mdx = doc([], { draft: null, subtitle: '' });
    const fm = read(mdx).frontmatter;
    expect(fm.draft).toBeNull();
    expect(fm.subtitle).toBe('');
  });

  it('does not fold a long description onto a second line', () => {
    const long = 'A description that runs well past the eighty characters a YAML dumper folds at by default.';
    const mdx = doc([], { description: long });
    expect(mdx).toContain(long);
    expect(read(mdx).frontmatter.description).toBe(long);
  });

  it('keeps strings that look like other types as strings', () => {
    const mdx = doc([], { code: '007', answer: 'yes', version: '1.10' });
    const fm = read(mdx).frontmatter;
    expect(fm.code).toBe('007');
    expect(fm.answer).toBe('yes');
    expect(fm.version).toBe('1.10');
  });

  it('normalizes an unquoted YAML date to an ISO string', () => {
    const fm = parseMdx('---\ndate: 2025-12-11\n---\n', { richtext: false }).frontmatter;
    expect(fm.date).toBe('2025-12-11');
  });

  it('carries arrays and maps through as YAML instead of mangling them', () => {
    const original = '---\ntags: ["a","b"]\nnested: {"x":1}\n---\n';
    const parsed = read(original);
    expect(parsed.frontmatter.tags).toEqual(['a', 'b']);
    const regenerated = puckToMdx(parsed.data, parsed.frontmatter, gen);
    expect(read(regenerated).frontmatter.tags).toEqual(['a', 'b']);
    expect(read(regenerated).frontmatter.nested).toEqual({ x: 1 });
  });
});

describe('values the writer and the reader must agree about', () => {
  const propsOf = (mdx: string) =>
    (read(mdx).data.content[0] as { props: Record<string, unknown> }).props;

  it('keeps a prop the user cleared to an empty string', () => {
    // Dropping it made the prop absent, and Puck refills an absent prop from
    // defaultProps — so clearing a field could hand back what was deleted.
    const mdx = doc([{ type: 'CmHero', props: { id: 'h', heading: '', n: 0, b: false } }]);
    expect(propsOf(mdx)).toEqual({ id: 'h', heading: '', n: 0, b: false });
    expectStable(mdx);
  });

  it('writes no attribute for a number that cannot be spelled', () => {
    // NaN and Infinity go out as bare identifiers, which the reader refuses —
    // the file could be saved and then never reopened.
    const mdx = doc([{ type: 'CmHero', props: { id: 'h', a: NaN, b: Infinity, c: 3 } }]);
    expect(propsOf(mdx)).toEqual({ id: 'h', c: 3 });
    expectStable(mdx);
  });

  it('escapes an id like any other attribute', () => {
    expectStable(doc([{ type: 'CmHero', props: { id: 'a"b&c<d' } }]));
    expect(propsOf(doc([{ type: 'CmHero', props: { id: 'a"b' } }])).id).toBe('a"b');
  });

  it('refuses a literal it could only approximate', () => {
    // Both used to be accepted and then written back as something else: the
    // regex as {}, the bigint as a string.
    expect(() => parseMdx(`<CmHero id="h" re={/ab+c/i} />`, { richtext: false })).toThrow(UnrepresentableContentError);
    expect(() => parseMdx(`<CmHero id="h" big={123n} />`, { richtext: false })).toThrow(UnrepresentableContentError);
    expect(() => parseMdx(`<CmHero id="h" n={NaN} />`, { richtext: false })).toThrow(UnrepresentableContentError);
  });

  it('keeps a key called __proto__ instead of losing it to the prototype', () => {
    // Asserted through getOwnPropertyDescriptor, because an object literal
    // written `{__proto__: 1}` sets the prototype rather than adding a key —
    // which is the whole bug, and would quietly make this test pass empty.
    const data = propsOf(`<CmHero id="h" data={{"__proto__": 1, "ok": 2}} />`).data as object;
    expect(Object.keys(data).sort()).toEqual(['__proto__', 'ok']);
    expect(Object.getOwnPropertyDescriptor(data, '__proto__')?.value).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('markdown bodies keep their shape', () => {
  const body = (mdx: string) =>
    (parseMdx(mdx, { strict: false, richtext: false }).data.content[0] as { props: { children?: unknown } }).props.children;

  it('keeps a nested list nested', () => {
    // The body is dedented by the block's own indent. Measuring the
    // shallowest line below instead read the nesting as the body indent, so
    // the sub-item was promoted — in the editor and on disk, with no error.
    expect(body(`<CmText id="t">\n  - a\n    - b\n</CmText>`)).toBe('- a\n  - b');
  });

  it('keeps an indented code block a code block', () => {
    expect(body(`<CmText id="t">\n  Intro\n\n      code()\n</CmText>`)).toBe('Intro\n\n    code()');
  });

  it('keeps a deeper list nested', () => {
    expect(body(`<CmText id="t">\n  1. a\n     1. b\n</CmText>`)).toBe('1. a\n   1. b');
  });

  it('round-trips a nested list byte-identically', () => {
    expectStable(doc([{ type: 'CmText', props: { id: 'CmText-1', children: '- a\n  - b\n- c' } }]));
  });

  it('does not eat characters from a line indented less than the body', () => {
    expect(body(`<CmText id="t">\n    deep\nshallow\n</CmText>`)).toBe('deep\nshallow');
  });

  it('keeps a fenced code block, including its indentation', () => {
    // Fenced is the form to use inside a block body. An *indented* code block
    // cannot survive here and the ambiguity is real, not an oversight: the
    // body's own indent and the code block's four spaces are the same
    // characters, and the leading whitespace of the first line has to be
    // removed for the common case — a body written lazily, with its first
    // line indented and the rest not, otherwise gains two spaces on every
    // save and grows without limit. A fence says which is which.
    expect(body(`<CmText id="t">\n  \`\`\`js\n  const a = 1;\n  \`\`\`\n</CmText>`))
      .toBe('```js\nconst a = 1;\n```');
  });

  it('round-trips a fenced code block byte-identically', () => {
    expectStable(doc([
      { type: 'CmText', props: { id: 'CmText-1', children: '```js\nconst a = 1;\n```' } },
    ]));
  });

  it('measures a tab the way markdown does', () => {
    // A tab is one character and four columns. Counting characters took the
    // whole tab off and flattened the list.
    expect(body(`<CmText id="t">\n  - a\n\t- b\n</CmText>`)).toBe('- a\n  - b');
  });

  it('round-trips a body the author emptied', () => {
    // An empty body has no spelling — `<X>\n\n</X>` reads back as no children
    // at all, and Puck then refills children from defaultProps, handing back
    // the text that was just deleted.
    const mdx = doc([{ type: 'CmText', props: { id: 'CmText-1', children: '' } }]);
    expect((read(mdx).data.content[0] as { props: Record<string, unknown> }).props.children).toBe('');
    expectStable(mdx);
  });
});

describe('one frontmatter writer', () => {
  it('agrees with the one the translation sync uses', () => {
    // The editor and the sync engine both write frontmatter. When they had a
    // writer each they disagreed about how to spell `synced`, so translating
    // a page and then editing it reformatted each other's work on every
    // alternation — noise in every diff, forever.
    const page = doc(
      [{ type: 'CmHero', props: { id: 'CmHero-1', title: 'Hej' } }],
      { title: 'Hej', layout: '@/layouts/LangLayout.astro' },
    );
    const stamped = setSyncMeta(page, 3, { sv: 3, no: 2 });

    const parsed = read(stamped);
    expect(parsed.frontmatter.rev).toBe(3);
    expect(parsed.frontmatter.synced).toEqual({ sv: 3, no: 2 });

    // Opening and saving it changes nothing at all — down to the last byte,
    // which is the newline both writers now end on.
    expect(puckToMdx(parsed.data, parsed.frontmatter, gen)).toBe(stamped);
  });
});

describe('hand-authored attribute forms', () => {
  it('reads single-quoted JSX object literals without eval', () => {
    const mdx = `<CmHero\n  id="h"\n  rows={[{ label: 'it\\'s fine', n: 2 }]}\n/>`;
    const { data } = read(mdx);
    const props = (data.content[0] as { props: Record<string, unknown> }).props;
    expect(props.rows).toEqual([{ label: "it's fine", n: 2 }]);
  });

  it('tolerates trailing commas', () => {
    const mdx = `<CmHero id="h" rows={[1, 2,]} meta={{a: 1,}} />`;
    const props = (read(mdx).data.content[0] as { props: Record<string, unknown> }).props;
    expect(props.rows).toEqual([1, 2]);
    expect(props.meta).toEqual({ a: 1 });
  });

  it('is byte-stable for negative and exponent numbers', () => {
    expectStable(doc([{ type: 'CmHero', props: { id: 'h', offset: -8, tiny: 1e-7 } }]));
  });

  it('keeps a hand-authored negative numeric prop, sign and all', () => {
    // The old regex reader matched `{(\d+…)}` — no branch accepted a minus
    // sign, so a negative prop was silently dropped and the next save wrote
    // the page without it. A pulled-up margin is an ordinary thing for an
    // editor to set; the value must come back as the number it was.
    const props = (read(`<CmHero id="h" offset={-8} half={-0.5} />`).data.content[0] as { props: Record<string, unknown> }).props;
    expect(props.offset).toBe(-8);
    expect(props.half).toBe(-0.5);
  });

  it('refuses a bare expression it cannot represent instead of dropping it', () => {
    expect(() => parseMdx(`<CmHero id="h" data={getData()} />`, { richtext: false })).toThrow(UnrepresentableContentError);
    // null and undefined too: the generator writes no attribute for them, so
    // storing one would drop it on the next save.
    expect(() => parseMdx(`<CmHero id="h" n={null} />`, { richtext: false })).toThrow(UnrepresentableContentError);
    expect(() => parseMdx(`<CmHero id="h" n={undefined} />`, { richtext: false })).toThrow(UnrepresentableContentError);
  });

  it('refuses a spread attribute', () => {
    expect(() => parseMdx(`<CmHero id="h" {...rest} />`, { richtext: false })).toThrow(UnrepresentableContentError);
  });

  it('keeps a > inside an expression value intact', () => {
    // JSON.stringify does not escape '>', so a textarea prop can hold one.
    // The old scanner cut the tag at that '>' and truncated the value.
    const mdx = `<CmColumns id="c" note={"Start -> Program -> Cup Manager"}>\n  <CmColumn id="c1" />\n</CmColumns>`;
    const props = (read(mdx).data.content[0] as { props: Record<string, unknown> }).props;
    expect(props.note).toBe('Start -> Program -> Cup Manager');
  });

  it('round-trips a > inside an expression value on a container byte-identically', () => {
    expectStable(doc([
      {
        type: 'CmColumns',
        props: {
          id: 'c',
          note: 'Tip: run as admin.\n\nStart -> Program -> Cup Manager',
          children: [{ type: 'CmColumn', props: { id: 'c1' } }],
        },
      },
    ]));
  });

  it('refuses an unbalanced attribute value instead of dropping it', () => {
    expect(() => parseMdx(`<CmHero id="h" rows={[1, 2 />`, { richtext: false })).toThrow(UnrepresentableContentError);
  });

  it('refuses an unparseable attribute on a NESTED child too', () => {
    const mdx = `<CmColumns id="c">\n  <CmColumn id="c1" data={{x: fn()}} />\n</CmColumns>`;
    expect(() => read(mdx)).toThrow(UnrepresentableContentError);
  });

  it('keeps structure in non-strict mode when a container prop refuses', () => {
    const mdx = `<CmColumns id="c" theme={{color: getColor()}}>\n  <CmColumn id="c1" />\n</CmColumns>`;
    const { data, skipped } = parseMdx(mdx, { strict: false, richtext: false });
    const top = data.content[0] as { type: string; props: { children: unknown[] } };
    expect(top.type).toBe('CmColumns');
    expect(top.props.children).toHaveLength(1);
    expect(skipped.length).toBeGreaterThan(0);
  });

  it('does not read ={ inside quoted strings as an attribute', () => {
    const mdx = `<CmHero id="h" title="use fn={x} here" body={"also ={y} inline"} />`;
    const props = (read(mdx).data.content[0] as { props: Record<string, unknown> }).props;
    expect(props.title).toBe('use fn={x} here');
    expect(props.body).toBe('also ={y} inline');
  });

  it('mints no phantom props from expression-looking text inside values', () => {
    const mdx = `<CmHero id="h" title="price x={-8} kr" note="see n={5} docs" data={{"tip":"y={1e-7}"}} />`;
    const props = (read(mdx).data.content[0] as { props: Record<string, unknown> }).props;
    expect(Object.keys(props).sort()).toEqual(['data', 'id', 'note', 'title']);
    expect(props.title).toBe('price x={-8} kr');
  });

  it('still refuses the real bare expression when a value contains a lookalike', () => {
    expect(() => parseMdx(`<CmHero id="h" title="see n={5} docs" n={notAllowed()} />`, { richtext: false }))
      .toThrow(UnrepresentableContentError);
  });

  it('reads a value containing a backslash without losing the rest of the tag', () => {
    // escapeAttribute entity-encodes but never escapes backslashes, so the
    // generator emits path="C:\" — the walk must not treat \ as an escape.
    const mdx = String.raw`<CmHero id="h" path="C:\" note="try width={x} ok" />`;
    const { data, skipped } = read(mdx);
    const props = (data.content[0] as { props: Record<string, unknown> }).props;
    expect(props.path).toBe('C:\\');
    expect(props.note).toBe('try width={x} ok');
    expect(skipped).toEqual([]);
  });

  it('round-trips a backslash-bearing value byte-identically', () => {
    expectStable(doc([{ type: 'CmHero', props: { id: 'h', path: 'C:\\Users\\max' } }]));
  });
});

describe('nested frontmatter dates', () => {
  it('keeps nested dates as ISO strings instead of UTC timestamps', () => {
    const parsed = parseMdx('---\nevents:\n  - 2026-05-01\n---\n', { richtext: false });
    expect(parsed.frontmatter.events).toEqual(['2026-05-01']);
    const regenerated = puckToMdx(parsed.data, parsed.frontmatter, gen);
    // Written back inline (flowLevel), and still strings on the way in again.
    expect(regenerated).toMatch(/events: \[['"]2026-05-01['"]\]/);
    expect(read(regenerated).frontmatter.events).toEqual(['2026-05-01']);
  });

  it('keeps second precision on nested timestamps', () => {
    const parsed = parseMdx('---\nevents:\n  - start: 2026-06-01 10:30:45\n---\n', { richtext: false });
    const events = parsed.frontmatter.events as { start: string }[];
    expect(events[0].start).toBe('2026-06-01T10:30:45.000Z');
  });

  it('keeps second precision at the top level too', () => {
    // It used to truncate to minutes here while keeping them one level down,
    // so the same value in the same file was read two different ways — and a
    // save wrote the shorter one back permanently.
    const fm = parseMdx('---\nstart: 2026-06-01 10:30:45\n---\n', { richtext: false }).frontmatter;
    expect(fm.start).toBe('2026-06-01T10:30:45.000Z');
  });

  it('still shortens a bare midnight to a date', () => {
    expect(parseMdx('---\ndate: 2026-06-01\n---\n', { richtext: false }).frontmatter.date).toBe('2026-06-01');
  });

  it('survives cyclic YAML anchors without a stack overflow', () => {
    expect(() => parseMdx('---\na: &x\n  self: *x\n---\n', { richtext: false })).not.toThrow(RangeError);
  });

  it('normalizes both occurrences of a YAML-aliased node, not just the first', () => {
    const fm = parseMdx('---\nevents:\n  - &d\n    when: 2026-05-01\n  - *d\n---\n', { richtext: false }).frontmatter;
    const events = fm.events as { when: string }[];
    expect(events[0].when).toBe('2026-05-01');
    expect(events[1].when).toBe('2026-05-01');
  });
});

describe('unrepresentable content', () => {
  it('throws on loose prose in strict mode', () => {
    expect(() => parseMdx('Just a paragraph of prose.\n', { richtext: false })).toThrow(UnrepresentableContentError);
  });

  it('reports mixed text and child components instead of dropping the text', () => {
    const mdx = `<CmColumns id="c">\n  stray text\n  <CmColumn id="c1" />\n</CmColumns>`;
    expect(() => read(mdx)).toThrow(UnrepresentableContentError);
    const { skipped } = parseMdx(mdx, { strict: false, richtext: false });
    expect(skipped.some(s => s.text.includes('stray text'))).toBe(true);
  });
});

describe('import block', () => {
  it('regenerates imports from the registry map', () => {
    const mdx = doc([{ type: 'CmHero', props: { id: 'h', title: 'x' } }]);
    expect(mdx).toContain(`import { CmHero } from '@example/blocks/CmHero';`);
  });

  it('groups blocks from the same module into one import', () => {
    const mdx = doc([
      { type: 'CmColumns', props: { id: 'c', children: [
        { type: 'CmColumn', props: { id: 'c1', children: [] } },
      ] } },
    ]);
    expect(mdx).toContain(`import { CmColumn, CmColumns } from '@example/blocks/CmColumns';`);
  });

  it('fails loudly for a block missing from the import map', () => {
    expect(() => doc([{ type: 'Unknown', props: { id: 'u' } }])).toThrow(/restart the dev server/);
  });
});

describe('raw HTML where a block was expected', () => {
  const body = (html: string) =>
    `<CmText id="t">\n${html.split('\n').map(l => (l ? `  ${l}` : '')).join('\n')}\n</CmText>`;

  it('carries a table it can hold as the block body', () => {
    // One line, cells with text in them: remark reads this as part of the
    // body's prose, so it is a markdown string like any other and the
    // richtext round trip keeps it.
    const table = '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
    const parsed = parseMdx(body(table), { richtext: false });
    expect((parsed.data.content[0] as any).props.children).toContain('<table>');
    expect(() => puckToMdx(parsed.data, parsed.frontmatter, gen)).not.toThrow();
  });

  const refused: [string, string][] = [
    ['a void element alone in a cell', '<table><tbody><tr><td><br /></td></tr></tbody></table>'],
    ['written across lines', '<table>\n  <tbody><tr><td>a</td></tr></tbody>\n</table>'],
  ];

  for (const [what, html] of refused) {
    it(`refuses a table ${what}, and says why`, () => {
      // These parse as flow elements, so the old code made them blocks named
      // after the tag — `table`, with children `tbody` and `tr`. The page
      // opened, and the *save* then failed with "Block \"table\" is not in
      // the import map. If it was just added to the registry, restart the dev
      // server." Restarting cannot help; the registry was never going to
      // contain a table.
      expect(() => parseMdx(body(html), { richtext: false })).toThrow(UnrepresentableContentError);
      const { skipped } = parseMdx(body(html), { strict: false, richtext: false });
      const message = skipped.map(s => s.text).join('\n');
      expect(message).toContain('<table>');
      expect(message).toContain('raw HTML');
      expect(message).not.toContain('restart the dev server');
    });
  }

  it('still treats a capitalised name as a block', () => {
    // JSX's own rule, and the whole distinction: lowercase is an element,
    // capitalised is a component.
    expect(() => parseMdx(body('<CmHero id="h" title="x" />'), { richtext: false })).not.toThrow();
  });
});

describe('what counts as a block', () => {
  // MDX's rule, which is JSX's: a name is intrinsic exactly when it starts
  // with a lowercase ASCII letter and holds no dot. This was `/^[A-Z]/` for
  // one round — a narrower rule, and the gap refused a site's own registered
  // block. `Öppettider` is an entirely natural name in this monorepo.
  const components = ['CmText', 'Årsmöte', 'Öppettider', 'Élan', '_Divider', '$Icon'];
  const intrinsics = ['table', 'span', 'br', 'div'];
  // MDX calls these components; plinto cannot hold them, and that is a
  // different question. A registry is keyed by bare name and the generated
  // import is `import { Name }`, which cannot spell a dot — so accepting them
  // meant the page opened and the save then failed with "restart the dev
  // server", where restarting could never have helped.
  const dotted = ['motion.div', 'foo.Bar', 'A.B.C'];

  const complaints = (mdx: string) =>
    parseMdx(mdx, { strict: false, richtext: false }).skipped.map(s => s.text).join('\n');

  for (const name of components) {
    it(`<${name}> is a block`, () => {
      expect(complaints(`<${name} id="x">\n  body\n</${name}>`)).not.toContain('raw HTML');
    });
  }

  for (const name of intrinsics) {
    it(`<${name}> is raw HTML`, () => {
      expect(complaints(`<${name} id="x">\n  body\n</${name}>`)).toContain('raw HTML');
    });
  }

  for (const name of dotted) {
    it(`<${name}> is refused as a dotted name, not as raw HTML`, () => {
      const said = complaints(`<${name} id="x">\n  body\n</${name}>`);
      expect(said).toContain('dotted name');
      expect(said).not.toContain('raw HTML');
    });
  }

  it('names one obstacle per table, not one per tag', () => {
    // Naming <table>, then <tbody>, then <tr> is three paragraphs of the same
    // sentence about the same problem, and the dialog showed all of them.
    const { skipped } = parseMdx(
      '<CmText id="t">\n  <table>\n    <tbody><tr><td>a</td></tr></tbody>\n  </table>\n</CmText>',
      { strict: false, richtext: false },
    );
    const raw = skipped.filter(s => s.text.includes('raw HTML'));
    expect(raw).toHaveLength(1);
    expect(raw[0].text).toContain('<table>');
  });

  it('stays quiet about the rest of a blob it has already refused', () => {
    // Every one of these is a sentence about markup the first report already
    // refuses wholesale, and none can be acted on except by removing the div.
    const { skipped } = parseMdx(
      '<div data-x={call()}>\n  Intro text\n  <section>\n    <article>x</article>\n  </section>\n</div>',
      { strict: false, richtext: false },
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0].text).toContain('<div>');
  });

  it('but a real block inside the blob still speaks for itself', () => {
    // The block is not part of the blob, so it un-mutes — and so does what is
    // wrong *inside* it. Reporting only the div sent the user to remove it,
    // reopen, and meet a refusal nobody had mentioned.
    const { skipped } = parseMdx(
      '<div>\n  <CmText id="t">\n    <table>\n      <tbody><tr><td>a</td></tr></tbody>\n    </table>\n  </CmText>\n</div>',
      { strict: false, richtext: false },
    );
    const said = skipped.map(s => s.text).join('\n');
    expect(said).toContain('<div>');
    expect(said).toContain('<table>');
  });

  it('names a fragment as a fragment', () => {
    // It has no name, so "<null> is raw HTML" named nothing — and before that
    // it was silent: a fragment parsed as a block with no type, which the
    // generator dropped along with everything inside it.
    expect(complaints('<CmText id="t">\n  <>\n    x\n  </>\n</CmText>')).toContain('fragment');
  });
});
