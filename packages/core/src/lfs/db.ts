export class LfsDb {
  private dbPromise: Promise<IDBDatabase>;

  constructor(name: string) {
    this.dbPromise = this.open(name);
  }

  private open(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending');
        if (!db.objectStoreNames.contains('urls')) db.createObjectStore('urls');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const req = fn(transaction.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }

  // Pending store
  async putPending(oid: string, blob: Blob): Promise<void> { await this.tx('pending', 'readwrite', s => s.put(blob, oid)); }
  async getPending(oid: string): Promise<Blob | null> { return (await this.tx<Blob | undefined>('pending', 'readonly', s => s.get(oid))) ?? null; }

  async listPending(): Promise<{ oid: string; size: number }[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending', 'readonly');
      const cursor = tx.objectStore('pending').openCursor();
      const entries: { oid: string; size: number }[] = [];
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) { entries.push({ oid: c.key as string, size: (c.value as Blob).size }); c.continue(); }
        else resolve(entries);
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }

  async clearPending(): Promise<void> { await this.tx('pending', 'readwrite', s => s.clear()); }

  // URL cache
  async cacheUrl(oid: string, url: string, expiresAt: string): Promise<void> {
    await this.tx('urls', 'readwrite', s => s.put({ url, expiresAt }, oid));
  }

  async getCachedUrl(oid: string): Promise<string | null> {
    const result = await this.tx<{ url: string; expiresAt: string } | undefined>('urls', 'readonly', s => s.get(oid));
    if (!result) return null;
    if (new Date(result.expiresAt) <= new Date()) {
      // Evict expired entry
      this.tx('urls', 'readwrite', s => s.delete(oid)).catch(() => {});
      return null;
    }
    return result.url;
  }
}
