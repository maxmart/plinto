/**
 * Puck finds blocks by `props.id`. A hand-written page has none, and every
 * block then rendered as the page's last one, silently (asewerner-site, #2).
 * The editor's parse mints the missing ids; a plain parse leaves them alone.
 */
import { parseMdx } from '../parser';

type Block = { type: string; props: { id?: string; children?: Block[] | string } };

const page = `import { Hero, Columns, Column } from '@/components';

<Hero title="One" />

<Hero id="intro" title="Two" />

<Hero id="intro" title="Three" />

<Columns>
  <Column title="A" />
  <Column title="B" />
</Columns>
`;

const blocks = (ensureIds: boolean) =>
  parseMdx(page, { richtext: false, ensureIds }).data.content as unknown as Block[];

describe('ensureIds', () => {
  it('gives every block, slot children included, a unique id', () => {
    const content = blocks(true);
    const all = [...content, ...(content[3].props.children as Block[])];
    const ids = all.map(b => b.props.id);
    expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mints ids in Puck's Type-uuid shape", () => {
    expect(blocks(true)[0].props.id).toMatch(/^Hero-[0-9a-f-]{36}$/);
  });

  it('keeps an existing id and renames only its duplicate', () => {
    const content = blocks(true);
    expect(content[1].props.id).toBe('intro');
    expect(content[2].props.id).not.toBe('intro');
  });

  it('is off unless asked for', () => {
    expect(blocks(false)[0].props.id).toBeUndefined();
  });
});
