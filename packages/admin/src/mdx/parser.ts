import type { Data } from '@puckeditor/core';
import { markdownToHtml } from './markdown-html';
import type { RichtextFields } from './richtext-fields';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
// The same check MDX's own recma-jsx-rewrite uses to decide what a JSX name
// means. Depending on it rather than approximating it is the whole point.
import { name as isIdentifierName } from 'estree-util-is-identifier-name';
import { readFrontmatter, type Frontmatter } from '@plinto/core/frontmatter';

export type { Frontmatter };

/** A line the parser could not turn into a block, and so would discard. */
export interface SkippedLine {
  /** 1-based, counted in the source file including frontmatter. */
  line: number;
  text: string;
}

export interface ParsedMdx {
  data: Data;
  frontmatter: Frontmatter;
  /** Empty unless the source contained content this format cannot represent. */
  skipped: SkippedLine[];
}

export class UnrepresentableContentError extends Error {
  constructor(public readonly skipped: SkippedLine[], label?: string) {
    const where = label ? ` in ${label}` : '';
    const lines = skipped.map(s => `  line ${s.line}: ${s.text}`).join('\n');
    super(
      `This document contains content the block editor cannot represent${where}, ` +
      `so opening and saving it would discard the following:\n${lines}`,
    );
    this.name = 'UnrepresentableContentError';
  }
}

export interface ParseOptions {
  /**
   * Throw when the source contains anything that would be discarded. On by
   * default: silently dropping an author's paragraph is worse than refusing to
   * open the document. Pass false where losing it is impossible — a read-only
   * render — and check `skipped` instead.
   */
  strict?: boolean;
  /** File path or similar, quoted in the error to make it findable. */
  label?: string;
  /**
   * Run each richtext prop through markdown→HTML. On by default, because the
   * editor's fields hold HTML.
   *
   * A caller that only wants the words — deriving a listing summary, say —
   * passes false: converting markdown to HTML so the next step can strip the
   * tags back off is the most expensive thing in that path, and it is paid for
   * the whole document to keep its first 160 characters.
   */
  richtext: RichtextFields | false;

  /**
   * Frontmatter keys the site declares as page fields, mirrored into the root
   * props so the editor's page panel shows their current values.
   *
   * Empty by default: a caller deriving a listing summary has no page panel,
   * and the failure mode of forgetting it — a panel missing its extra fields —
   * is visible rather than silent.
   */
  pageFieldKeys?: readonly string[];
}

/**
 * Converts MDX string to Puck data structure with frontmatter.
 *
 * Only line-level components are representable. Prose, headings, lists, code
 * fences and JSX expressions have no equivalent in Puck's `{type, props}`
 * model — see `skipped` and ParseOptions.strict. Import statements are the one
 * exception: they are dropped rather than reported, because the generator
 * derives them from the blocks the document uses, so nothing is lost.
 *
 * Synchronous on purpose: some callers derive things from a document *during a
 * React render* — the summary a listing shows for each of its articles — and
 * neither the server build nor the editor gets to suspend there.
 */
