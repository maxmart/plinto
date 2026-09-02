import type { Data } from '@puckeditor/core';
import { writeFrontmatter, type Frontmatter } from '@plinto/core/frontmatter';
import { htmlToMarkdown } from './markdown-html';
import type { RichtextFields } from './richtext-fields';
import { renderImportBlock } from '../block-imports';
import type { BlockImportMap } from '../block-imports';

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
}

export function puckToMdx(data: Data, frontmatter: Frontmatter | undefined, options: GenerateOptions): string {
  const isRichtextField: RichtextFields = options.richtext === false ? () => false : options.richtext;
  const parts: string[] = [];

  // The frontmatter block, without the newline that terminates it — the join
  // below supplies every separator, so that one would make a second blank
  // line under the closing `---` on every page in the repository.
  if (frontmatter && Object.keys(frontmatter).length > 0) {
    parts.push(writeFrontmatter(frontmatter, '').trimEnd());
  }

  if (data.content?.length) {
    const body: string[] = [];
    const importBlock = renderImportBlock(collectTypes(data.content), options.blockImports);
    if (importBlock) body.push(importBlock);
    for (const component of data.content) {
      const mdx = componentToMdx(component, 0, isRichtextField);
      if (mdx) body.push(mdx);
    }
    if (body.length) parts.push(body.join('\n\n'));
  }

  if (parts.length === 0) return '';
  // Exactly one closing newline. A text file ends with one — 440 of the 448
  // documents here do — and it is what setSyncMeta writes too, so the last
  // byte stops flipping back and forth as a page is edited and then synced.
  return parts.join('\n\n') + '\n';
}

/**
 * Converts a single component to MDX
 */
function componentToMdx(component: any, depth: number, isRichtextField: RichtextFields): string {
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

  const childrenMdx = childComponents
    .map((child: any) => componentToMdx(child, depth + 1, isRichtextField))
    .filter((mdx: string) => mdx.length > 0)
    .join('\n');

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
