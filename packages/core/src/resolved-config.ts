/**
 * The config the library actually runs on: every default applied, everything
 * derived already derived, nothing optional that the code then has to guess at.
 *
 * `PlintoConfig` in ../config is what a site *writes* — mostly optional, because
 * plinto's rule is that a convention beats an option. This is what it *becomes*,
 * and it is the only config type below this line. The Astro integration
 * produces one of these at `astro:config:setup` (reading Astro's own i18n
 * config, looking at the pages directory, finding the git root) and hands it to
 * the library.
 *
 * Two reasons it is a parameter and not a module anyone can import:
 *
 * - It is the whole coupling story. When `virtual:plinto-config` was in scope
 *   everywhere, thirty-seven modules depended on the site's configuration and
 *   no import graph showed it — a Vite virtual module is invisible to every
 *   tool that draws one. Passed in, the dependency is in the signature.
 * - Nothing here is Astro. A layer that takes this as an argument can be lifted
 *   out from under the Astro integration without touching a line of it.
 */
import type { CollectionConfig, PageField, PartialConfig } from './content-model';

export interface ResolvedI18n {
  /** Every locale, in Astro's declared order. Locale objects are normalized to their path form. */
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  /** Display label per locale, defaulted to the language's native name. */
  readonly labels: Record<string, string>;
  /**
   * Whether the default locale's pages sit under a directory of its own.
   * Not a setting: `{pagesDir}/{defaultLocale}/` exists exactly when it does.
   */
  readonly prefixDefaultLocale: boolean;
}

export interface ResolvedContent {
  readonly pagesDir: string;
  readonly partialsDir: string;
  readonly collectionsDir: string;
  readonly mediaDir: string;
  /** Where the site sits inside its git repository, '' at the root. */
  readonly siteSubdir: string;
  readonly pageLayout?: string;
  readonly collections?: Record<string, CollectionConfig>;
  readonly pageFields?: Record<string, Record<string, PageField>>;
  readonly sections?: ReadonlyArray<{ label: string; folder: string; orderBy?: string }>;
}

export interface ResolvedGit {
  readonly corsProxy: string;
  readonly defaultBranch: string;
  readonly defaultAuthorName: string;
  readonly defaultRepoUrl?: string;
}

/** Browser storage names, all derived from the single `storageKey` option. */
export interface ResolvedStorage {
  readonly keyPrefix: string;
  readonly fsDbName: string;
  readonly lfsDbName: string;
  readonly repoDir: string;
}

export interface ResolvedConfig {
  readonly i18n: ResolvedI18n;
  readonly content: ResolvedContent;
  readonly git: ResolvedGit;
  readonly storage: ResolvedStorage;
  /** Found by reading partialsDir, not declared. */
  readonly partials: readonly PartialConfig[];
}

// Not here: where a generated document imports a block's component from. What
// a block is, and how a file that holds one imports it, is the adapter's
// business — and nothing in this package ever read the map. Carrying it meant
// declaring its shape a second time, which is how its `export` came to be
// required here and optional there (optional is right: an omitted export is a
// default import, which is how .astro blocks are declared).
