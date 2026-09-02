/**
 * The boundary between what the editor holds (HTML) and what the file stores
 * (markdown inside MDX). MDX is stricter than markdown, and this is where
 * that difference has to be handled — or a sentence someone typed becomes a
 * file nobody can open.
 */
import { htmlToMarkdown, markdownToHtml } from '../markdown-html';
import { parseMdx } from '../parser';

/** The body a block gets when this markdown is written into a document. */
function bodyOf(markdown: string): unknown {
  const mdx = `<CmText id="t">\n${markdown.split('\n').map(l => (l ? `  ${l}` : '')).join('\n')}\n</CmText>`;
  return (parseMdx(mdx, { richtext: false }).data.content[0] as { props: { children?: unknown } }).props.children;
}

describe('htmlToMarkdown escapes what MDX reads as syntax', () => {
  const cases: [string, string][] = [
    ['<p>Use the &lt;name&gt; placeholder</p>', 'Use the \\<name> placeholder'],
    ['<p>Use {first name} here</p>', 'Use \\{first name} here'],
    ['<p>An open { brace alone</p>', 'An open \\{ brace alone'],
    ['<p>a &lt; b</p>', 'a \\< b'],
  ];

  for (const [html, expected] of cases) {
    it(`escapes ${JSON.stringify(html)}`, () => {
      expect(htmlToMarkdown(html)).toBe(expected);
    });
  }

  it('leaves real markup alone', () => {
    expect(htmlToMarkdown('<p>Real <strong>markup</strong> stays</p>')).toBe('Real **markup** stays');
  });

  it('escapes plain text too, which also ends up in an MDX file', () => {
    expect(htmlToMarkdown('An open { brace')).toBe('An open \\{ brace');
  });

  it('does not escape twice, so re-saving is a no-op', () => {
    const once = htmlToMarkdown('<p>Use the &lt;name&gt; placeholder</p>');
    expect(htmlToMarkdown(markdownToHtml(once))).toBe(once);
  });

  it('escapes a bracket that follows a literal backslash', () => {
    // Turndown escapes the backslash first, so what arrives here is
    // `C:\\<name>`. Looking behind for a single backslash read that as
    // already-escaped and let the tag through raw — an unclosed tag in the
    // file, and a page that would not reopen.
    const md = htmlToMarkdown('<p>C:\\&lt;name&gt; is the path</p>');
    expect(bodyOf(md)).toBe(md);            // parses, rather than throwing
    expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
  });

  it('leaves code spans and fences alone', () => {
    // Inside code a backslash is not an escape, it renders — so escaping
    // there corrupts the text visibly, and is unnecessary because MDX does
    // not read `<` or `{` as syntax inside code either.
    expect(htmlToMarkdown('<p>Set the <code>{lang}</code> and <code>&lt;slot&gt;</code> values.</p>'))
      .toBe('Set the `{lang}` and `<slot>` values.');
    expect(htmlToMarkdown('<pre><code>const x = { a: 1 };\n</code></pre>'))
      .toContain('const x = { a: 1 };');
  });

  it('still escapes around a code span, not just outside all of them', () => {
    expect(htmlToMarkdown('<p>A &lt;tag&gt; then <code>{x}</code> then &lt;other&gt;</p>'))
      .toBe('A \\<tag> then `{x}` then \\<other>');
  });
});

