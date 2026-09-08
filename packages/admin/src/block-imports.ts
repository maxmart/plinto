/**
 * Where a generated MDX file imports each block's component from.
 *
 * The map itself is worked out at config time by the Node-only sibling
 * `block-imports.node.ts` and travels to the browser through
 * virtual:plinto-config. This module holds the parts the generator needs while
 * running in the editor, and so must stay free of Node built-ins.
 */

/**
 * How a block's component is imported into a generated MDX file.
 */
export interface BlockImport {
  /**
   * Aliased specifier, e.g. '@/components/blocks/Menu'.
   *
   * Not '../../': the import must be right from whatever depth the page sits
   * at. Not '/src/...' either — Vite resolves a leading slash but TypeScript
   * does not, so VS Code would lose go-to-definition and prop checking in the
   * MDX file, which is half the reason for writing the imports at all. The
   * tsconfig alias is understood by both.
   */
  module: string;
  /**
   * Named export to import. Omitted for a default export, which is how the
   * .astro block components are declared.
   */
  export?: string;
}

/** Block name (as written in MDX) -> where its component comes from. */
export type BlockImportMap = Record<string, BlockImport>;

/**
 * Render the import block for one MDX document: the minimum set of statements
 * covering the block types it uses, one line per module, sorted for a stable
 * diff when the editor rewrites a file.
 */
export function renderImportBlock(types: Iterable<string>, imports: BlockImportMap): string {
  const byModule = new Map<string, { named: Set<string>; default?: string }>();

  for (const type of new Set(types)) {
    const info = imports[type];
    if (!info) {
      // A type in the document that the import map doesn't know would be
      // serialized into the body with no import — a page that fails to
      // build. Silently dropping it once broke a page after a block was
      // added to the registry while the dev server (whose virtual config is
      // baked at startup) was still running with the old map.
      throw new Error(
        `Block "${type}" is not in the import map. ` +
        `If it was just added to the registry, restart the dev server.`,
      );
    }
    const group = byModule.get(info.module) ?? { named: new Set<string>() };
    if (info.export) group.named.add(info.export);
    else group.default = type;                 // aliased to the block's own name
    byModule.set(info.module, group);
  }

  // Code-unit order, deliberately not localeCompare: this text goes into a
  // file. localeCompare asks the runtime's locale, and a module path with an
  // Å in it sorts after Z under sv-SE and before B under en-US — so the same
  // registry produced a different import block depending on whose machine
  // saved the page, and the diff blamed whoever saved it second.
  return [...byModule.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([module, { named, default: def }]) => {
      const clauses: string[] = [];
      if (def) clauses.push(def);
      if (named.size) clauses.push(`{ ${[...named].sort().join(', ')} }`);
      return `import ${clauses.join(', ')} from '${module}';`;
    })
    .join('\n');
}
