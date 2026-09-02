import matter from 'gray-matter';
import { readFrontmatter, writeFrontmatter } from './frontmatter';
import type { SyncMeta } from '@obelum/core';
export type { SyncMeta };

// ---------------------------------------------------------------------------
// parseSyncMeta
// ---------------------------------------------------------------------------

/**
 * The sync metadata in already-parsed frontmatter data, defensively typed:
 * anything that is not a number (a hand-edited file, a legacy shape) reads
 * as absent rather than corrupting the vector clock.
 */
export function syncMetaFromData(data: Record<string, unknown>): SyncMeta {
  const rev = typeof data.rev === 'number' ? data.rev : 0;
  const synced =
    typeof data.synced === 'object' && data.synced !== null && !Array.isArray(data.synced)
      ? Object.fromEntries(
          Object.entries(data.synced).filter(([, v]) => typeof v === 'number'),
        ) as Record<string, number>
      : {};
  return { rev, synced };
}

/**
 * Parse rev and synced vector clock from MDX frontmatter.
 * Returns { rev: 0, synced: {} } for legacy files or files with no frontmatter.
 * The legacy `base` field is ignored.
 */
export function parseSyncMeta(mdxContent: string): SyncMeta {
  return syncMetaFromData(matter(mdxContent).data);
}

// ---------------------------------------------------------------------------
// setSyncMeta
// ---------------------------------------------------------------------------

/**
 * Write rev and synced vector clock into MDX frontmatter, preserving all other
 * fields.  Strips the legacy `base` field if present.
 *
 * - If frontmatter exists, rev and synced are updated in-place (or appended).
 * - If there is no frontmatter at all, one is created at the top of the file.
 *
 * Handles both \n and \r\n line endings.  The output preserves the input's
 * line ending style so existing files are not unnecessarily dirtied.
 */
export function setSyncMeta(
  mdxContent: string,
  rev: number,
  synced: Record<string, number>,
): string {
  const { data, body } = readFrontmatter(mdxContent);

  // `base` is the shape this metadata had before vector clocks; a document
  // still carrying one loses it here rather than keeping a field nothing
  // reads.
  delete data.base;
  data.rev = rev;
  data.synced = synced;

  const written = writeFrontmatter(data, body);

  // The writer emits LF. A document that arrived with CRLF frontmatter keeps
  // it, so syncing a file does not also rewrite every line ending in it.
  return mdxContent.startsWith('---\r\n') ? written.replace(/\r?\n/g, '\r\n') : written;
}

// ---------------------------------------------------------------------------
// stripSyncMetadataLines
// ---------------------------------------------------------------------------

/**
 * Filter out rev, base (legacy), and synced vector clock lines from an array
 * of frontmatter lines.
 *
 * The `synced` key is a YAML block scalar — strip the `synced:` line AND any
 * immediately following indented lines that are its children.
 */
export function stripSyncMetadataLines(lines: string[]): string[] {
  const result: string[] = [];
  let inSyncedBlock = false;

  for (const line of lines) {
    // Detect start of synced block
    if (/^synced:\s*/.test(line)) {
      inSyncedBlock = true;
      continue;
    }

    // If we're inside a synced block, skip indented lines
    if (inSyncedBlock) {
      if (/^[ \t]/.test(line)) {
        continue;
      }
      // Non-indented line ends the block
      inSyncedBlock = false;
    }

    // Strip rev and legacy base lines (exact key match)
    if (/^rev:\s/.test(line) || /^base:\s/.test(line)) {
      continue;
    }

    result.push(line);
  }

  return result;
}

