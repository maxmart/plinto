/**
 * What a document is: collections, partials, and the extra frontmatter fields
 * an editor offers on a page.
 *
 * These describe the content, not the site generator, so they live here rather
 * than beside the Astro integration's own options — `@plinto/astro/config`
 * re-exports them, and a site declaring a collection still writes one import.
 */

/** A single field shown in the collection editor. */
export interface CollectionFieldConfig {
  /** Frontmatter key, or the reserved key `'body'` to store in the markdown body. */
  key: string;
  /** Field type. 'richtext' is only valid for key === 'body' and only in editor:'form'. */
  type: 'text' | 'textarea' | 'select' | 'date' | 'image' | 'richtext';
  /** Label shown above the input. */
  label: string;
  /** Required when type === 'select'. */
  options?: string[];
  /**
   * For type === 'image': the media subfolder to browse and upload into, e.g.
   * 'staff'. Scoping both ends is the point — a picker for portraits should not
   * offer every photo on the site, and a portrait uploaded from it should not
   * land among them. Unset browses the whole library.
   */
  folder?: string;
}

/** Per-collection editor configuration. */
export interface CollectionConfig {
  /**
   * Directory holding this collection's entries, as `{dir}/{lang}/{slug}.mdx`.
   * Site-relative, and may climb out of the site with `../` — that is how a
   * monorepo shares a collection between sites, e.g.
   * `'../../content-shared/staff'`. Defaults to `{collectionsDir}/{name}`.
   */
  dir?: string;
  /** Editor mode. 'form' renders all fields as form inputs. 'puck' renders fields above a Puck canvas. */
  editor: 'form' | 'puck';
  /** Display label in the admin sidebar. */
  label: string;
  /** Frontmatter field used as the entry's list title. */
  titleField: string;
  /** Declared fields, rendered in order. */
  fields: CollectionFieldConfig[];
}

/**
 * A named singleton document — page-like MDX that lives at
 * `{partialsDir}/{lang}/{file}` rather than under the pages directory, and is
 * rendered as part of the site's shell rather than at a URL of its own.
 * TopBar and Footer are the usual two.
 *
 * Not declared: the integration finds these by reading the directory, the way
 * pages are found by reading the pages directory, and derives every field
 * below from the filename. Where a partial appears is not here either — the
 * layout decides it for the page, and the site's preview shell decides it for
 * the editor.
 */
export interface PartialConfig {
  /**
   * Stable lowercase identifier, derived from the basename. Doubles as the ops
   * `contentPath` (e.g. 'topbar'), so it is what links and commits refer to.
   */
  name: string;
  /** Basename under `{partialsDir}/{lang}/`. Example: 'TopBar.mdx' */
  file: string;
  /** Label shown in the admin's Partials list. 'TopBar.mdx' -> 'Top Bar'. */
  label: string;
}

/** A single extra frontmatter field offered by the editor's page panel. */
export interface PageField {
  type: 'text' | 'textarea' | 'date';
  label: string;
}
