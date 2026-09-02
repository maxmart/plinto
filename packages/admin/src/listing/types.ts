export interface ContentFile {
  lang: string;
  path: string;    // site-relative, e.g. "src/pages/sv/support.mdx"
  name: string;    // e.g., "home", "support"
  title?: string;  // from frontmatter
  /**
   * The page's whole frontmatter. `title` above is the one field the page
   * browser has always needed and stays where it is; everything else a caller
   * might want — a news article's date, excerpt and thumbnail — lives here.
   *
   * Carrying it costs nothing: the frontmatter is already parsed to find the
   * title, so listing pages used to parse it and then throw it away.
   */
  data: Record<string, unknown>;
}

/**
 * A page together with its body — what a listing needs, and strictly more than
 * `listPages` returns.
 *
 * The two are separate on purpose. Listing every page of every locale for the
 * admin's page browser reads frontmatter only, and the file stores answer that
 * from the directory listing without opening the files. A listing block wants
 * the body as well, but only for the handful of pages in one section, so it
 * pays for those reads itself instead of making the page browser pay for all
 * of them.
 */
export interface PageEntry extends ContentFile {
  /** The file below its frontmatter. */
  body: string;
}

export interface CollectionEntry {
  slug: string;
  data: Record<string, any>;
  body: string;
}

/**
 * The filters useCollection's options offer, applied identically on both
 * sides of the build — the server read and the browser read must agree.
 * `slugs` selects and orders ("a,b,c" returns those entries in that order);
 * `group` keeps entries whose frontmatter `group` matches.
 */
export function applyCollectionFilters(
  entries: CollectionEntry[],
  options?: { slugs?: string; group?: string },
): CollectionEntry[] {
  let result = entries;
  if (options?.slugs) {
    const slugList = options.slugs.split(',').map(s => s.trim());
    result = slugList
      .map(s => result.find(e => e.slug === s))
      .filter((e): e is CollectionEntry => e !== undefined);
  }
  if (options?.group) {
    result = result.filter(e => e.data.group === options.group);
  }
  return result;
}