export function parseMdx(source: string, options: ParseOptions): ParsedMdx {
  // Line endings are normalized once, at the door. A block's markdown body is
  // sliced from this source verbatim, so on a Windows checkout every one of
  // them carried \r into the value the editor holds and the file it writes —
  // 198 of the 448 documents here came back with mixed endings. LF is what
  // git stores anyway; a Windows working tree gets CRLF back on checkout, and
  // the browser store, which commits with no such translation, now writes
  // exactly what git wants.
  // The BOM goes too: gray-matter strips it before parsing, so leaving it on
  // meant the frontmatter probe below never matched and every reported line
  // number was short by the height of the block.
  const mdxString = source.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const { data: frontmatter, body: mdxContent } = readFrontmatter(mdxString);

  // gray-matter hands back the body only; offset the line numbers so they
  // point at the file the author will actually open.
  const fm = mdxString.match(/^---\n[\s\S]*?\n---\n?/);
  const offset = fm ? fm[0].split('\n').length - 1 : 0;

  const skipped: SkippedLine[] = [];
  const components = parseBlocks(mdxContent, skipped, offset) as any[];
  const content = options.richtext === false
    ? components
    : components.map(c => convertRichtextFields(c, options.richtext as RichtextFields));

  if (skipped.length > 0) {
    if (options.strict !== false) throw new UnrepresentableContentError(skipped, options.label);
    const where = options.label ? ` in ${options.label}` : '';
    console.warn(
      `[plinto] ${skipped.length} line(s)${where} are not representable as blocks and will not render:\n` +
      skipped.map(s => `  line ${s.line}: ${s.text}`).join('\n'),
    );
  }

  return {
    data: {
      content,
      root: {
        props: {
          title: frontmatter.title || '',
          description: frontmatter.description || '',
          // Site-declared extra page fields (content.pageFields) ride along
          // so the editor's page panel shows their current values. The
          // publish date is one of these now, not a built-in.
          ...Object.fromEntries(
            (options.pageFieldKeys ?? []).map(key => [key, frontmatter[key] ?? '']),
          ),
        },
      },
    } as Data,
    frontmatter,
    skipped,
  };
}

/** unified's parse is synchronous; only run/process are not. */
const mdxParser = unified().use(remarkParse).use(remarkMdx).freeze();

interface MdxNode {
  type: string;
  name?: string | null;
  value?: string;
  attributes?: MdxAttribute[];
  children?: MdxNode[];
  /** `column` is 1-based, so a body starting at column 3 is indented by 2. */
  position?: {
    start: { line: number; column?: number; offset?: number };
    end: { line: number; column?: number; offset?: number };
  };
}

interface MdxAttribute {
  type: string;
  name?: string;
  value?: string | { type: string; value?: string; data?: { estree?: EstreeProgram } } | null;
}

interface EstreeProgram {
  body: Array<{ type: string; expression?: EstreeNode }>;
}

interface EstreeNode {
  type: string;
  value?: unknown;
  raw?: string;
  name?: string;
  operator?: string;
  argument?: EstreeNode;
  elements?: (EstreeNode | null)[];
  properties?: Array<{
    type: string;
    key?: EstreeNode;
    value?: EstreeNode;
    computed?: boolean;
  }>;
}

/** Nothing in Puck's data model can hold this value. */
const UNREPRESENTABLE = Symbol('unrepresentable');

/**
 * An expression attribute's value, if it is a literal the block model can
 * hold. Deliberately not an evaluator: a call, an identifier, a template
 * literal or a spread has no place in stored content, and saying so is how
 * the editor avoids quietly rewriting a document it did not understand.
 */
function staticValue(node: EstreeNode | undefined): unknown {
  if (!node) return UNREPRESENTABLE;

  switch (node.type) {
    case 'Literal':
      // Strings, numbers and booleans, and nothing else that wears the same
      // node type. `null` is refused because the generator writes no
      // attribute for it, so storing one would drop it on the next save. A
      // regex literal arrives as a Literal whose value is a RegExp, and was
      // written back as `{}`; a BigInt arrives as one too and came back a
      // string. Both are approximations, which is the one thing this is here
      // not to do.
      switch (typeof node.value) {
        case 'string':
        case 'boolean':
          return node.value;
        case 'number':
          // NaN and Infinity cannot be spelled as a literal on the way out.
          return Number.isFinite(node.value) ? node.value : UNREPRESENTABLE;
        default:
          return UNREPRESENTABLE;
      }

    case 'UnaryExpression':
      // Negative numbers arrive as -(literal).
      if (node.operator === '-' || node.operator === '+') {
        const inner = staticValue(node.argument);
        if (typeof inner === 'number') return node.operator === '-' ? -inner : inner;
      }
      return UNREPRESENTABLE;

    case 'Identifier':
      // `undefined` has the same problem as null — nothing to write back.
      return UNREPRESENTABLE;

    case 'ArrayExpression': {
      const out: unknown[] = [];
      for (const element of node.elements ?? []) {
        if (!element) return UNREPRESENTABLE; // a hole, [1, , 2]
        const value = staticValue(element);
        if (value === UNREPRESENTABLE) return UNREPRESENTABLE;
        out.push(value);
      }
      return out;
    }

    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const property of node.properties ?? []) {
        if (property.type !== 'Property' || property.computed) return UNREPRESENTABLE;
        const key = property.key?.type === 'Identifier'
          ? property.key.name
          : property.key?.type === 'Literal'
            ? String(property.key.value)
            : undefined;
        if (key === undefined) return UNREPRESENTABLE;
        const value = staticValue(property.value);
        if (value === UNREPRESENTABLE) return UNREPRESENTABLE;
        // Defined, not assigned: `out['__proto__'] = v` walks the prototype
        // setter instead of adding a key, so a document holding that name
        // came back a key short and was written back without it.
        Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
      }
      return out;
    }

    default:
      return UNREPRESENTABLE;
  }
}

