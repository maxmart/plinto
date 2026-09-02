/**
 * The one reader and the one writer of every document's frontmatter.
 *
 * 156 lines that the editor, the sync engine and the collection form all go
 * through, guarding two data-corruption traps that CLAUDE.md names by name —
 * and until now it had no test of its own. It was covered only sideways, by
 * the 449-document corpus round-trip, which cannot fail on a value no
 * document happens to contain.
 *
 * So the two traps get a test each, by name, first.
 */
import { readFrontmatter, writeFrontmatter } from '../frontmatter';

/** What a document holds after being read, written and read again. */
const roundTrip = (source: string) => {
  const first = readFrontmatter(source);
  const written = writeFrontmatter(first.data, first.body);
  return { written, ...readFrontmatter(written) };
};

const doc = (yaml: string) => `---\n${yaml}\n---\n\nBody text.\n`;

describe('trap 1: an unquoted date is a YAML timestamp', () => {
  it('keeps a date-only value date-only', () => {
    // js-yaml hands back a Date, and String(Date) is
    // "Wed Dec 23 2020 01:00:00 GMT+0100 (…)". A bare re-stringify therefore
    // rewrites every author's date on the first save.
    const { data, written } = roundTrip(doc('date: 2025-12-11'));
    expect(data.date).toBe('2025-12-11');
    expect(written).toContain("date: '2025-12-11'");
    expect(written).not.toMatch(/GMT|T00:00:00/);
  });

  it('keeps the seconds and the Z when a time was given', () => {
    // It used to truncate to minutes, which dropped both — and disagreed with
    // the nested case one level down in the same file, which kept them.
    const { data } = roundTrip(doc('date: 2026-06-01 10:30:45'));
    expect(data.date).toBe('2026-06-01T10:30:45.000Z');
  });

  it('fixes a date nested in a list or a map', () => {
    const { data } = roundTrip(doc('runs:\n  - 2026-05-01\n  - when: 2026-05-02'));
    expect(data.runs).toEqual(['2026-05-01', { when: '2026-05-02' }]);
  });

  it('is a fixpoint: the second save changes nothing', () => {
    const once = roundTrip(doc('date: 2025-12-11'));
    expect(writeFrontmatter(once.data, once.body)).toBe(once.written);
  });
});

describe('trap 2: rev must not become a string', () => {
  it('keeps rev a number', () => {
    // `String()` on rev makes it '1'. syncMetaFromData's `typeof === 'number'`
    // guard then reads that as 0 and restarts the vector clock — every
    // language silently marked never-synced. Two errors used to cancel here:
    // the old writer spelled every scalar bare, so '1' came back a number by
    // accident. The writer quotes what it is given now, so the cast would
    // reach the sync engine intact.
    const { data, written } = roundTrip(doc('rev: 4\nsynced:\n  en: 2'));
    expect(data.rev).toBe(4);
    expect(typeof data.rev).toBe('number');
    expect(written).toContain('rev: 4');
    expect(written).not.toContain("rev: '4'");
  });

  it('keeps the vector clock a map of numbers', () => {
    const { data } = roundTrip(doc('rev: 4\nsynced:\n  en: 2\n  no: 1'));
    expect(data.synced).toEqual({ en: 2, no: 1 });
  });

  it('keeps booleans boolean', () => {
    const { data } = roundTrip(doc('draft: true'));
    expect(data.draft).toBe(true);
  });

  it('quotes a value that only looks like a number, so it reads back as text', () => {
    // The author wrote quotes because they meant the string. YAML 1.1 would
    // read a bare 007 as 7, so the writer has to put the quotes back.
    const { data, written } = roundTrip(doc("code: '007'"));
    expect(data.code).toBe('007');
    expect(written).toContain("code: '007'");
  });
});

describe('what the writer must not reformat', () => {
  it('does not fold a long description onto a second line', () => {
    const long = 'x'.repeat(200);
    const { written, data } = roundTrip(doc(`description: ${long}`));
    expect(data.description).toBe(long);
    expect(written.split('\n').filter(l => l.includes('xxx'))).toHaveLength(1);
  });

  it('keeps a nested map inline rather than exploding it', () => {
    const { written } = roundTrip(doc('rev: 2\nsynced:\n  en: 1'));
    expect(written).toMatch(/synced: \{.*en: 1.*\}/);
  });

  it('writes no block at all for no values', () => {
    expect(writeFrontmatter({}, 'Just a body.\n')).toBe('Just a body.\n');
  });

  it('drops an undefined value instead of writing it', () => {
    expect(writeFrontmatter({ title: 'T', missing: undefined }, 'b')).not.toContain('missing');
  });

  it('keeps null as null, because the writer preserves it', () => {
    // A reader that quietly dropped what the writer keeps is how a save loses
    // a line.
    const { data, written } = roundTrip(doc('cover: null'));
    expect(data.cover).toBeNull();
    expect(written).toContain('cover: null');
  });
});

describe('YAML shapes that used to crash or corrupt', () => {
  it('survives an anchor and an alias without a stack overflow', () => {
    // js-yaml resolves an alias to the *same object* as its anchor, so a
    // cyclic document is genuinely cyclic. Recursion without the seen-map
    // dies on it.
    const source = doc('a: &x\n  self: 1\nb: *x');
    expect(() => roundTrip(source)).not.toThrow();
    const { data } = roundTrip(source);
    expect(data.a).toEqual({ self: 1 });
    expect(data.b).toEqual({ self: 1 });
  });

  it('normalises a date reached through an alias, not just the first copy', () => {
    // Memoised rather than merely visited: returning the raw original for the
    // second occurrence would leave a Date in it — the exact rewrite the
    // seen-map exists to prevent.
    const { data } = roundTrip(doc('a: &d\n  when: 2026-05-01\nb: *d'));
    expect(data.a).toEqual({ when: '2026-05-01' });
    expect(data.b).toEqual({ when: '2026-05-01' });
  });

  it('leaves the body exactly as it found it', () => {
    const body = '\nLine one.\n\n    indented code\n\nLine two.\n';
    const { data } = readFrontmatter(`---\ntitle: T\n---${body}`);
    expect(writeFrontmatter(data, body)).toContain(body);
  });

  it('reads a document with no frontmatter at all', () => {
    const { data, body } = readFrontmatter('Just prose.\n');
    expect(data).toEqual({});
    expect(body).toBe('Just prose.\n');
  });
});
