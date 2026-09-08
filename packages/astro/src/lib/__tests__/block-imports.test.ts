/**
 * The block registry is read at config time by parsing it, because it is TSX
 * and this runs before Vite exists. That makes the reading itself a place
 * things can go quietly wrong, and everything here is a case where they did
 * or could.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveBlockImports } from '../block-imports.node';
import { renderImportBlock } from '@plinto/admin/block-imports';

/** Write a registry to a temp dir and derive its import map. */
function derive(source: string, extra: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinto-blocks-'));
  const file = path.join(dir, 'plinto-blocks.tsx');
  fs.writeFileSync(file, source, 'utf8');
  for (const [name, body] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body, 'utf8');
  }
  try {
    return deriveBlockImports(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('deriveBlockImports', () => {
  it('maps each registered block to the module that exports it', () => {
    expect(derive(`
import { Hero, Card } from './blocks/Basics';
import Menu from '@example/blocks/Menu';

export const blocks: BlockRegistry = {
  Hero,
  Card,
  Menu,
};
`)).toEqual({
      Hero: { module: '@/blocks/Basics', export: 'Hero' },
      Card: { module: '@/blocks/Basics', export: 'Card' },
      Menu: { module: '@example/blocks/Menu' },
    });
  });

  it('reads entries that carry a trailing comment', () => {
    // The line-anchored scan this replaced returned nothing for these, and
    // the failure surfaced much later as "restart the dev server".
    expect(Object.keys(derive(`
import { Hero, Card } from './blocks/Basics';

export const blocks: BlockRegistry = {
  // Site header
  Hero,     // the big one
  Card, /* and the small one */
};
`))).toEqual(['Hero', 'Card']);
  });

  it('is not confused by a brace or a comma inside a comment', () => {
    // Comments used to come off after the braces were counted, so a `}` in
    // one ended the registry early and silently dropped everything after it,
    // and a `{` made it report no registry at all.
    expect(Object.keys(derive(`
import { Hero, Card } from './blocks/Basics';

export const blocks: BlockRegistry = {
  Hero,   // close the } yourself, and the { grid one, too
  Card,
};
`))).toEqual(['Hero', 'Card']);
  });

  it('reads an astroBlocks entry that carries a trailing comment', () => {
    // The registry tolerated comments and this sibling list did not, so the
    // override was dropped and the block shipped without its .astro wrapper —
    // silently, since a React module for it does exist.
    expect(derive(`
import { Slider } from './blocks/Slider';

export const astroBlocks = {
  Slider: './blocks/Slider.astro', // hydrates
};

export const blocks: BlockRegistry = {
  Slider,
};
`, { 'blocks/Slider.astro': '<div />' })).toEqual({
      Slider: { module: '@/blocks/Slider.astro' },
    });
  });

  it('refuses an entry it cannot read rather than skipping it', () => {
    expect(() => derive(`
import { Hero } from './blocks/Basics';
import { shared } from './shared';

export const blocks: BlockRegistry = {
  Hero,
  ...shared,
};
`)).toThrow(/not shorthand/);
  });

  it('says why an aliased import cannot provide a block', () => {
    expect(() => derive(`
import { CmHero as Hero } from '@example/blocks';

export const blocks: BlockRegistry = {
  Hero,
};
`)).toThrow(/under an alias/);
  });

  it('still reports a genuinely missing import as missing', () => {
    expect(() => derive(`
export const blocks: BlockRegistry = {
  Hero,
};
`)).toThrow(/is not imported there/);
  });

  it('ignores an import that is only mentioned in a comment', () => {
    expect(() => derive(`
// import { Hero } from './blocks/Basics';

export const blocks: BlockRegistry = {
  Hero,
};
`)).toThrow(/is not imported there/);
  });

  it('points a listed astro block at its .astro file', () => {
    expect(derive(`
import { Slider } from './blocks/Slider';

export const astroBlocks = {
  Slider: './blocks/Slider.astro',
};

export const blocks: BlockRegistry = {
  Slider,
};
`, { 'blocks/Slider.astro': '<div />' })).toEqual({
      Slider: { module: '@/blocks/Slider.astro' },
    });
  });

  it('refuses an astroBlocks path that does not exist', () => {
    expect(() => derive(`
import { Slider } from './blocks/Slider';

export const astroBlocks = {
  Slider: './blocks/Missing.astro',
};

export const blocks: BlockRegistry = {
  Slider,
};
`)).toThrow(/does not exist/);
  });

  it('refuses a file with no blocks object', () => {
    expect(() => derive(`export const nothing = 1;`)).toThrow(/no `blocks` object/);
  });
});

describe('renderImportBlock', () => {
  const imports = {
    Hero: { module: '@/blocks/Basics', export: 'Hero' },
    Card: { module: '@/blocks/Basics', export: 'Card' },
    Menu: { module: '@example/blocks/Menu' },
  };

  it('groups a module into one statement, sorted for a stable diff', () => {
    expect(renderImportBlock(['Card', 'Menu', 'Hero'], imports)).toBe(
      `import { Card, Hero } from '@/blocks/Basics';\n` +
      `import Menu from '@example/blocks/Menu';`,
    );
  });

  it('orders modules the same way on every machine', () => {
    // localeCompare would not: an Å sorts after Z under sv-SE and before B
    // under en-US, so this text — which goes into a file — would depend on
    // the locale of whoever pressed save.
    const nordic = {
      Angst: { module: '@/blocks/Ångest', export: 'Angst' },
      Basic: { module: '@/blocks/Basics', export: 'Basic' },
      Zebra: { module: '@/blocks/Zebra', export: 'Zebra' },
    };
    expect(renderImportBlock(['Angst', 'Basic', 'Zebra'], nordic)).toBe(
      `import { Basic } from '@/blocks/Basics';\n` +
      `import { Zebra } from '@/blocks/Zebra';\n` +
      `import { Angst } from '@/blocks/Ångest';`,
    );
  });

  it('emits the same text whatever order the blocks appear in', () => {
    expect(renderImportBlock(['Hero', 'Card'], imports))
      .toBe(renderImportBlock(['Card', 'Hero'], imports));
  });

  it('imports a block only once however often it is used', () => {
    expect(renderImportBlock(['Hero', 'Hero', 'Hero'], imports))
      .toBe(`import { Hero } from '@/blocks/Basics';`);
  });

  it('refuses a block missing from the map instead of writing a page that cannot build', () => {
    expect(() => renderImportBlock(['Unknown'], imports)).toThrow(/restart the dev server/);
  });
});
