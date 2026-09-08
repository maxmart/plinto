import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Strip the common leading indentation from every line. MDX children of
 * nested components arrive indented (authoring indentation), and markdown
 * would otherwise treat 4+ leading spaces as a code block. The first line is
 * excluded from the minimum computation (extraction usually trims it) but
 * never has more than its own leading whitespace removed.
 */
function dedent(text: string): string {
  const lines = text.split('\n');
  if (lines.length < 2) return text;

  const indentOf = (l: string) => (l.match(/^[ \t]*/) as RegExpMatchArray)[0].length;
  const rest = lines.slice(1).filter((l) => l.trim().length > 0);
  const min = rest.length > 0 ? Math.min(...rest.map(indentOf)) : 0;
  if (min === 0) return text;

  return [
    lines[0].slice(Math.min(min, indentOf(lines[0]))),
    ...lines.slice(1).map((l) => l.slice(Math.min(min, indentOf(l)))),
  ].join('\n');
}

/**
 * Typography for rendered prose. Tailwind's preflight zeroes paragraph
 * margins and strips list styles, so rich content needs its own baseline.
 * Colors inherit, so the same rules serve light blocks and the dark footer.
 */
const richStyles = `
.pg-rich > *:first-child { margin-top: 0; }
.pg-rich > *:last-child { margin-bottom: 0; }
.pg-rich p { margin: 0 0 0.9em; }
.pg-rich ul { list-style: disc; padding-left: 1.4em; margin: 0 0 0.9em; }
.pg-rich ol { list-style: decimal; padding-left: 1.4em; margin: 0 0 0.9em; }
.pg-rich li { margin: 0.3em 0; }
.pg-rich a { color: var(--brand); text-decoration: none; }
.pg-rich a:hover { text-decoration: underline; }
.pg-rich strong { font-weight: 700; }
.pg-rich blockquote { border-left: 3px solid var(--brand); padding-left: 1em; margin: 1em 0; font-style: italic; opacity: 0.85; }
.pg-rich h3, .pg-rich h4 { font-weight: 700; margin: 1.2em 0 0.5em; font-family: var(--font-heading); }
.pg-rich h3 { font-size: 1.25em; }
.pg-rich h4 { font-size: 1.1em; }
.pg-rich table { border-collapse: collapse; margin: 1em 0; }
.pg-rich th, .pg-rich td { border: 1px solid #d5d5d5; padding: 5px 10px; text-align: left; }
.pg-rich th { background: rgba(0,0,0,0.045); font-weight: 700; }
.pg-rich img { max-width: 100%; height: auto; }
.pg-rich hr { border: none; border-top: 1px solid rgba(0,0,0,0.12); margin: 1.4em 0; }
.pg-rich pre { background: #f4f4f2; border-radius: 6px; padding: 12px 16px; overflow-x: auto; font-size: 0.9em; }
.pg-rich code { font-family: ui-monospace, 'Cascadia Code', Menlo, monospace; }
`;

/**
 * Prose inside a block, in whichever of the three forms it arrives.
 *
 * - Already-rendered nodes, when MDX parsed the markdown between a block's
 *   tags and handed us elements. This is the normal case on a page.
 * - An HTML string, from the editor's richtext field (Tiptap stores HTML).
 * - A markdown string, from a plain attribute in the MDX source.
 *
 * All three land in the same `.pg-rich` wrapper, which is what gives them
 * their typography — returning bare children would silently render the same
 * words unstyled.
 */
export function RichText({ children }: { children?: string | ReactNode }) {
  if (typeof children !== 'string') {
    if (children === null || children === undefined || children === false) return null;
    return (
      <>
        <style>{richStyles}</style>
        <div className="pg-rich">{children}</div>
      </>
    );
  }

  if (!children.trim()) return null;

  // Detect HTML: starts with an HTML tag (tag names may contain digits: h1-h6)
  if (/^\s*<[a-z][a-z0-9]*(\s|\/?>)/i.test(children)) {
    return (
      <>
        <style>{richStyles}</style>
        <div className="pg-rich" dangerouslySetInnerHTML={{ __html: children }} />
      </>
    );
  }

  // Otherwise treat as markdown (GFM enables tables, strikethrough, autolinks)
  return (
    <>
      <style>{richStyles}</style>
      <div className="pg-rich">
        <Markdown remarkPlugins={[remarkGfm]}>{dedent(children)}</Markdown>
      </div>
    </>
  );
}
