/**
 * Two versions of a file as aligned rows, for an old-left / new-right view.
 *
 * A removed run followed by an added run is a change, and its lines are
 * paired across the two sides so a translated sentence sits next to the
 * sentence it replaced; whichever run is longer leaves blanks on the other
 * side. Long stretches of unchanged lines fold into a gap, leaving
 * `context` lines around each change.
 */
import { diffLines } from 'diff';

export interface Line {
  num: number;
  text: string;
}

export type Row =
  | { kind: 'same'; left: Line; right: Line }
  | { kind: 'change'; left: Line | null; right: Line | null }
  | { kind: 'gap'; count: number; rows: Row[] };

function lines(value: string): string[] {
  const out = value.split('\n');
  if (out[out.length - 1] === '') out.pop();
  return out;
}

export function sideBySide(before: string, after: string): Row[] {
  const rows: Row[] = [];
  let l = 1;
  let r = 1;
  let removed: string[] = [];

  const flushRemoved = (added: string[]) => {
    const n = Math.max(removed.length, added.length);
    for (let i = 0; i < n; i++) {
      rows.push({
        kind: 'change',
        left: i < removed.length ? { num: l++, text: removed[i] } : null,
        right: i < added.length ? { num: r++, text: added[i] } : null,
      });
    }
    removed = [];
  };

  for (const part of diffLines(before, after)) {
    const text = lines(part.value);
    if (part.removed) {
      removed.push(...text);
    } else if (part.added) {
      flushRemoved(text);
    } else {
      flushRemoved([]);
      for (const t of text) rows.push({ kind: 'same', left: { num: l++, text: t }, right: { num: r++, text: t } });
    }
  }
  flushRemoved([]);
  return rows;
}

/** Fold runs of unchanged rows longer than `2 * context + 1`. */
export function foldUnchanged(rows: Row[], context = 3): Row[] {
  const out: Row[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'same') { out.push(rows[i++]); continue; }
    let j = i;
    while (j < rows.length && rows[j].kind === 'same') j++;
    const head = i === 0 ? 0 : context;
    const tail = j === rows.length ? 0 : context;
    if (j - i > head + tail + 1) {
      out.push(...rows.slice(i, i + head));
      const hidden = rows.slice(i + head, j - tail);
      out.push({ kind: 'gap', count: hidden.length, rows: hidden });
      out.push(...rows.slice(j - tail, j));
    } else {
      out.push(...rows.slice(i, j));
    }
    i = j;
  }
  return out;
}
