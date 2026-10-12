import type { Data } from '@puckeditor/core';
import { writeFrontmatter, type Frontmatter } from '@plinto/core/frontmatter';
import { htmlToMarkdown } from './markdown-html';
import type { RichtextFields } from './richtext-fields';
import { renderImportBlock } from '../block-imports';
import type { BlockImportMap } from '../block-imports';
import type { BlockSpan, ParsedMdx, SourceSpan } from './parser';

/**
 * Every block type the document uses, including nested ones, in the order
 * first seen. What the import block has to cover.
 */
function collectTypes(components: any[], into = new Set<string>()): Set<string> {
  for (const component of components ?? []) {
    if (!component?.type) continue;
    into.add(component.type);
    if (Array.isArray(component.props?.children)) {
      collectTypes(component.props.children, into);
    }
  }
  return into;
}

/**
 * Converts Puck data to MDX string with component IDs.
 *
 * The output is a self-contained MDX file: frontmatter, then the import
 * statements for the blocks it uses, then the blocks. Astro renders the file
 * directly, so the imports are not decoration — they are how the page resolves
 * its components, and equally what lets an editor open the file by hand and
 * follow a block to its source.
 */
/**
 * What the generator needs from the site it is writing for. Both are
 * required, because there is no safe default: guessing that nothing is
 * richtext writes HTML into an MDX body, and guessing an empty import map
 * writes a document whose blocks resolve to nothing.
 */
export interface GenerateOptions {
  /** Whether a component's field holds richtext, or false to convert nothing. */
  richtext: RichtextFields | false;
  /** Where a generated document imports each block's component from. */
  blockImports: BlockImportMap;
  /**
   * The document as it stands on disk, parsed with the same richtext rule.
   * Any part of it the edit left alone — the frontmatter, the imports, a
   * block, a block's child — is written back as its original text, and only
   * what changed is written in this generator's own form.
   *
   * Without it every save rewrote the whole file: a hand-written page opened
   * and saved untouched came back as a 33-line diff of nothing but
   * formatting (asewerner-site, #4), and a one-word edit carried that diff
   * with it — a merge conflict waiting for anyone else editing the file.
   */
  original?: ParsedMdx;
}

/** A stretch of output, and where it came from when it was kept verbatim. */
interface Piece {
  text: string;
  span?: SourceSpan;
}

/**
 * Pieces in order, `separator` between them — except between two kept pieces
 * that were neighbours in the source, which keep whatever whitespace stood
 * between them there. Neighbours means only whitespace lay between: a block
 * deleted from between them is text, and the gap then gets the separator.
 */
function joinPieces(pieces: Piece[], separator: string, source: string | undefined): string {
  let out = '';
  pieces.forEach((piece, i) => {
    const prev = pieces[i - 1];
    if (prev) {
      const gap = source !== undefined && prev.span && piece.span && prev.span.end <= piece.span.start
        ? source.slice(prev.span.end, piece.span.start)
        : undefined;
      out += gap !== undefined && /^\s*$/.test(gap) ? gap : separator;
    }
    out += piece.text;
  });
  return out;
}

/**
 * The original document's blocks, each with the text this generator would
 * write for it, so a block in the document being saved can be recognised as
 * one of them, unchanged.
 *
 * Matched on that text with the id left out, and on depth, first unused match
 * in document order. The id is left out because a hand-written block has
 * none in the file: the editor mints one each time it opens the page (see
 * ParseOptions.ensureIds), so a minted id says nothing about change. Where
 * the file does carry an id, it must still be the same one.
 */
class Keeper {
  private readonly candidates: Array<{ span: BlockSpan; depth: number; key: string; ids: unknown[]; used: boolean }> = [];

  constructor(readonly source: string, original: ParsedMdx, private readonly isRichtextField: RichtextFields) {
    const walk = (blocks: any[], spans: BlockSpan[], depth: number) => {
      if (blocks.length !== spans.length) return;
      blocks.forEach((block, i) => {
        if (!block?.type || !block.props) return;
        this.candidates.push({ span: spans[i], depth, key: this.key(block, depth), ids: idsOf(block), used: false });
        if (Array.isArray(block.props.children)) walk(block.props.children, spans[i].children, depth + 1);
      });
    };
    walk(original.data.content ?? [], original.layout.blocks, 0);
  }

  private key(block: any, depth: number): string {
    return componentToMdx(withoutIds(block), depth, this.isRichtextField);
  }

  /** The source span of an unchanged original of `block`, claimed, if there is one. */
  take(block: any, depth: number): BlockSpan | undefined {
    if (!block?.type || !block.props) return undefined;
    const key = this.key(block, depth);
    const ids = idsOf(block);
    const match = this.candidates.find(c =>
      !c.used && c.depth === depth && c.key === key
      && c.ids.every((id, i) => id === undefined || id === ids[i]));
    if (!match) return undefined;
    match.used = true;
    return match.span;
  }
}

