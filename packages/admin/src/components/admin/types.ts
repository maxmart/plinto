// The engine names this; the admin only displays it.
export type { StalenessStatus } from '@obelum/core';
import type { StalenessStatus } from '@obelum/core';

export interface ContentItem {
  /** Slug identifier — e.g. 'home', 'support', 'summer-cup' */
  slug: string;
  /** Title in the currently active lang (undefined if file missing for that lang) */
  title?: string;
  /** Content path for ops calls — e.g. 'page/support', 'news/summer-cup', 'topbar' */
  contentPath: string;
  /**
   * Real file path in the active lang, when the lister knows it. A slug like
   * docs/foo can live at docs/foo.mdx or docs/foo/index.mdx; rows that have
   * this don't need to guess.
   */
  filePath?: string;
  /** Staleness per lang — populated async after initial render */
  staleness?: Record<string, StalenessStatus>;
  /**
   * The value of the frontmatter key a section orders by (e.g. the publish
   * date), shown beside the title. Only set for section views.
   */
  orderValue?: string;
}

export type NavView =
  | { kind: 'pages' }
  | { kind: 'partials' }
  | { kind: 'section'; folder: string }
  | { kind: 'collection'; name: string }
  | { kind: 'settings' };

/** Stable identity for a view — the key both the sidebar and the per-view
 *  content cache use, so they can never disagree about what "the same view"
 *  means. */
export function viewKey(view: NavView): string {
  if (view.kind === 'collection') return `collection:${view.name}`;
  if (view.kind === 'section') return `section:${view.folder}`;
  return view.kind;
}