describe('markdown survives the trip through the editor', () => {
  // Every one of these is markdown that real pages in this repository
  // contain. The editor holds HTML, so each is converted out and back on
  // every open and save; anything that does not come back identical is a
  // document rewritten by being looked at.
  const cases: Record<string, string> = {
    'a GFM table': '|  | 1 | 2 |\n| --- | --- | --- |\n| **1** | 0 | 0 |\n| **2** | 0 | 1 |',
    'an ordered list': '1. Förening\n2. Postkod\n3. Stad',
    'a bullet list': '- Gruppindelning av lag\n- Slutspel (mer text)\n- Matchindelning',
    'a nested list': '- one\n  - nested\n- two',
    'a list that does not start at one': '10. ten\n11. eleven',
    'a table between paragraphs': 'Intro text\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- after\n- the table',
    'emphasis and code': 'Some **bold** and *italic* and `code`.',
    'a link': 'A [link](https://x.test) here.',
    'a heading': '## A heading\n\nAnd a paragraph.',
    'a blockquote': '> A quote line',
  };

  for (const [name, markdown] of Object.entries(cases)) {
    it(`keeps ${name}`, () => {
      expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
    });
  }

  it('keeps content nested under an ordered item attached to it', () => {
    // The continuation indent has to reach the item's content column, which
    // for `1. ` is three. At two, CommonMark reads the sublist as a sibling
    // of the list: the <ol> ends early, and each save pushes it further out
    // of shape. Nine documents in this repository have exactly this shape.
    const md = '1. one\n   1. sub a\n   2. sub b\n2. two';
    expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
    expect(markdownToHtml(htmlToMarkdown(markdownToHtml(md)))).toBe(markdownToHtml(md));
  });

  it('keeps a second paragraph inside an ordered item', () => {
    // Two paragraphs in one item make the whole list loose, so the round trip
    // writes the blank line between items that says so. Different bytes,
    // identical document — asserted as such rather than pinned to a spelling.
    const md = '1. item\n\n   more about it\n2. next';
    const back = htmlToMarkdown(markdownToHtml(md));
    expect(back).toContain('   more about it');
    expect(markdownToHtml(back)).toBe(markdownToHtml(md));
  });

  it('normalises a loose list to a tight one, on purpose', () => {
    // Looseness does not survive this editor. Tiptap's listItem is
    // `content: "paragraph block*"`, so every list it hands back wraps each
    // item's text in a <p> — the shape that *means* loose — whether the
    // source was loose or not.
    //
    // A rule that preserved looseness by looking for that <p> therefore read
    // the source correctly and the editor not at all: it turned "4 loose
    // lists tighten" into "93 tight lists loosen", because the corpus holds
    // 93 tight richtext bodies and 4 loose ones. Choosing the form 93 of 97
    // documents already use is the small loss; claiming the distinction is
    // kept was the large one.
    expect(htmlToMarkdown(markdownToHtml('- a\n\n- b'))).toBe('- a\n- b');
    expect(htmlToMarkdown(markdownToHtml('- a\n- b'))).toBe('- a\n- b');
  });

  it('indents past a two-digit marker', () => {
    const md = '10. ten\n    - under ten\n11. eleven';
    expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
  });

  it('escapes around a code span whose content ends in a backslash', () => {
    // The closing backtick follows a backslash. A lookbehind on the closing
    // delimiter refused it, so that backtick became the OPENING of a phantom
    // region swallowing the prose after it — and the <name> in that prose
    // went out raw, which is the unopenable page all over again.
    const md = htmlToMarkdown('<p>A <code>a\\</code> then &lt;name&gt; and <code>x</code>.</p>');
    expect(md).toContain('\\<name>');
    expect(bodyOf(md)).toBe(md);
  });

  it('escapes an image alt, which turndown escapes with its own private rule', () => {
    // "escape only runs on text nodes" is true and incomplete: turndown also
    // emits text taken from attributes, and rules.image uses a module-private
    // escapeMarkdown that no hook can reach. An alt reading "use the <name>
    // here" went out raw, and the page stopped building and stopped opening.
    const md = htmlToMarkdown('<p>x <img src="/a.png" alt="use the &lt;name&gt; here"> y</p>');
    expect(md).toBe('x ![use the \\<name> here](/a.png) y');
    expect(bodyOf(md)).toBe(md);
  });

  it('escapes an image title too', () => {
    const md = htmlToMarkdown('<p><img src="/a.png" alt="a" title="{count} left"></p>');
    expect(md).toContain('\\{count}');
    expect(bodyOf(md)).toBe(md);
  });

  it('drops a table with no rows instead of throwing away the body with it', () => {
    // The GFM rule reads row zero without checking there is one. A catch-all
    // fallback answered that by stripping every tag — merging paragraphs,
    // flattening headings and lists to "TitlePara oneab", silently, on save.
    const md = htmlToMarkdown('<h2>Title</h2><p>Para one</p><ul><li>a</li><li>b</li></ul><table></table>');
    expect(md).toContain('## Title');
    expect(md).toContain('Para one');
    expect(md).toContain('- a');
    expect(md).toContain('- b');
  });

  it('leaves a code span alone when a backslash precedes it', () => {
    // `C:\` then a code span: the backslash turndown writes is itself
    // escaped, and a one-character lookbehind cannot tell the difference.
    expect(htmlToMarkdown('<p>C:\\<code>{lang}</code></p>')).toBe('C:\\\\`{lang}`');
  });

  it('keeps a nested list nested on the way in', () => {
    // markdownToHtml used to dedent first, measuring from every line but the
    // first — so a list whose last item is nested (exactly what turndown
    // writes) arrived flat, before remark ever saw it.
    expect(markdownToHtml('- Parent\n\n  - Child')).toContain('<ul>\n<li>\n<p>Parent</p>\n<ul>');
    expect(markdownToHtml('1. Parent\n   1. Child')).toContain('<ol>\n<li>Parent\n<ol>');
  });

  it('does not read an escaped backtick as a code delimiter', () => {
    // Turndown writes a backtick typed in prose as \`. Matching that as an
    // opening delimiter invented a code span reaching to the next backtick,
    // and everything inside it escaped nothing — so one stray backtick let a
    // typed <name> through raw, and the page could not be reopened.
    const md = htmlToMarkdown('<p>press ` then type &lt;name&gt; and run <code>x</code></p>');
    expect(md).toContain('\\<name>');
    expect(md).toContain('`x`');
    expect(bodyOf(md)).toBe(md);        // parses, rather than throwing
  });

  it('destroyed a table before turndown was taught GFM', () => {
    // markdownToHtml enables GFM, so a table arrives at turndown as a
    // <table>. With no rule for one, turndown emitted every cell as its own
    // paragraph — the table was gone, unrecoverably, from opening the page.
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const html = markdownToHtml(table);
    expect(html).toContain('<table>');
    expect(htmlToMarkdown(html)).toContain('| --- |');
  });
});

