/**
 * Deriving a listing card's summary from the article itself.
 *
 * A listing shows a thumbnail and a standfirst for each article. Both are
 * *derived* rather than stored: a copy in frontmatter is a second version of
 * the article's opening that goes stale the moment anyone edits the real one,
 * and nothing tells you it has. Reading the body means the card cannot drift.
 *
 * The prose is not lying around in the markdown, though. These documents are
 * blocks, and their text lives inside block props:
 *
 *   <CmSection body={"**Heading**\n\nThe actual first paragraph…"} />
 *
 * so this parses the document the way the CMS does — through the MDX parser —
 * and walks the resulting blocks, rather than pattern-matching the source.
 */
import { parseMdx } from '../mdx/parser';

/** Props that may carry an article's prose, in order of preference. */
const TEXT_PROPS = ['body', 'children', 'text'];
/** Props that may carry an image path. */
const IMAGE_PROPS = ['image', 'src', 'backgroundMedia'];

export interface PageSummary {
  /** Plain-text standfirst, truncated on a word boundary. */
  excerpt: string;
  /** First image in the body, if it has one. */
  image?: string;
}

export interface SummaryOptions {
  /**
   * The page's title. Articles routinely open with a bold line repeating their
   * own headline, which reads as a stutter on a card, so a first line matching
   * this is dropped.
   */
  title?: string;
  /** Roughly the length of the standfirsts this replaces. */
  maxLength?: number;
}

/**
 * Plain text from a block's prop value.
 *
 * The value may be markdown (a plain string prop) or HTML (a richtext prop,
 * which the parser converts on the way in), so both are flattened: tags out,
 * entities decoded, then the markdown constructs that carry no meaning without
 * formatting — emphasis, links, images, headings, list bullets, quotes.
 */
function toPlainText(value: string): string {
  let text = value;

  // Images first: their alt text is not part of the prose.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  // Links keep their label, drop the target.
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // HTML: block tags become breaks so words either side don't run together.
  text = text.replace(/<(?:br|\/p|\/h[1-6]|\/li|\/div)[^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  // Entities. &nbsp; becomes a normal space — a card is not the place for it.
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#3[49];|&apos;/gi, "'");
  // Markdown leftovers.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  text = text.replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '');
  text = text.replace(/(\*\*\*|\*\*|\*|___|__|_|~~|`)/g, '');

  return text;
}

/** Depth-first walk of the parsed blocks, in document order. */
function walk(nodes: unknown[], visit: (props: Record<string, unknown>) => void): void {
  for (const node of nodes) {
    const block = node as { props?: Record<string, unknown> } | null;
    if (!block?.props) continue;
    visit(block.props);
    const children = block.props.children;
    if (Array.isArray(children)) walk(children, visit);
  }
}

/** Cut to length without splitting a word, adding an ellipsis if anything went. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?-]+$/, '')} …`;
}

/**
 * A card's thumbnail and standfirst, read out of the article body.
 *
 * @param mdx  The article — with or without its frontmatter, both parse.
 * @param options  See SummaryOptions.
 */
export function derivePageSummary(mdx: string, options: SummaryOptions = {}): PageSummary {
  const { title, maxLength = 160 } = options;

  let blocks: unknown[] = [];
  try {
    // Not strict: an article carrying a stray paragraph should still get a
    // card. `skipped` is the editor's problem, not the listing's.
    blocks = parseMdx(mdx, { strict: false, richtext: false }).data.content as unknown[];
  } catch {
    return { excerpt: '' };
  }

  let image: string | undefined;
  const texts: string[] = [];

  walk(blocks, props => {
    if (!image) {
      for (const key of IMAGE_PROPS) {
        const v = props[key];
        // Videos are legitimate hero backgrounds and are not thumbnails.
        if (typeof v === 'string' && v && !/\.(mp4|webm|mov)$/i.test(v)) { image = v; break; }
      }
    }
    for (const key of TEXT_PROPS) {
      const v = props[key];
      if (typeof v === 'string' && v.trim()) { texts.push(v); break; }
    }
  });

  // Fall back to an image embedded in the prose rather than placed as a block.
  if (!image) {
    for (const t of texts) {
      const md = /!\[[^\]]*\]\(([^)\s]+)/.exec(t) ?? /<img[^>]+src=["']([^"']+)/i.exec(t);
      if (md) { image = md[1]; break; }
    }
  }

  const normalizedTitle = title ? normalize(title) : '';

  // Paragraphs of prose, in document order, across every block.
  const paragraphs = texts.flatMap(raw =>
    toPlainText(raw)
      .split(/\n\s*\n|\n/)
      .map(p => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );

  // Run paragraphs together until there is enough for a standfirst, rather
  // than stopping at the first one. Articles here routinely open with a short
  // bold line — "We have updated the app" — and a card showing only that
  // says nothing; the sentence that follows it is the actual summary.
  const parts: string[] = [];
  for (const paragraph of paragraphs) {
    // The stutter: a leading line that is just the headline again.
    if (!parts.length && normalizedTitle && normalize(paragraph) === normalizedTitle) continue;
    parts.push(paragraph);
    // The join below is what actually gets truncated, so measure that rather
    // than a running total that has to be kept in step with it.
    if (parts.join(' ').length > maxLength) break;
  }

  return { excerpt: truncate(parts.join(' '), maxLength), image };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
