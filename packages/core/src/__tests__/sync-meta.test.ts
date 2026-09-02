import {
  parseSyncMeta,
  setSyncMeta,
  stripSyncMetadataLines,
} from '../sync-meta';

// ---------------------------------------------------------------------------
// parseSyncMeta
// ---------------------------------------------------------------------------

describe('parseSyncMeta', () => {
  it('parses rev and synced from full frontmatter', () => {
    const mdx = `---
title: Hello
rev: 3
synced:
  sv: 3
  no: 2
---
Content here.
`;
    expect(parseSyncMeta(mdx)).toEqual({ rev: 3, synced: { sv: 3, no: 2 } });
  });

  it('defaults synced to {} when only rev is present', () => {
    const mdx = `---
rev: 5
---
Content.
`;
    expect(parseSyncMeta(mdx)).toEqual({ rev: 5, synced: {} });
  });

  it('defaults rev to 0 and synced to {} for legacy file with base field', () => {
    const mdx = `---
title: Legacy
rev: 2
base: abc123
---
Content.
`;
    // base is ignored; rev is still read; synced defaults to {}
    expect(parseSyncMeta(mdx)).toEqual({ rev: 2, synced: {} });
  });

  it('defaults to {rev:0, synced:{}} when there is no frontmatter', () => {
    const mdx = `<Hero id="a" title="No frontmatter" />\n`;
    expect(parseSyncMeta(mdx)).toEqual({ rev: 0, synced: {} });
  });

  it('defaults to {rev:0, synced:{}} for completely empty file', () => {
    expect(parseSyncMeta('')).toEqual({ rev: 0, synced: {} });
  });

  it('handles CRLF line endings', () => {
    const mdx = '---\r\nrev: 7\r\nsynced:\r\n  en: 7\r\n---\r\nContent.\r\n';
    expect(parseSyncMeta(mdx)).toEqual({ rev: 7, synced: { en: 7 } });
  });
});

// ---------------------------------------------------------------------------
// setSyncMeta
// ---------------------------------------------------------------------------

