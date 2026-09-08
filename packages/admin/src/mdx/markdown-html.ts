/**
 * Utilities for converting between markdown and HTML.
 * Used at the boundary between MDX storage (markdown) and Puck editor (HTML richtext).
 */
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import remarkGfm from 'remark-gfm';
import TurndownService from 'turndown';
// @ts-expect-error — turndown-plugin-gfm ships no types
import { gfm } from 'turndown-plugin-gfm';

// Singleton turndown instance
let turndownInstance: TurndownService | null = null;

/**
 * Turndown's own attribute handling, which mdxSafeImage below has to repeat
 * because turndown keeps these module-private.
 *
 * Missing one is not a cosmetic slip. A title carrying a blank line — which is
 * what `cleanAttribute` exists to collapse — ends the image's markdown
 * mid-attribute, and on the next load the picture is gone, replaced by two
 * paragraphs of its own source. Named rather than inlined so that the rule
 * reads like the one it replaces and there is one place to check against it.
 */
const cleanAttribute = (value: string | null) => (value ? value.replace(/(\n+\s*)+/g, '\n') : '');
const linkDestination = (src: string) => {
  const escaped = src.replace(/([<>()])/g, '\\$1');
  return escaped.includes(' ') ? `<${escaped}>` : escaped;
};

/**
 * The elements HTML lets you leave open and JSX does not.
 *
 * A DOM serializer writes `<br>`, because that is correct HTML. MDX reads it
 * as a tag with no closing partner and refuses the file — which is how a
 * table someone had typed into a page stopped the site deploying.
 */
const VOID_ELEMENTS =
  /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*?)\s*\/?>/gi;

const closeVoidElements = (html: string) =>
  html.replace(VOID_ELEMENTS, (_m, tag: string, attrs: string) => `<${tag}${attrs} />`);

