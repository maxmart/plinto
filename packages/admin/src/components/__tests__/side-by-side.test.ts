import { describe, it, expect } from 'vitest';
import { sideBySide, foldUnchanged } from '../side-by-side';

describe('sideBySide', () => {
  it('pairs a replaced line with its replacement', () => {
    const rows = sideBySide('a\nb\nc\n', 'a\nB\nc\n');
    expect(rows).toEqual([
      { kind: 'same', left: { num: 1, text: 'a' }, right: { num: 1, text: 'a' } },
      { kind: 'change', left: { num: 2, text: 'b' }, right: { num: 2, text: 'B' } },
      { kind: 'same', left: { num: 3, text: 'c' }, right: { num: 3, text: 'c' } },
    ]);
  });

  it('leaves blanks where one side has more lines', () => {
    const rows = sideBySide('a\nz\n', 'a\nx\ny\nz\n');
    expect(rows.map(r => r.kind === 'gap' ? null : [r.left?.num ?? null, r.right?.num ?? null])).toEqual([
      [1, 1], [null, 2], [null, 3], [2, 4],
    ]);
  });

  it('shows a new file as all added', () => {
    const rows = sideBySide('', 'x\ny\n');
    expect(rows.every(r => r.kind === 'change' && r.left === null)).toBe(true);
    expect(rows).toHaveLength(2);
  });
});

describe('foldUnchanged', () => {
  it('folds a long unchanged stretch but keeps context around the change', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n') + '\n';
    const after = before.replace('l10\n', 'L10\n');
    const folded = foldUnchanged(sideBySide(before, after), 2);
    expect(folded.map(r => r.kind)).toEqual(['gap', 'same', 'same', 'change', 'same', 'same', 'gap']);
    expect(folded[0].kind === 'gap' && folded[0].count).toBe(8);
  });
});