describe('the escaped form is what MDX wanted', () => {
  it('parses as a body instead of throwing', () => {
    // Unescaped, `<name>` is an unclosed tag and `{first name}` is a broken
    // expression: the editor saved a page it could never reopen, and
    // `astro build` failed on it too.
    expect(bodyOf('Use the \\<name> placeholder')).toBe('Use the \\<name> placeholder');
    expect(bodyOf('Use \\{first name} here')).toBe('Use \\{first name} here');
  });

  it('is invisible to the editor, which sees the characters back', () => {
    expect(markdownToHtml('Use the \\<name> placeholder')).toContain('name');
    expect(markdownToHtml('Use the \\<name> placeholder')).not.toContain('\\');
    expect(markdownToHtml('Use \\{first name} here')).toContain('{first name}');
  });

  it('still refuses a genuinely unclosed tag', () => {
    expect(() => bodyOf('Use the <name> placeholder')).toThrow();
  });
});

describe('tables turndown cannot convert', () => {
  it('keeps a heading-less table as itself, with its void tags closed', () => {
    // The gfm plugin `keep`s a heading-less table, i.e. emits its raw
    // outerHTML — and raw HTML in MDX has to be valid JSX. The DOM serializes
    // `<br />` as `<br>`, and MDX reads that as a tag nobody closed: a table
    // someone had typed into a page stopped the site deploying.
    //
    // Closing it again is the whole fix. Escaping the outerHTML instead kept
    // the build standing by turning a working table into a paragraph of its
    // own source.
    const md = htmlToMarkdown('<p>x</p><table><tbody><tr><td>a<br />b</td></tr></tbody></table><p>y</p>');
    expect(md).toBe('x\n\n<table><tbody><tr><td>a<br />b</td></tr></tbody></table>\n\ny');
    expect(() => bodyOf(md)).not.toThrow();
  });

  it('leaves a table it did not have to touch byte-identical', () => {
    const table = '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
    expect(htmlToMarkdown(`<p>Intro</p>${table}<p>Outro</p>`)).toBe(`Intro\n\n${table}\n\nOutro`);
  });

  it('is a fixpoint, which the escaped form was not', () => {
    // Escaped, the table became *text* — and remark escapes text's
    // underscores and backslashes, so `class="price_list"` grew a backslash
    // on the second save and `C:\path` on the third.
    const source = '<table class="price_list"><tbody><tr><td>C:\\path</td></tr></tbody></table>';
    const first = htmlToMarkdown(`<p>Intro</p>${source}`);
    expect(first).toBe(`Intro\n\n${source}`);
    expect(htmlToMarkdown(markdownToHtml(first))).toBe(first);
  });

  it('does not close a tag that was never void', () => {
    // `<br>` is not a licence to self-close everything: `<td></td>` closes the
    // ordinary way, and turning it into `<td />` would empty the cell.
    const md = htmlToMarkdown('<table><tbody><tr><td><hr><img src="/a.png"><span>s</span></td></tr></tbody></table>');
    expect(md).toContain('<hr />');
    expect(md).toContain('<img src="/a.png" />');
    expect(md).toContain('<span>s</span>');
    expect(md).toContain('</td>');
  });

  const rowless: [string, string][] = [
    ['nothing at all', '<table></table>'],
    ['an empty tbody', '<table><tbody></tbody></table>'],
    ['an empty tfoot', '<table><tfoot></tfoot></table>'],
    ['a colgroup', '<table><colgroup><col></colgroup></table>'],
    ['a comment', '<table><tbody><!-- c --></tbody></table>'],
  ];

  for (const [what, table] of rowless) {
    it(`drops a table holding ${what}, keeping the body around it`, () => {
      // Every one of these throws inside the gfm plugin, which reads row zero
      // without checking there is one. The body must survive it.
      expect(htmlToMarkdown(`<p>before</p>${table}<p>after</p>`)).toBe('before\n\nafter');
    });
  }

  it('keeps the text of a rowless table that had some', () => {
    expect(htmlToMarkdown('<p>a</p><table><caption>Prices</caption></table><p>b</p>'))
      .toBe('a\n\nPrices\n\nb');
  });

  it('still converts a real table', () => {
    const md = htmlToMarkdown('<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>');
    expect(md).toContain('| h |');
    expect(md).toContain('| v |');
  });
});

describe('image attributes get turndown\'s own cleaning', () => {
  it('collapses a blank line in the title', () => {
    // Left in, it ends the image's markdown mid-attribute: the next load
    // reads two paragraphs of literal text where the picture was.
    const md = htmlToMarkdown('<p><img src="/a.png" alt="x" title="one\n\ntwo"></p>');
    expect(md).toBe('![x](/a.png "one\ntwo")');
    expect(markdownToHtml(md)).toContain('<img');
  });

  it('numbers <ol start=""> from one', () => {
    // getAttribute returns '' rather than null, and Number('') is 0 — `??`
    // let it through and renumbered the list from zero.
    expect(htmlToMarkdown('<ol start=""><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b');
  });
});
