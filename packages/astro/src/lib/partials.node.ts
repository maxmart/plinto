import fs from 'node:fs';
import path from 'node:path';
import type { PartialConfig } from '../config';

/**
 * Find the site's partials by looking at the directory, the way pages are
 * found by looking at src/pages.
 *
 * Node-only, and called once from the integration: the result travels to the
 * browser through virtual:plinto-config, so the admin keeps a synchronous list
 * without needing a filesystem it doesn't have. The cost is that adding a
 * partial needs a dev-server restart — the same as adding a block.
 *
 * Everything here is derived from the filename, because everything here was
 * always derivable from it:
 *
 *   TopBar.mdx  ->  name 'topbar' (the ops contentPath), label 'Top Bar'
 *
 * Where a partial appears is deliberately not derived. It isn't a property of
 * the file at all — it is the layout's, and for the editor it is the site's
 * preview shell's.
 */
export function derivePartials(partialsRoot: string, locales: readonly string[]): PartialConfig[] {
  const files = new Set<string>();

  // The union across locales, not just the default one: a partial that so far
  // exists only in Norwegian is still a partial, and the admin should list it
  // as missing elsewhere rather than not at all.
  for (const lang of locales) {
    const dir = path.join(partialsRoot, lang);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // `_`-prefixed files are Astro's own convention for "not a route";
      // borrow it so a shared fragment isn't mistaken for a partial.
      if (!entry.isFile() || !entry.name.endsWith('.mdx') || entry.name.startsWith('_')) continue;
      files.add(entry.name);
    }
  }

  const byName = new Map<string, PartialConfig>();
  for (const file of [...files].sort()) {
    const base = file.replace(/\.mdx$/, '');
    const name = base.toLowerCase();
    const clash = byName.get(name);
    if (clash) {
      throw new Error(
        `[plinto] partials ${clash.file} and ${file} both resolve to the name "${name}", ` +
        `which is what the CMS stores and links them by. Rename one.`,
      );
    }
    byName.set(name, {
      name,
      file,
      label: base.replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
    });
  }

  return [...byName.values()];
}