/** The props of one JSX element, reporting anything unrepresentable. */
function readProps(
  node: MdxNode,
  report: (line: number, text: string) => void,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const line = node.position?.start.line ?? 1;

  for (const attribute of node.attributes ?? []) {
    // `{...spread}` — no name, and nothing stored could reproduce it.
    if (attribute.type !== 'mdxJsxAttribute' || !attribute.name) {
      report(line, `<${node.name}> has a spread attribute, which cannot be stored`);
      continue;
    }

    const value = attribute.value;

    // A bare attribute (`disabled`) is JSX's `true`.
    if (value === null || value === undefined) {
      props[attribute.name] = true;
      continue;
    }

    // A quoted attribute — remark has already resolved its escapes.
    if (typeof value === 'string') {
      props[attribute.name] = value;
      continue;
    }

    const decoded = staticValue(value.data?.estree?.body?.[0]?.expression);
    if (decoded === UNREPRESENTABLE) {
      report(line, `<${node.name} ${attribute.name}={${(value.value ?? '').slice(0, 60)}}> is not a value this format can store`);
      continue;
    }
    props[attribute.name] = decoded;
  }

  return props;
}

/**
 * Whether a JSX name refers to a component rather than an HTML element.
 *
 * Not a rule of my own this time — MDX's, from the same module MDX uses to
 * decide it (`recma-jsx-rewrite`): a member expression is always a reference,
 * and otherwise a name is a component when it is a valid ECMAScript
 * identifier that does not begin with a lowercase ASCII letter.
 *
 * Two rounds got this wrong in opposite directions, and both times the wrong
 * rule was the one that classified everything in front of it correctly.
 * `/^[A-Z]/` was too narrow: `<Årsmöte>` and `<_Divider>` and `<$Icon>` are
 * components, and a site whose block is called `Öppettider` — an entirely
 * natural name here, and the adopter's choice once this is public — stopped
 * opening at all, its own registered block reported as raw HTML. Dropping the
 * capital and keeping "not lowercase ASCII" was then too wide:
 * `<årstid-väljare>` is an HTML tag, a hyphen makes it no identifier, and it
 * opened and then failed the *save* with "restart the dev server" — the very
 * failure this predicate was introduced to end, surviving in exactly the
 * Nordic names the last round's message claimed it protected.
 *
 * This says what MDX means, and nothing about plinto — see isBlockElement for
 * the narrower question the editor actually has.
 */
function isComponentName(name: string | null | undefined): boolean {
  if (!name) return false;
  // A member expression — `motion.div`, `foo.bar` — is a reference whatever
  // its case.
  if (name.includes('.')) return true;
  return isIdentifierName(name) && !/^[a-z]/.test(name);
}

