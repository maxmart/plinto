import { webcrypto } from 'crypto';
if (!globalThis.crypto?.subtle) {
  (globalThis as any).crypto = webcrypto;
}

import { sha256 } from '../hash';

describe('sha256', () => {
  it('hashes an empty blob correctly', async () => {
    const result = await sha256(new Blob([]));
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes "hello world" correctly', async () => {
    const result = await sha256(new Blob(['hello world']));
    expect(result).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('returns a 64-character hex string', async () => {
    const result = await sha256(new Blob(['test data']));
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different content', async () => {
    const hash1 = await sha256(new Blob(['content a']));
    const hash2 = await sha256(new Blob(['content b']));
    expect(hash1).not.toBe(hash2);
  });
});
