import { placementOf } from '../placement';
import type { BlockRegistry } from '../registry';

const block = (config: Record<string, unknown>) => Object.assign(() => null, { config: { fields: {}, ...config } });

const blocks: BlockRegistry = {
  Hero: block({}),
  Logo: block({}),
  Menu: block({ fields: { children: { type: 'slot' } } }),
  MenuItem: block({ fields: { children: { type: 'slot' } }, allowedIn: ['Menu', 'MenuItem'] }),
  Columns: block({ fields: { children: { type: 'slot', disallow: ['Hero'] } } }),
};

describe('placement', () => {
  it('leaves a registry without rules alone', () => {
    const free: BlockRegistry = { Hero: block({}), Columns: block({ fields: { children: { type: 'slot' } } }) };
    expect(placementOf(free).unrestricted).toBe(true);
  });

  it('keeps a nested-only block off the top level and out of other slots', () => {
    const p = placementOf(blocks);
    expect(p.topLevel).toEqual(['Hero', 'Logo', 'Menu', 'Columns']);
    expect(p.slots.Menu.children).toContain('MenuItem');
    expect(p.slots.MenuItem.children).toContain('MenuItem');
    expect(p.slots.Columns.children).not.toContain('MenuItem');
  });

  it("turns a slot's own disallow into the allow list", () => {
    expect(placementOf(blocks).slots.Columns.children).toEqual(['Logo', 'Menu', 'Columns']);
  });

  it("offers in a partial only its blocks and what goes inside them", () => {
    const p = placementOf(blocks, ['Logo', 'Menu']);
    expect(p.topLevel).toEqual(['Logo', 'Menu']);
    // Menu takes anything but MenuItem's rule lets it in; Hero and Columns
    // are reachable through the Menu's open slot.
    expect(p.usable).toEqual(['Hero', 'Logo', 'Menu', 'MenuItem', 'Columns']);
  });

  it('hides a nested-only block whose parents cannot be placed', () => {
    const p = placementOf({ ...blocks, Menu: block({}) }, ['Logo']);
    expect(p.usable).toEqual(['Logo']);
  });

  it('names a misspelt block', () => {
    expect(() => placementOf({ ...blocks, MenuItem: block({ allowedIn: ['Meny'] }) })).toThrow(/"Meny"/);
    expect(() => placementOf(blocks, ['Logga'])).toThrow(/"Logga"/);
  });
});
