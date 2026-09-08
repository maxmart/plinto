import 'fake-indexeddb/auto';
import { LfsDb } from '../db';

let db: LfsDb;
beforeEach(() => { db = new LfsDb(`test-${Math.random()}`); });

// --- Pending store ---

describe('pending store', () => {
  it('put + get round-trips a blob', async () => {
    const blob = new Blob(['hello world']);
    await db.putPending('abc123', blob);
    const result = await db.getPending('abc123');
    expect(result).not.toBeNull();
    expect(result!.size).toBe(blob.size);
  });

  it('get returns null for missing oid', async () => {
    const result = await db.getPending('nonexistent');
    expect(result).toBeNull();
  });

  it('listPending returns all entries with sizes', async () => {
    await db.putPending('oid-a', new Blob(['aa']));
    await db.putPending('oid-b', new Blob(['bbb']));
    const list = await db.listPending();
    expect(list).toHaveLength(2);
    const byOid = Object.fromEntries(list.map(e => [e.oid, e.size]));
    expect(byOid['oid-a']).toBe(2);
    expect(byOid['oid-b']).toBe(3);
  });

  it('listPending returns empty array when nothing stored', async () => {
    expect(await db.listPending()).toEqual([]);
  });

  it('clearPending removes all entries', async () => {
    await db.putPending('x', new Blob(['x']));
    await db.putPending('y', new Blob(['y']));
    await db.clearPending();
    expect(await db.listPending()).toHaveLength(0);
    expect(await db.getPending('x')).toBeNull();
  });
});

// --- URL cache ---

describe('url cache', () => {
  it('cacheUrl + getCachedUrl round-trips a URL', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    await db.cacheUrl('sha256:abc', 'https://example.com/file', future);
    const url = await db.getCachedUrl('sha256:abc');
    expect(url).toBe('https://example.com/file');
  });

  it('getCachedUrl returns null for missing oid', async () => {
    expect(await db.getCachedUrl('sha256:missing')).toBeNull();
  });

  it('getCachedUrl returns null for expired entry', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await db.cacheUrl('sha256:expired', 'https://example.com/old', past);
    expect(await db.getCachedUrl('sha256:expired')).toBeNull();
  });

  it('cacheUrl overwrites an existing entry', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    await db.cacheUrl('sha256:oid', 'https://example.com/v1', future);
    await db.cacheUrl('sha256:oid', 'https://example.com/v2', future);
    expect(await db.getCachedUrl('sha256:oid')).toBe('https://example.com/v2');
  });
});