/**
 * A block: a JSX flow element naming a component plinto could actually hold.
 *
 * Not the same question as `isComponentName`, and conflating them cost a
 * round. MDX asks "is this a component reference", and a member expression —
 * `<motion.div>`, `<Foo.Bar>` — is one. plinto asks "could this be a block",
 * and the answer for a dotted name is no whatever MDX thinks: a registry is
 * keyed by bare name and the generator writes `import { Name } from …`, which
 * cannot spell a dot. Accepting them meant `<Foo.Bar>` opened fine and then
 * failed the save with "Block …is not in the import map. If it was just added
 * to the registry, restart the dev server." — the exact dead end this
 * predicate exists to end, and one where restarting could never help, because
 * no registry key can contain a dot.
 *
 * The distinction exists to make the refusal honest, not to accept more. Raw
 * HTML written as its own flow element used to parse as a block *named after
 * the tag* — `table`, with children `tbody` and `tr` — and the page opened
 * fine. The failure arrived at save time, from the generator, as `Block
 * "table" is not in the import map. If it was just added to the registry,
 * restart the dev server.` Restarting cannot help. The registry was never
 * going to contain a table, and the message left nothing else to try.
 *
 * Making it prose instead was the obvious next move and is worse: turndown
 * drops elements it has no rule for, so the three FAQ pages whose bodies hold
 * `<span id="faq1" />` anchors went from refusing to open to opening and
 * silently losing every anchor. Refusing at open, with a message that names
 * the actual obstacle, is the honest answer until htmlToMarkdown can carry
 * arbitrary inline HTML.
 */
function isBlockElement(node: MdxNode): boolean {
  return node.type === 'mdxJsxFlowElement'
    && isComponentName(node.name)
    && !node.name!.includes('.');
}

/**
 * Name what stopped this being a block. A fragment gets its own sentence
 * because `<null> is raw HTML` names nothing — and because it used to be
 * *silent* data loss: a fragment parsed as a block with no type at all, and
 * the generator dropped it and everything in it without a word.
 */
function reportNotABlock(node: MdxNode, report: (line: number, text: string) => void): void {
  const line = node.position?.start.line ?? 0;
  if (!node.name) {
    report(line, `a <>…</> fragment, which the block editor has no shape for — name the component, or drop the fragment and leave its children where they are.`);
    return;
  }
  if (node.name.includes('.')) {
    // A component, but not one plinto can hold: a registry is keyed by bare
    // name and the generated import is `import { Name }`, which cannot spell
    // a dot. Saying "raw HTML" here would be wrong and unactionable both.
    report(
      line,
      `<${node.name}> is a component reached through a dotted name, and a block registry is keyed by bare name — ` +
      `register it under a name of its own, or leave this page out of the block editor.`,
    );
    return;
  }
  report(
    line,
    `<${node.name}> is raw HTML standing on its own, and the block editor has no shape for it — ` +
    `a block holds either markdown or child blocks. Put it inline in the surrounding text, ` +
    `or leave this page out of the block editor.`,
  );
}

/** True for the nodes that carry an author's words rather than structure. */
function isProse(node: MdxNode): boolean {
  return node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxjsEsm';
}

/**
 * One JSX element as a Puck block. Child elements become slot children; child
 * prose becomes the markdown `children` prop — a block has one or the other,
 * so a document mixing them is reported.
 */