function getTurndown(): TurndownService {
  if (!turndownInstance) {
    turndownInstance = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      // Anything turndown `keep`s comes back as raw outerHTML, and raw HTML
      // in MDX has to be valid JSX. The gfm plugin keeps heading-less tables,
      // and one containing a <br> failed the build on an unclosed tag.
      //
      // Of what reaches here, only the void elements need anything doing to
      // them: the source wrote `<br />`, the DOM serializer writes `<br>`, and
      // MDX reads that as a tag nobody closed. Closing them again puts it back.
      //
      // "Of what reaches here" is doing real work in that sentence, and an
      // earlier version of this comment claimed the DOM round trip "breaks
      // exactly one thing", which is false. Raw HTML holding a blank line
      // followed by a line indented four columns or more does not survive
      // markdownToHtml: remark ends the HTML block at the blank line and reads
      // the indent as a code block, so the row comes back fenced, in place,
      // inside the table — and turndown then foster-parents the <pre> out of
      // table context, putting it *above* the table. Stable damage; it never
      // repairs itself. Unfixed, and decided before turndown ever sees it —
      // by markdownToHtml, at the bottom of this same file. (A blank line
      // followed by a flush row is fine —
      // remark drops the blank line and the table arrives whole.)
      //
      // This MDX-escaped the whole outerHTML instead, which does keep the
      // build standing and turns a working table into a paragraph of its own
      // source — and was not even a fixpoint, since the escaped form is then
      // *text*, and remark escapes text's underscores and backslashes on the
      // next pass. It answered the wrong question: not "is this valid JSX?"
      // but "which one character stopped being valid JSX?".
      //
      // It also has to be passed here rather than assigned afterwards.
      // Turndown's Rules constructor copies keepReplacement off the options
      // once (`this.keepReplacement = options.keepReplacement`) and every
      // later `keep()` binds that copy, so setting
      // `instance.options.keepReplacement` after construction is simply dead —
      // as it was here, silently, with the build failure it was written for
      // still live and a green suite that never converted a kept node.
      keepReplacement: (_content: string, node: unknown) =>
        `\n\n${closeVoidElements((node as HTMLElement).outerHTML)}\n\n`,
    });

    // MDX escaping runs as turndown's own escape, which it applies to text
    // nodes and never to code (`node.isCode ? nodeValue : self.escape(...)`).
    // That is exactly the rule wanted, for free, and it replaced a regex that
    // tried to find code regions in the finished markdown and mis-identified
    // them in two different ways.
    const base = turndownInstance.escape.bind(turndownInstance);
    turndownInstance.escape = (text: string) => escapeMdxSyntax(base(text));

    // …but only to text *nodes*. Turndown also emits text it took from
    // attributes, and those go through module-private escapers it never
    // exposes — `rules.image` uses its own `escapeMarkdown` on the alt. So an
    // alt reading "use the <name> here" went out raw, and the page stopped
    // building and stopped opening: the exact failure the escaping exists to
    // prevent, reintroduced by moving it somewhere more elegant.
    turndownInstance.addRule('mdxSafeImage', {
      filter: 'img',
      replacement: (_content, node) => {
        const el = node as HTMLElement;
        const src = el.getAttribute('src') || '';
        if (!src) return '';
        const alt = escapeMdxSyntax(base(cleanAttribute(el.getAttribute('alt'))));
        const title = cleanAttribute(el.getAttribute('title'));
        const titlePart = title ? ` "${escapeMdxSyntax(title.replace(/"/g, '\\"'))}"` : '';
        return `![${alt}](${linkDestination(src)}${titlePart})`;
      },
    });

    // The two halves of this module have to understand the same markdown.
    // markdownToHtml enables GFM, so a table in a document arrives here as a
    // <table>; turndown, which knows only CommonMark, had no rule for one and
    // emitted every cell as its own paragraph. Opening and saving a page with
    // a table destroyed it — 21 documents in this repository have one, and
    // the damage is unrecoverable through the UI.
    turndownInstance.use(gfm);

    // …which decides what a table is by reading its first row —
    // `isHeadingRow(node.rows[0])`, in both its table rule and its keep filter
    // — and a table with no rows has no row zero, so the read throws and takes
    // the document down with it. Five shapes do it: <table></table>, a lone
    // <caption>, an empty <tbody> or <tfoot>, a <colgroup>, a comment.
    //
    // Claiming the node before either of those filters sees it is the fix
    // (rules added after `use` are matched first). Its text is kept and the
    // shell dropped, so a stray caption still says what it said and an empty
    // table leaves nothing behind.
    //
    // Two previous attempts answered this further from the cause and were
    // wrong for it: a try/catch that met the throw by stripping every tag in
    // the body — merging paragraphs and flattening headings, silently, on save
    // — and then a regex pre-strip that knew about <tbody> and <thead> and
    // none of the other four shapes, leaving the throw live in four call sites
    // that had just lost their catch. The crash belongs to row zero, so row
    // zero is where it is answered.
    turndownInstance.addRule('rowlessTable', {
      filter: node => node.nodeName === 'TABLE' && (node as HTMLTableElement).rows.length === 0,
      replacement: content => (content.trim() ? `\n\n${content.trim()}\n\n` : ''),
    });

    // A single space after the marker, as the documents on disk are written
    // and as anyone types them. Turndown's own rule pads to a four-column
    // indent — "1.  item", "-   item" — which is valid markdown and identical
    // when rendered, but rewrote every list in every document on first save.
    turndownInstance.addRule('tightListItem', {
      filter: 'li',
      replacement: (content, node) => {
        const parent = node.parentNode as HTMLElement;
        const marker =
          parent?.nodeName === 'OL'
            // `||`, not `??`: getAttribute returns '' for `<ol start="">`, and
            // Number('') is 0, which renumbered the whole list from zero.
            ? `${Array.prototype.indexOf.call(parent.children, node) + Number(parent.getAttribute('start') || 1)}.`
            : (turndownInstance!.options.bulletListMarker as string);
        // Continuation lines indent to the item's own content column, which
        // is the marker plus its space — 2 for `- `, 3 for `1. `, 4 for
        // `10. `. A fixed two, which is what this rule first used, sits left
        // of that column for every ordered list: CommonMark then reads a
        // nested list or a second paragraph as a sibling of the list rather
        // than part of the item, the `<ol>` ends early, and each save pushes
        // it further out of shape. Nine documents here have exactly that.
        const pad = ' '.repeat(marker.length + 1);
        const body = content
          .replace(/^\n+/, '')
          .replace(/\n+$/, '')
          .replace(/\n(?!$)/gm, `\n${pad}`);
        // Always tight, deliberately.
        //
        // This briefly preserved looseness by checking whether the <li> wraps
        // its text in a <p>, to stop seven lists in four documents tightening
        // on save. That reads the source's HTML correctly and the editor's not
        // at all: Tiptap's listItem is `content: "paragraph block*"`, so every
        // list it hands back has a <p> in every item and the check is always
        // true on the path that matters. It turned "4 loose lists tighten"
        // into "93 tight lists loosen" — the corpus has 93 tight bodies and 4
        // loose ones — and the corpus test could not see it because it never
        // runs Tiptap.
        //
        // Looseness simply does not survive this editor's document model.
        // Choosing the form 93 of 97 documents already use is the small loss;
        // pretending the distinction is preserved was the large one.
        return `${marker} ${body}${node.nextSibling ? '\n' : ''}`;
      },
    });
  }
  return turndownInstance;
}

