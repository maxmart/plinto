/**
 * The generator's richtext path, with `children` actually declared as
 * richtext — which is how a real site is configured and how no other test in
 * this package was set up, so this code went two review rounds unexercised.
 */
import type { Data } from '@puckeditor/core';

import { parseMdx } from '../parser';
import { puckToMdx } from '../generator';
// A block map with one default-import entry (no `export`), because that is
// how the .astro block components are declared and the branch needs reaching.
const blockImports = {
  CmHero: { module: '@example/blocks/CmHero', export: 'CmHero' },
  CmText: { module: '@example/blocks/CmText', export: 'CmText' },
  CmColumns: { module: '@example/blocks/CmColumns', export: 'CmColumns' },
  CmColumn: { module: '@example/blocks/CmColumns', export: 'CmColumn' },
  CmNations: { module: '@/components/blocks/CmNations.astro' },
};

// Handed in rather than mocked: the parser and generator take the rule as an
// argument, so a test states it in a line instead of standing in for a module.
const richtext = (_type: string, field: string) => field === 'children' || field === 'body';
const gen = { richtext, blockImports };

const write = (children: unknown) =>
  puckToMdx({ content: [{ type: 'CmText', props: { id: 'CmText-1', children } }], root: { props: {} } } as Data, undefined, gen);

const readBack = (mdx: string) =>
  (parseMdx(mdx, { strict: false, richtext: false }).data.content[0] as { props: Record<string, unknown> }).props;

describe('a body the author emptied', () => {
  // Tiptap serialises an empty document as <p></p>, never ''. Checking the
  // raw prop for '' therefore matched nothing a user could produce: the body
  // converted to empty markdown, the tag was written with an empty body, and
  // that reads back with no `children` prop at all — which is the shape Puck
  // refills from defaultProps. CmFeatureRow and CmContactCard both default a
  // paragraph, so clearing the text and reopening handed it back, on a
  // contentEditable surface where one keystroke commits it to disk.
  const empties = ['', '<p></p>', '<p><br class="ProseMirror-trailingBreak"></p>', '<p></p><p></p>', '<p> </p>'];

  for (const html of empties) {
    it(`round-trips ${JSON.stringify(html)} as empty, not as absent`, () => {
      const mdx = write(html);
      expect(mdx).toContain('children=""');
      expect(readBack(mdx).children).toBe('');
    });
  }

  it('is byte-stable once written', () => {
    const once = write('<p></p>');
    const parsed = parseMdx(once, { strict: false, richtext: false });
    expect(puckToMdx(parsed.data, parsed.frontmatter, gen)).toBe(once);
  });

  it('still writes a body when there is one', () => {
    const mdx = write('<p>Real words.</p>');
    expect(mdx).not.toContain('children=""');
    expect(readBack(mdx).children).toBe('Real words.');
  });
});
