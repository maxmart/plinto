/**
 * A structural reader for canonical playground MDX, and the minimal-edit
 * rules the translation evals assert with.
 *
 * This is deliberately NOT the editor's parser: the evals live in the engine,
 * which may not import the admin package, and they do not need Puck's data
 * shape — they need to know which top-level blocks a document has, in what
 * order, with what ids, and what bytes each one holds. The playground ships
 * as the generator's own canonical output (col-0 block open/close, indented
 * children, one blank line between blocks), which is what makes a small
 * structural reader honest here.
 *
 * The reader REFUSES anything it cannot classify rather than skipping it —
 * a splitter that silently drops a block it cannot read would hide exactly
 * the losses these evals exist to catch.
 */
import matter from 'gray-matter';

export interface EvalBlock {
  type: string;
  /** The block's own id — the first id="…" in its source. */
  id: string;
  /** The block's exact bytes, col-0 open tag through col-0 close. */
  source: string;
  /** Every id inside the block, its own included (slot children count). */
  ids: string[];
}

export interface EvalDoc {
  /** Parsed frontmatter data (gray-matter). */
  data: Record<string, unknown>;
  /** The import lines, in order, exact bytes. */
  imports: string[];
  /** Top-level blocks, in document order. */
  blocks: EvalBlock[];
  /** Every id in the document, nested ones included. */
  allIds: string[];
}

export function parseEvalDoc(source: string): EvalDoc {
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') throw new Error('eval doc: expected frontmatter to open the document');
  const fmClose = lines.indexOf('---', 1);
  if (fmClose === -1) throw new Error('eval doc: unterminated frontmatter');

  const data = matter(normalized).data as Record<string, unknown>;
  const imports: string[] = [];
  const blocks: EvalBlock[] = [];

  let i = fmClose + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    if (line.startsWith('import ')) { imports.push(line); i++; continue; }

    const open = /^<([A-Z][A-Za-z0-9]*)/.exec(line);
    if (!open) {
      throw new Error(`eval doc: unrecognised top-level line ${i + 1}: ${JSON.stringify(line)}`);
    }
    const type = open[1];

    // Find the col-0 close: '/>' for a self-closing head, '</Type>' for a
    // paired block. Children are indented, so scanning col-0 is safe. A block
    // whose head closes on its own opening line ('<X ... />') is accepted too.
    let end = -1;
    if (/\/>\s*$/.test(line)) {
      end = i;
    } else {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] === '/>' || lines[j] === `</${type}>`) { end = j; break; }
        if (/^<[A-Z]/.test(lines[j])) {
          throw new Error(`eval doc: block <${type}> opened at line ${i + 1} never closes at column 0`);
        }
      }
      if (end === -1) throw new Error(`eval doc: block <${type}> opened at line ${i + 1} never closes`);
    }

    const blockSource = lines.slice(i, end + 1).join('\n');
    const ids = [...blockSource.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    if (ids.length === 0) {
      throw new Error(`eval doc: block <${type}> at line ${i + 1} has no id — cannot be tracked across an edit`);
    }
    blocks.push({ type, id: ids[0], source: blockSource, ids });
    i = end + 1;
  }

  return { data, imports, blocks, allIds: blocks.flatMap(b => b.ids) };
}

/**
 * Reassemble a parsed document, in a chosen top-level order. Only used by the
 * evals' own self-tests to construct "the agent reordered the target" and
 * "the agent dropped a block" outcomes from real corpus bytes.
 */
export function reassemble(original: string, doc: EvalDoc, order: readonly string[]): string {
  const normalized = original.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const fmClose = lines.indexOf('---', 1);
  const head = lines.slice(0, fmClose + 1).join('\n');
  const byId = new Map(doc.blocks.map(b => [b.id, b] as const));
  const body = order.map(id => {
    const block = byId.get(id);
    if (!block) throw new Error(`reassemble: no block ${id}`);
    return block.source;
  });
  return [head, '', doc.imports.join('\n'), '', body.join('\n\n'), ''].join('\n');
}

// ---------------------------------------------------------------------------
// The minimal-edit rules
// ---------------------------------------------------------------------------

export interface MinimalEditInput {
  /** The target locale's file before the sync ran. */
  targetBefore: string;
  /** The target locale's file after the sync saved. */
  targetAfter: string;
  /** The source locale at the revision the target had already incorporated. */
  sourceBase: string;
  /** The source locale now, carrying the edit being synced. */
  sourceCurrent: string;
}

const fmWithoutClocks = (data: Record<string, unknown>): Record<string, unknown> => {
  const { rev: _rev, synced: _synced, ...rest } = data;
  return rest;
};

interface BlockDelta {
  changed: Set<string>;
  added: Set<string>;
  removed: Set<string>;
}

function blockDelta(before: EvalDoc, after: EvalDoc): BlockDelta {
  const b = new Map(before.blocks.map(x => [x.id, x.source] as const));
  const a = new Map(after.blocks.map(x => [x.id, x.source] as const));
  const changed = new Set<string>();
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const [id, src] of b) {
    if (!a.has(id)) removed.add(id);
    else if (a.get(id) !== src) changed.add(id);
  }
  for (const id of a.keys()) if (!b.has(id)) added.add(id);
  return { changed, added, removed };
}

const deltaSize = (d: BlockDelta) => d.changed.size + d.added.size + d.removed.size;