/**
 * Convert markdown string to HTML string.
 * Used when loading MDX content into Puck's richtext fields.
 */
// Built once and frozen: unified re-constructs and re-freezes the whole
// pipeline on every `remark()` call, and this runs ~80 times per news index
// render. htmlToMarkdown below already caches its Turndown instance; the
// asymmetry was an oversight, not a decision.
const processor = remark().use(remarkGfm).use(remarkHtml, { sanitize: false }).freeze();

export function markdownToHtml(markdown: string): string {
  if (!markdown || !markdown.trim()) return '';
  // Deliberately no dedent. There used to be one here, from when the parser
  // handed over bodies with their authoring indentation still attached; the
  // parser dedents now, so this only ever had someone else's indentation to
  // misread — and it did, excluding the first line from its measurement. A
  // list whose last item was nested ("- a\n\n  - b", which is exactly what
  // turndown writes) came back flat, and nobody could see it happen.
  return String(processor.processSync(markdown)).trim();
}

/**
 * Say "this is the character" about the two that MDX reads as syntax.
 *
 * `<` opens a tag and `{` opens an expression, so a paragraph that merely
 * mentions one — "use the <name> placeholder", "type {count} here" — is not a
 * paragraph in an MDX file, it is a parse error. Turndown has no reason to
 * know that: it produces markdown, where both are ordinary text.
 *
 * The damage this prevents is the worst kind available here. The editor
 * accepted the sentence, wrote it, and could then never open the page again —
 * and `astro build` failed on it too, so the site stopped deploying over a
 * typed angle bracket. Escaping is markdown's own answer, and remark undoes
 * it on the way back in, so nobody sees the backslash.
 *
 * A character that is already escaped is left alone, which is what makes
 * saving an unchanged document a no-op.
 *
 * Code is exempt, and turndown decides what code is — see getTurndown, which
 * installs this as the instance's `escape`. Turndown calls `escape` only on
 * text nodes (`node.isCode ? nodeValue : self.escape(nodeValue)`), so a code
 * span or fence never reaches here at all. Finding that out deleted a regex
 * that tried to locate code regions in the finished markdown and got it wrong
 * twice: once treating turndown's own escaped backtick as an opening
 * delimiter, and once refusing a closing delimiter that followed a backslash.
 * Either mistake invented a region spanning real prose and let a typed
 * `<name>` through raw.
 */
const escapeMdxSyntax = (text: string) =>
  // Counting the backslashes rather than looking behind for one. A lone
  // lookbehind cannot tell an escape from an escaped literal backslash, so
  // `C:\<name>` — which turndown hands over as `C:\\<name>` — looked already
  // escaped and went out raw, putting an unclosed tag in the file.
  text.replace(/(\\*)([<{])/g, (_m, slashes: string, ch: string) =>
    `${slashes}${slashes.length % 2 === 0 ? '\\' : ''}${ch}`);

/**
 * Convert HTML string to markdown string.
 * Used when saving Puck's richtext field values back to MDX.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return '';

  // Already plain text (no HTML tags), so turndown — and its escaping —
  // never runs. Still headed for an MDX file, so it is escaped here.
  if (!/<[^>]+>/.test(html)) return escapeMdxSyntax(html);

  return getTurndown().turndown(html).trim();
}
