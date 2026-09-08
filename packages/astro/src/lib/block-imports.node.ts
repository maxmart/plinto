import fs from 'node:fs';
import path from 'node:path';
import type { BlockImport, BlockImportMap } from '@plinto/admin/block-imports';

/**
 * Work out, for every registered block, which module and export provides the
 * component an MDX file should import.
 *
 * Node-only, and called once from the integration: the result is serialised
 * into virtual:plinto-config so the generator can write import statements while
 * running in the browser, where none of this is available.
 *
 * Derived by parsing the site's block registry rather than importing it: this
 * runs at config time, before Vite exists, and the registry is TSX — which
 * Node can't load. Parsing is reliable because the import statements are
 * themselves the mapping, and the registry is shorthand, so a block's name is
 * the identifier that was imported.
 *
 * Block name does not imply module: 34 blocks live in 26 modules, and Menu.tsx
 * alone provides five of them. Any './blocks/{Name}' convention would break
 * for roughly a third of them.
 */
export function deriveBlockImports(blocksFile: string, alias = '@'): BlockImportMap {
  // Comments come off once, before anything counts a brace or splits on a
  // comma. Stripping them later — inside each scan — left `objectBody`
  // matching braces in the raw text, so `Hero, // close the } yourself`
  // ended the registry early and dropped every block after it, and
  // `Hero, // the { grid one` made it report no registry at all.
  const source = stripComments(fs.readFileSync(blocksFile, 'utf-8'));
  const { provider, aliased } = importedIdentifiers(source, alias);
  const astro = astroOverrides(source, blocksFile, alias);

  const map: BlockImportMap = {};
  for (const name of registeredBlocks(source)) {
    const found = astro[name] ?? provider[name];
    if (!found) {
      if (aliased.has(name)) {
        throw new Error(
          `[plinto] ${path.basename(blocksFile)} imports "${name}" under an alias. ` +
          `A block's registered name has to be the name its module exports, because ` +
          `that is the name a generated page will import — drop the "as".`,
        );
      }
      throw new Error(
        `[plinto] ${path.basename(blocksFile)} registers a block "${name}" that ` +
        `is not imported there, so no page could import it either. Add an ` +
        `import for it, or list it in astroBlocks with a path to its .astro file.`,
      );
    }
    map[name] = found;
  }
  return map;
}

/** Comments, so neither the entry scan nor a split on ',' trips over one. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * The specifier a generated MDX file should use for a module the registry
 * imports.
 *
 * A relative path is rewritten to the site's alias, because the page importing
 * it sits at some other depth. Anything else — a package, or an alias the
 * registry already used — is passed through: a block that lives in
 * @example/blocks is imported by that name from a page exactly as it is from the
 * registry.
 */
const toModule = (specifier: string, alias: string) =>
  specifier.startsWith('.') ? `${alias}/${specifier.replace(/^\.\//, '')}` : specifier;

/**
 * Every identifier the registry file imports, and where each comes from —
 * plus the ones imported under an alias, which cannot provide a block and are
 * remembered only so the failure can say why.
 */
function importedIdentifiers(
  source: string,
  alias: string,
): { provider: Record<string, BlockImport>; aliased: Set<string> } {
  const provider: Record<string, BlockImport> = {};
  const aliased = new Set<string>();
  const named = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  const dflt = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;

  for (const m of source.matchAll(named)) {
    for (const raw of m[1].split(',')) {
      const name = raw.replace(/\btype\b/, '').trim();
      if (!name) continue;
      // `Foo as Bar` names a local binding that no page can reproduce: a
      // generated file imports the block by its registered name, so the two
      // have to be the same word.
      const [, local] = name.split(/\s+as\s+/);
      if (local) aliased.add(local.trim());
      else provider[name] = { module: toModule(m[2], alias), export: name };
    }
  }
  for (const m of source.matchAll(dflt)) {
    provider[m[1]] = { module: toModule(m[2], alias) };
  }
  return { provider, aliased };
}

/** The body of a top-level `export const {name} = { … }`, braces matched. */
function objectBody(source: string, name: string): string | null {
  const start = source.search(new RegExp(`export const ${name}\\b[^=]*=\\s*\\{`));
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  return null;
}

/**
 * Block names, from the shorthand entries of the `blocks` object.
 *
 * Every entry has to be understood or refused. The scan used to be a
 * line-anchored regex that quietly skipped anything else, so `Hero, // the
 * big one` registered nothing — and the eventual complaint came from the
 * generator, at save time, saying the block was missing from the import map
 * and to restart the dev server. Restarting did not help, because the comment
 * was the problem.
 */
function registeredBlocks(source: string): string[] {
  const body = objectBody(source, 'blocks');
  if (body === null) throw new Error('[plinto] the blocks module exports no `blocks` object');

  const names: string[] = [];
  for (const raw of body.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (!/^\w+$/.test(entry)) {
      throw new Error(
        `[plinto] the blocks registry entry \`${entry}\` is not shorthand. Write ` +
        `every block as \`Name,\` — the name a page writes in MDX has to be the ` +
        `identifier that was imported, which is how plinto knows where to import it from.`,
      );
    }
    names.push(entry);
  }
  return names;
}

/**
 * Blocks whose page-side import should point at an .astro component instead.
 * The path is checked here rather than left to fail later as an unresolved
 * import inside a generated file, which would name the MDX and not the typo.
 */
function astroOverrides(source: string, blocksFile: string, alias: string): Record<string, BlockImport> {
  const body = objectBody(source, 'astroBlocks');
  const overrides: Record<string, BlockImport> = {};
  if (body === null) return overrides;

  for (const m of body.matchAll(/^\s*(\w+):\s*['"](\.[^'"]+)['"],?\s*$/gm)) {
    const [, name, rel] = m;
    const resolved = path.resolve(path.dirname(blocksFile), rel);
    if (!fs.existsSync(resolved)) {
      throw new Error(`[plinto] astroBlocks.${name} points at ${rel}, which does not exist`);
    }
    overrides[name] = { module: toModule(rel, alias) };
  }
  return overrides;
}