function toBlock(
  node: MdxNode,
  source: string,
  report: (line: number, text: string) => void,
  /**
   * This node is part of a raw-HTML blob an ancestor has already refused, so
   * it says nothing about itself: not its tags, not its props, not its prose.
   * One hand-authored table is one obstacle, not a paragraph each about
   * `<table>` and `<tbody>` and `<tr>` and the spread on the `<div>` around
   * them — and none of those can be acted on except by removing the blob.
   *
   * A real block inside the blob is *not* part of it, so it un-mutes: a
   * `<CmHero title={someCall()} />` inside a stray `<div>` still says so, and
   * a `<table>` inside that CmHero still says so too. That distinction is the
   * whole content of this parameter. Two earlier shapes each got half of it:
   * a blanket silent reporter swallowed the CmHero's bad prop, so the user
   * removed the div, reopened, and met a refusal nobody had mentioned; a flag
   * that only ever became true left the table under the CmHero unnamed for
   * exactly the same reason.
   */
  muted = false,
): unknown {
  const silent = () => {};
  const say = muted ? silent : report;

  const props = readProps(node, say);
  const children = node.children ?? [];
  const elements = children.filter(c => c.type === 'mdxJsxFlowElement');
  const prose = children.filter(isProse);

  for (const e of elements) if (!isBlockElement(e)) reportNotABlock(e, say);

  if (elements.length > 0) {
    // Text beside child components would vanish on the next save. Name the
    // conflict rather than just the casualty: the prose is fine, and reporting
    // only the prose sent people looking for what was wrong with a perfectly
    // ordinary paragraph. What it sits beside is the problem, and the usual
    // cause is an inline anchor like `<span id="faq1" />` — legal MDX, but a
    // block's children are either components or text, never both.
    const beside = [...new Set(elements.map(e => `<${e.name}>`))].join(', ');
    for (const p of prose) {
      const text = sliceSource(source, p).trim();
      if (text) {
        say(
          p.position?.start.line ?? 0,
          `text beside ${beside} inside <${node.name}> — a block holds child components or text, not both: ${text.slice(0, 80)}`,
        );
      }
    }
    // Every child descends, so the shape this returns is unchanged. A child
    // that is a block speaks for itself; one that is not is part of the blob
    // — see `muted`.
    return {
      type: node.name,
      props: {
        ...props,
        children: elements.map(c => toBlock(c, source, report, !isBlockElement(c))),
      },
    };
  }

  // An element with no children carries no `children` prop at all — the same
  // shape a self-closing tag has always produced, and what the generator
  // writes back out.
  if (prose.length === 0) {
    return { type: node.name, props };
  }

  // The block's markdown body, taken from the source verbatim so its
  // formatting survives the round trip.
  const nodeStart = prose[0].position?.start.offset;
  const to = prose[prose.length - 1].position?.end.offset;
  // From the START of that line, not from the node. A node's offset is past
  // its own indentation, so taking it made the first line the one line that
  // arrived already dedented — and a body opening with an indented code block
  // lost the four spaces that made it code before dedent could see them.
  // Starting at the line means every line is measured by the same rule.
  const from = nodeStart === undefined ? undefined : lineStartOf(source, nodeStart);
  const text = from !== undefined && to !== undefined ? source.slice(from, to) : '';
  // The slice begins at a node's content, past that line's indentation — so
  // the body's indent is a column, not something to infer from the lines
  // below. Two corrections on top of that:
  //
  // The SHALLOWEST node, not the first. An indented code block starts four
  // columns further in than the body it sits in, so measuring from a body
  // that opens with one absorbed the code marker and stripped it from
  // everything after: the block reopened as a paragraph.
  //
  // And never deeper than the element's own indent plus two, which is where
  // the generator puts a body. That covers the case the minimum cannot — a
  // body that is *only* an indented code block, where there is no shallower
  // node to measure against.
  const bodyIndent = Math.min(
    ...prose.map(p => (p.position?.start.column ?? 1) - 1),
    (node.position?.start.column ?? 1) - 1 + 2,
  );
  return { type: node.name, props: { ...props, children: dedent(text, bodyIndent).trim() } };
}

function sliceSource(source: string, node: MdxNode): string {
  const { start, end } = node.position ?? {};
  return start?.offset !== undefined && end?.offset !== undefined
    ? source.slice(start.offset, end.offset)
    : '';
}

/**
 * Strip the indentation a nested block's markdown carries in the source.
 * Without it, four spaces of authoring indentation read as a code fence.
 *
 * Exactly `bodyIndent` columns come off each line, and never more. Measuring
 * the shallowest of the *following* lines instead — which is what this used
 * to do — reads a nested list's own indentation as the body's, so
 * `- a\n  - b` came back `- a\n- b`: the sub-item promoted, in the editor and
 * on disk, silently.
 *
 * The caller trims what is left, which is why an *indented* code block cannot
 * open a block body — its four spaces and the body's own indent are the same
 * characters, and the first line's leading whitespace has to go. Removing it
 * is not optional: a body written lazily, first line indented and the rest
 * not, would otherwise gain two columns on every save and grow without limit.
 * A fenced block says which is which and round-trips exactly.
 */