function lcsLen(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

const paragraphs = (blockSource: string): string[] => blockSource.split(/\n[ \t]*\n/);

/** How many paragraph-sized chunks differ between two versions of a block. */
function changedParagraphs(before: string, after: string): number {
  const a = paragraphs(before);
  const b = paragraphs(after);
  return Math.max(a.length, b.length) - lcsLen(a, b);
}

/**
 * The eval's question, as a pure function: given what the source did and what
 * the agent did to the target, was the target's edit surgical? Returns the
 * broken rules, one message each; an empty array is a pass.
 *
 * The rules, spelled out:
 *  1. no more target blocks change than source blocks changed
 *  2. every id present in the target before is still present after
 *  3. a block the target has and the source does not — the drift the agent
 *     must not "fix" — survives byte-identically
 *  4. a block whose source counterpart did not change survives byte-identically
 *  5. the target's own block order is editorial and survives
 *  6. within a legitimately-changed block, no more paragraphs change in the
 *     target than changed in the source (untouched paragraphs stay bytes)
 *  7. frontmatter only changes where the source's changed (clocks aside —
 *     those are ops' business, asserted separately)
 *  8. imports only change when a block was added or removed
 */
export function minimalEditViolations(input: MinimalEditInput): string[] {
  const tB = parseEvalDoc(input.targetBefore);
  const tA = parseEvalDoc(input.targetAfter);
  const sB = parseEvalDoc(input.sourceBase);
  const sC = parseEvalDoc(input.sourceCurrent);

  const sourceDelta = blockDelta(sB, sC);
  const targetDelta = blockDelta(tB, tA);
  const violations: string[] = [];

  // 1. block-change budget
  if (deltaSize(targetDelta) > deltaSize(sourceDelta)) {
    violations.push(
      `more blocks changed in the target (${deltaSize(targetDelta)}: ` +
      `${[...targetDelta.changed, ...targetDelta.added, ...targetDelta.removed].join(', ')}) ` +
      `than in the source (${deltaSize(sourceDelta)})`,
    );
  }

  // 2. id survival, nested ids included
  const afterIds = new Set(tA.allIds);
  for (const id of tB.allIds) {
    if (!afterIds.has(id)) violations.push(`block id lost from the target: ${id}`);
  }

  // 3 + 4. blocks with no business changing must not move a byte
  const sourceIds = new Set(sC.blocks.map(b => b.id));
  for (const id of targetDelta.changed) {
    if (!sourceIds.has(id)) {
      violations.push(`target-only block rewritten: ${id} (the target's own drift is not the agent's to fix)`);
    } else if (!sourceDelta.changed.has(id)) {
      violations.push(`block ${id} changed in the target though its source did not change`);
    }
  }

  // 5. order
  const surviving = tB.blocks.map(b => b.id).filter(id => tA.blocks.some(a => a.id === id));
  const afterOrder = tA.blocks.map(b => b.id).filter(id => surviving.includes(id));
  if (surviving.join('\n') !== afterOrder.join('\n')) {
    violations.push(`the target's block order changed: ${surviving.join(', ')} → ${afterOrder.join(', ')}`);
  }

  // 6. paragraph budget inside legitimately-changed blocks
  for (const id of targetDelta.changed) {
    if (!sourceDelta.changed.has(id)) continue; // already reported above
    const budget = changedParagraphs(
      sB.blocks.find(b => b.id === id)!.source,
      sC.blocks.find(b => b.id === id)!.source,
    );
    const spent = changedParagraphs(
      tB.blocks.find(b => b.id === id)!.source,
      tA.blocks.find(b => b.id === id)!.source,
    );
    if (spent > budget) {
      violations.push(`block ${id}: ${spent} paragraphs changed in the target where the source changed ${budget}`);
    }
  }

  // 7. frontmatter
  const sFmB = fmWithoutClocks(sB.data);
  const sFmC = fmWithoutClocks(sC.data);
  const tFmB = fmWithoutClocks(tB.data);
  const tFmA = fmWithoutClocks(tA.data);
  const sourceFmChanged = new Set(
    [...new Set([...Object.keys(sFmB), ...Object.keys(sFmC)])]
      .filter(k => JSON.stringify(sFmB[k]) !== JSON.stringify(sFmC[k])),
  );
  for (const key of new Set([...Object.keys(tFmB), ...Object.keys(tFmA)])) {
    if (JSON.stringify(tFmB[key]) !== JSON.stringify(tFmA[key]) && !sourceFmChanged.has(key)) {
      violations.push(`frontmatter key changed in the target without a source change: ${key}`);
    }
  }

  // 8. imports
  if (targetDelta.added.size === 0 && targetDelta.removed.size === 0
      && tB.imports.join('\n') !== tA.imports.join('\n')) {
    violations.push('imports changed though no block was added or removed');
  }

  return violations;
}

/**
 * The creation counterpart: a locale-only page translated into existence.
 * Structure is copied from the source — same blocks, same ids, same order,
 * same imports, same layout — and only the words are the agent's.
 */
export function creationViolations(source: string, created: string): string[] {
  const s = parseEvalDoc(source);
  const c = parseEvalDoc(created);
  const violations: string[] = [];

  const sIds = s.blocks.map(b => `${b.type}#${b.id}`);
  const cIds = c.blocks.map(b => `${b.type}#${b.id}`);
  if (sIds.join('\n') !== cIds.join('\n')) {
    violations.push(`created page's blocks differ from the source's: [${sIds.join(', ')}] → [${cIds.join(', ')}]`);
  }
  if (s.imports.join('\n') !== c.imports.join('\n')) {
    violations.push('created page\'s imports differ from the source\'s');
  }
  if (JSON.stringify(s.data.layout) !== JSON.stringify(c.data.layout)) {
    violations.push(`created page's layout differs: ${JSON.stringify(c.data.layout)}`);
  }
  return violations;
}
