/**
 * Where each block may go, in one document.
 *
 * Two rules feed it. A block's `allowedIn` names the blocks it may sit inside
 * (a MenuItem only in a Menu or a MenuItem). A partial's `blocks` lists what
 * its top level may hold (a top bar takes a Logo and a Menu). From those,
 * every slot gets the list of blocks it accepts, the top level gets its own,
 * and the editor's block list offers only blocks that fit somewhere in the
 * document being edited — so a top bar's editor does not offer a hero, and a
 * page's does not offer a menu item until there is a menu to put it in.
 *
 * The lists are Puck's own slot `allow`, so Puck enforces them on every drop.
 */
import type { BlockRegistry } from './registry';

export interface Placement {
  /** The blocks the document's top level accepts. */
  topLevel: string[];
  /** Block name → slot field → the blocks that slot accepts. */
  slots: Record<string, Record<string, string[]>>;
  /** Every block that fits somewhere in the document, top level or nested. */
  usable: string[];
  /** Nothing narrows anything, so Puck's defaults can stand untouched. */
  unrestricted: boolean;
}

export function placementOf(blocks: BlockRegistry, topLevelBlocks?: readonly string[]): Placement {
  const names = Object.keys(blocks);
  const allowedIn = (name: string): string[] | undefined => blocks[name]?.config?.allowedIn;

  // A misspelt name would silently mean "nowhere", which reads as a bug in
  // the editor rather than in the config. Said once, at load.
  const unknown = (list: readonly string[]) => list.filter(n => !(n in blocks));
  for (const name of names) {
    const bad = unknown(allowedIn(name) ?? []);
    if (bad.length) {
      throw new Error(`[plinto] ${name}.allowedIn names ${bad.map(b => `"${b}"`).join(', ')}, which is not a block.`);
    }
  }
  if (topLevelBlocks) {
    const bad = unknown(topLevelBlocks);
    if (bad.length) {
      throw new Error(`[plinto] content.partialBlocks names ${bad.map(b => `"${b}"`).join(', ')}, which is not a block.`);
    }
  }

  const canGoIn = (child: string, parent: string) => {
    const rule = allowedIn(child);
    return !rule || rule.includes(parent);
  };

  const topLevel = (topLevelBlocks ?? names).filter(n => !allowedIn(n));

  const slots: Placement['slots'] = {};
  let narrowed = topLevel.length !== names.length;
  for (const parent of names) {
    const fields = (blocks[parent].config?.fields ?? {}) as Record<string, { type?: string; allow?: string[]; disallow?: string[] }>;
    for (const [key, field] of Object.entries(fields)) {
      if (field?.type !== 'slot') continue;
      const accepted = (field.allow ?? names)
        .filter(n => !(field.disallow ?? []).includes(n))
        .filter(n => n in blocks && canGoIn(n, parent));
      (slots[parent] ??= {})[key] = accepted;
      if (accepted.length !== names.length) narrowed = true;
    }
  }

  // What can be reached: the top level, then whatever the slots of anything
  // reachable accept.
  const usable = new Set(topLevel);
  const queue = [...topLevel];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const accepted of Object.values(slots[parent] ?? {})) {
      for (const child of accepted) {
        if (!usable.has(child)) { usable.add(child); queue.push(child); }
      }
    }
  }

  return {
    topLevel,
    slots,
    usable: names.filter(n => usable.has(n)),
    unrestricted: !narrowed,
  };
}