function dedent(text: string, bodyIndent: number): string {
  if (bodyIndent <= 0) return text;
  return text
    .split('\n')
    .map(line => {
      const lead = (line.match(/^[ \t]*/) as RegExpMatchArray)[0];
      // Tabs are measured the way markdown measures them — advancing to the
      // next four-column stop — and expanded to spaces before slicing.
      // Counting a tab as one character took four columns of indentation off
      // the line and flattened tab-indented nested lists, which is the same
      // damage this function exists to prevent for spaces.
      const indent = expandTabs(lead);
      // Never more than the line actually has: a lazy continuation indented
      // less than the body must not lose real characters.
      return indent.slice(Math.min(indent.length, bodyIndent)) + line.slice(lead.length);
    })
    .join('\n');
}

/**
 * The start of the line `offset` sits on — but only when everything before it
 * on that line is indentation.
 *
 * Backing up unconditionally would swallow whatever else shares the line into
 * the body. MDX only makes a flow element out of a tag on its own line, so
 * there should never be anything there; "should never" is not a reason to
 * write a slice that would take it if there were.
 */
function lineStartOf(source: string, offset: number): number {
  const start = source.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*$/.test(source.slice(start, offset)) ? start : offset;
}

/** Leading whitespace as spaces, tabs advancing to the next four-column stop. */
function expandTabs(lead: string): string {
  let out = '';
  for (const ch of lead) {
    if (ch === '\t') out += ' '.repeat(4 - (out.length % 4));
    else out += ch;
  }
  return out;
}

/**
 * The blocks of an MDX body, plus whatever the block model cannot hold.
 * `offset` shifts reported line numbers past the frontmatter, so they point
 * at the file an author will open.
 */
function parseBlocks(
  body: string,
  skipped: Array<{ line: number; text: string }>,
  offset = 0,
): unknown[] {
  const report = (line: number, text: string) => skipped.push({ line: line + offset, text });

  let tree: MdxNode;
  try {
    tree = mdxParser.parse(body) as unknown as MdxNode;
  } catch (err) {
    // MDX that does not parse at all — an unclosed brace, a malformed tag.
    // Reported in the same shape as anything else this format cannot hold,
    // so callers deal with one failure mode instead of two.
    const message = err as { reason?: string; message?: string; line?: number };
    report(message.line ?? 1, message.reason ?? message.message ?? 'This file is not valid MDX');
    return [];
  }

  const blocks: unknown[] = [];
  for (const node of tree.children ?? []) {
    if (node.type === 'mdxjsEsm') {
      // A page's imports say where its blocks come from — which the generator
      // works out again from the registry every time it writes the file, so
      // passing over them is lossless. `export` is not: it is reported below
      // like any other statement, because nothing regenerates it.
      if (/^\s*import\b/.test(node.value ?? '')) continue;
      report(node.position?.start.line ?? 0, (node.value ?? '').trim().slice(0, 120));
      continue;
    }

    if (node.type === 'mdxJsxFlowElement') {
      const block = isBlockElement(node);
      if (!block) reportNotABlock(node, report);
      blocks.push(toBlock(node, body, report, !block));
      continue;
    }

    const text = sliceSource(body, node).trim();
    if (text) report(node.position?.start.line ?? 0, text.split('\n')[0].slice(0, 120));
  }

  return blocks;
}

/**
 * Recursively convert markdown strings in richtext fields to HTML.
 * This is needed because Puck's richtext field uses Tiptap (HTML),
 * but MDX stores content as markdown.
 */
function convertRichtextFields(component: any, isRichtextField: RichtextFields): any {
  if (!component || !component.type || !component.props) return component;

  const { type, props } = component;
  const newProps = { ...props };

  // Convert known richtext fields from markdown to HTML
  for (const [key, value] of Object.entries(newProps)) {
    if (typeof value === 'string' && isRichtextField(type, key)) {
      newProps[key] = markdownToHtml(value);
    }
  }

  // Recursively handle children arrays (nested components)
  if (Array.isArray(newProps.children)) {
    newProps.children = newProps.children.map((c: any) => convertRichtextFields(c, isRichtextField));
  }

  return { type, props: newProps };
}