describe('setSyncMeta', () => {
  it('updates rev and synced in existing frontmatter', () => {
    const mdx = `---
title: Page
rev: 1
synced:
  sv: 1
---
Body.
`;
    const result = setSyncMeta(mdx, 4, { sv: 4, no: 3 });
    const { rev, synced } = parseSyncMeta(result);
    expect(rev).toBe(4);
    expect(synced).toEqual({ sv: 4, no: 3 });
    // Other fields preserved
    expect(result).toMatch(/title: Page/);
  });

  it('adds rev and synced when frontmatter exists but lacks them', () => {
    const mdx = `---
title: Bare
---
Body.
`;
    const result = setSyncMeta(mdx, 2, { sv: 2 });
    const { rev, synced } = parseSyncMeta(result);
    expect(rev).toBe(2);
    expect(synced).toEqual({ sv: 2 });
    expect(result).toMatch(/title: Bare/);
  });

  it('creates frontmatter when none exists', () => {
    const mdx = `<Hero id="h1" title="No FM" />\n`;
    const result = setSyncMeta(mdx, 1, { sv: 1 });
    const { rev, synced } = parseSyncMeta(result);
    expect(rev).toBe(1);
    expect(synced).toEqual({ sv: 1 });
    // Original content still present
    expect(result).toMatch(/Hero/);
  });

  it('strips legacy base field', () => {
    const mdx = `---
title: Legacy
rev: 1
base: deadbeef
---
Body.
`;
    const result = setSyncMeta(mdx, 2, { sv: 2 });
    expect(result).not.toMatch(/base:/);
    const { rev, synced } = parseSyncMeta(result);
    expect(rev).toBe(2);
    expect(synced).toEqual({ sv: 2 });
  });

  it('handles CRLF line endings without corrupting them', () => {
    const mdx = '---\r\ntitle: CRLF\r\nrev: 0\r\n---\r\nBody.\r\n';
    const result = setSyncMeta(mdx, 3, { sv: 3 });
    // Output should still use CRLF before the first ---
    expect(result.startsWith('---\r\n')).toBe(true);
    const { rev, synced } = parseSyncMeta(result);
    expect(rev).toBe(3);
    expect(synced).toEqual({ sv: 3 });
  });

  it('writes empty synced map as empty object', () => {
    const mdx = `---\nrev: 0\n---\nBody.\n`;
    const result = setSyncMeta(mdx, 0, {});
    const { synced } = parseSyncMeta(result);
    expect(synced).toEqual({});
  });

  it('leaves the body byte-identical', () => {
    // Stamping a revision must not reformat the document it stamps. The body
    // holds blocks, blank lines and indentation the editor cares about to the
    // character.
    const body = `<CmColumns id="c">\n  <CmColumn id="c1">\n\n    Text with  spacing.\n\n  </CmColumn>\n</CmColumns>\n`;
    const result = setSyncMeta(`---\ntitle: Page\n---\n${body}`, 2, { sv: 2 });
    expect(result.endsWith(body)).toBe(true);
  });

  it('does not turn an unquoted date into a UTC timestamp', () => {
    // gray-matter parses `date: 2025-12-11` into a Date, and a naive
    // re-stringify writes it back as 2025-12-11T00:00:00.000Z. Syncing a page
    // must not silently redefine when it was published.
    const result = setSyncMeta('---\ndate: 2025-12-11\n---\nBody.\n', 1, { sv: 1 });
    expect(result).toContain('2025-12-11');
    expect(result).not.toContain('T00:00:00');
  });

  it('handles frontmatter that is present but empty', () => {
    const result = setSyncMeta('---\n---\nBody.\n', 1, { sv: 1 });
    const { rev, synced } = parseSyncMeta(result);
    expect(rev).toBe(1);
    expect(synced).toEqual({ sv: 1 });
    expect(result).toContain('Body.');
    // and not two frontmatter blocks, which the old regex was one edge case
    // away from producing
    expect(result.match(/^---$/gm)?.length).toBe(2);
  });

  it('is idempotent', () => {
    const once = setSyncMeta('---\ntitle: Page\n---\nBody.\n', 3, { sv: 3, no: 2 });
    expect(setSyncMeta(once, 3, { sv: 3, no: 2 })).toBe(once);
  });

  it('preserves a rev of 0 rather than dropping it', () => {
    const result = setSyncMeta('---\ntitle: New\n---\nBody.\n', 0, {});
    expect(parseSyncMeta(result).rev).toBe(0);
    expect(result).toMatch(/rev: 0/);
  });
});

// ---------------------------------------------------------------------------
// stripSyncMetadataLines
// ---------------------------------------------------------------------------

describe('stripSyncMetadataLines', () => {
  it('strips rev line', () => {
    const lines = ['title: Hello', 'rev: 3', 'body content'];
    expect(stripSyncMetadataLines(lines)).toEqual(['title: Hello', 'body content']);
  });

  it('strips base line (legacy)', () => {
    const lines = ['title: Hello', 'base: abc123', 'body content'];
    expect(stripSyncMetadataLines(lines)).toEqual(['title: Hello', 'body content']);
  });

  it('strips synced block (synced: line and indented children)', () => {
    const lines = [
      'title: Hello',
      'synced:',
      '  sv: 3',
      '  no: 2',
      'body content',
    ];
    expect(stripSyncMetadataLines(lines)).toEqual(['title: Hello', 'body content']);
  });

  it('strips all three when all present', () => {
    const lines = [
      'title: X',
      'rev: 5',
      'base: deadbeef',
      'synced:',
      '  en: 5',
      'description: Y',
    ];
    expect(stripSyncMetadataLines(lines)).toEqual(['title: X', 'description: Y']);
  });

  it('does not strip unrelated lines that happen to start with similar text', () => {
    const lines = ['revised: text', 'database: value', 'synced_at: 2024'];
    expect(stripSyncMetadataLines(lines)).toEqual(['revised: text', 'database: value', 'synced_at: 2024']);
  });
});