/** A block and its descendants with no ids — what is compared. */
function withoutIds(block: any): any {
  if (!block?.props) return block;
  const { id: _id, children, ...props } = block.props;
  return {
    ...block,
    props: { ...props, ...(children !== undefined && { children: Array.isArray(children) ? children.map(withoutIds) : children }) },
  };
}

/** The ids of a block and its descendants, in document order. */
function idsOf(block: any, into: unknown[] = []): unknown[] {
  into.push(block?.props?.id);
  if (Array.isArray(block?.props?.children)) block.props.children.forEach((c: any) => idsOf(c, into));
  return into;
}

/** Equal as data, whatever order the keys are in. */
function sameData(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function puckToMdx(data: Data, frontmatter: Frontmatter | undefined, options: GenerateOptions): string {
  const isRichtextField: RichtextFields = options.richtext === false ? () => false : options.richtext;
  const original = options.original;
  const layout = original?.layout;
  const keeper = original ? new Keeper(original.layout.source, original, isRichtextField) : undefined;
  const parts: Piece[] = [];

  // The frontmatter block, without the newline that terminates it — the join
  // below supplies every separator, so that one would make a second blank
  // line under the closing `---` on every page in the repository.
  if (frontmatter && Object.keys(frontmatter).length > 0) {
    parts.push(layout?.frontmatter && sameData(frontmatter, original!.frontmatter)
      ? { text: layout.source.slice(layout.frontmatter.start, layout.frontmatter.end), span: layout.frontmatter }
      : { text: writeFrontmatter(frontmatter, '').trimEnd() });
  }

  if (data.content?.length) {
    // The original's imports still serve a document using exactly the blocks
    // it used, whatever path they spell; any other set gets its own.
    const types = collectTypes(data.content);
    if (layout?.imports && sameData([...types].sort(), [...collectTypes(original!.data.content ?? [])].sort())) {
      parts.push({ text: layout.source.slice(layout.imports.start, layout.imports.end), span: layout.imports });
    } else {
      const importBlock = renderImportBlock(types, options.blockImports);
      if (importBlock) parts.push({ text: importBlock });
    }
    for (const component of data.content) {
      const piece = blockPiece(component, 0, isRichtextField, keeper);
      if (piece.text) parts.push(piece);
    }
  }

  if (parts.length === 0) return '';
  // Exactly one closing newline. A text file ends with one — 440 of the 448
  // documents here do — and it is what the copies under .obelum/ hold, so the last
  // byte stops flipping back and forth as a page is edited and then synced.
  return joinPieces(parts, '\n\n', layout?.source) + '\n';
}

/** One block: its original text when the save left it alone, otherwise written fresh. */
function blockPiece(component: any, depth: number, isRichtextField: RichtextFields, keeper?: Keeper): Piece {
  const span = keeper?.take(component, depth);
  if (span) return { text: keeper!.source.slice(span.start, span.end), span };
  return { text: componentToMdx(component, depth, isRichtextField, keeper) };
}

/**
 * Converts a single component to MDX
 */
function componentToMdx(component: any, depth: number, isRichtextField: RichtextFields, keeper?: Keeper): string {
  const indent = '  '.repeat(depth);
  const { type, props } = component;

  if (!type || !props) {
    return '';
  }

  // Extract id, children, and other props
  const { id, children, ...otherProps } = props;

  // Build attribute lines: id stays on the opening tag line, everything else gets its own line
  const attrLines: string[] = [];
  Object.entries(otherProps).forEach(([key, value]) => {
    // undefined and null are dropped because there is nothing to write that
    // reads back as either — the parser refuses both for the same reason. An
    // empty string is not in that company: `key=""` says exactly what it
    // means. It used to be dropped too, and an absent prop is then refilled
    // from the block's defaultProps, so clearing a field in the editor could
    // hand back the value the user had just deleted.
    if (value !== undefined && value !== null) {
      // Booleans and numbers must keep their type through the round trip, so
      // they go out as JSX expressions rather than quoted strings. Quoted, a
      // `true` comes back as the string "true", which fails the strict compare
      // Puck's radio field does against its option values — the saved choice
      // then shows as unselected. Worse, "false" and "0" are truthy strings, so
      // a falsy value would render as its opposite.
      if (typeof value === 'boolean' || typeof value === 'number') {
        // NaN and Infinity spell themselves as bare identifiers, which the
        // parser refuses — writing one produced a file the editor could not
        // reopen. They are what a cleared number field leaves behind, so
        // treat them as no value at all.
        if (typeof value === 'number' && !Number.isFinite(value)) return;
        attrLines.push(`${key}={${value}}`);
        return;
      }
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        attrLines.push(`${key}={${JSON.stringify(value)}}`);
      } else {
        let strValue = String(value);
        if (isRichtextField(type, key)) {
          strValue = htmlToMarkdown(strValue);
        }
        if (strValue.includes('\n')) {
          // Multi-line strings must use the JSX expression form
          // key={"...\n..."}, even though it reads worse than a quoted
          // attribute spanning lines — which MDX does accept.
          //
          // It accepts it and then normalizes it: leading whitespace on every
          // continuation line is stripped. "- one\n  - nested" comes back
          // "- one\n- nested", and a four-space code block comes back as
          // paragraph text. For markdown-bodied blocks that is silent content
          // damage, so the value goes out as an expression, where JSON
          // escaping preserves it exactly. See the round-trip tests.
          attrLines.push(`${key}={${JSON.stringify(strValue)}}`);
        } else {
          attrLines.push(`${key}="${escapeAttribute(strValue)}"`);
        }
      }
    }
  });

  // A body the author emptied is written as an attribute, because an empty
  // one has no spelling: `<X>\n\n</X>` reads back as no children at all, and
  // then Puck refills `children` from the block's defaultProps — CmFeatureRow
  // and CmContactCard both default a whole paragraph. Clearing the text,
  // saving and reopening handed it straight back, on a contentEditable body
  // where one keystroke committed it to disk. `children=""` says empty and
  // reads back as empty.
  //
  // Measured AFTER the richtext conversion, because an emptied richtext body
  // is never the empty string: Tiptap serialises an empty document as
  // `<p></p>`. Checking the raw prop looked right and matched nothing a user
  // could actually produce.
  const bodyText = typeof children === 'string'
    ? (isRichtextField(type, 'children') ? htmlToMarkdown(children) : children)
    : null;
  if (bodyText === '') attrLines.push('children=""');

  // Build opening tag: id on first line, each attribute on its own line
  // Escaped like every other attribute. It was the one that wasn't, so an id
  // carrying a quote — hand-edited, or imported from elsewhere — closed its
  // own attribute and the file stopped parsing.
  const idAttr = id ? ` id="${escapeAttribute(String(id))}"` : '';
  let openingTag: string;
  if (attrLines.length === 0) {
    openingTag = `${indent}<${type}${idAttr}`;
  } else if (attrLines.length === 1) {
    // Single attribute: keep on one line with id for readability
    openingTag = `${indent}<${type}${idAttr}\n${indent}  ${attrLines[0]}`;
  } else {
    // Multiple attributes: each on its own indented line
    openingTag = `${indent}<${type}${idAttr}\n${attrLines.map(a => `${indent}  ${a}`).join('\n')}`;
  }

  // Check if component has children (now in props.children for Slots API).
  // A body that converts to nothing counts as none — it is already written as
  // the `children=""` attribute above, and emitting `<X>\n\n</X>` as well
  // would read back as no children at all.
  const childrenFromProps = children;
  const hasChildren = childrenFromProps &&
                      ((typeof childrenFromProps === 'string' && bodyText !== '') ||
                       (Array.isArray(childrenFromProps) && childrenFromProps.length > 0));

  if (!hasChildren) {
    // Self-closing tag
    if (attrLines.length > 0) {
      return `${openingTag}\n${indent}/>`;
    }
    return `${openingTag} />`;
  }

  if (attrLines.length > 0) {
    openingTag += `\n${indent}>`;
  } else {
    openingTag += '>';
  }
  const closingTag = `${indent}</${type}>`;

  // Handle text content children
  if (typeof childrenFromProps === 'string') {
    // Converted once, above, so the empty check and the body agree.
    const content = bodyText as string;
    // EVERY line is indented to the block's body level, not just the first.
    // Indenting only the first line produced invalid MDX whenever the body
    // held a list: the un-indented list swallowed the indented closing tag as
    // a lazy continuation line, and the file no longer parsed — the editor's
    // own lenient reader used to hide that until an Astro build failed.
    // Blank lines stay empty rather than becoming trailing whitespace.
    const body = content
      .split('\n')
      .map(line => (line.trim() ? `${indent}  ${line}` : ''))
      .join('\n');
    return `${openingTag}\n${body}\n${closingTag}`;
  }

  // Handle component children (nested components from Slots)
  const childComponents = Array.isArray(childrenFromProps) ? childrenFromProps : [];
  if (childComponents.length === 0) {
    return `${openingTag}\n${closingTag}`;
  }

  // A changed block's unchanged children are still kept, so adding one item
  // to a menu does not reformat the others.
  const childrenMdx = joinPieces(
    childComponents
      .map((child: any) => blockPiece(child, depth + 1, isRichtextField, keeper))
      .filter((piece: Piece) => piece.text.length > 0),
    '\n',
    keeper?.source,
  );

  return `${openingTag}\n${childrenMdx}\n${closingTag}`;
}

/**
 * Escapes attribute values for MDX
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
