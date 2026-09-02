import { batchDownload, batchUpload, uploadBlob } from '../batch';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const PROXY = 'https://cors.example.com';
const REPO_URL = 'https://github.com/owner/repo.git';
const TOKEN = 'ghp_testtoken';
const OID = 'a'.repeat(64);

beforeEach(() => mockFetch.mockReset());

describe('batchDownload', () => {
  it('POSTs to the correct proxied batch URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ objects: [] }),
    });

    await batchDownload(PROXY, REPO_URL, [{ oid: OID, size: 100 }], TOKEN);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://cors.example.com/github.com/owner/repo.git/info/lfs/objects/batch',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends correct headers and operation', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ objects: [] }),
    });

    await batchDownload(PROXY, REPO_URL, [{ oid: OID, size: 100 }], TOKEN);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/vnd.git-lfs+json');
    expect(options.headers['Accept']).toBe('application/vnd.git-lfs+json');
    expect(options.headers['Authorization']).toBe(
      'Basic ' + btoa('x-access-token:ghp_testtoken'),
    );

    const body = JSON.parse(options.body);
    expect(body.operation).toBe('download');
    expect(body.objects).toEqual([{ oid: OID, size: 100 }]);
  });

  it('parses download results and proxies the URL', async () => {
    const expiresAt = '2026-04-04T12:00:00Z';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: [
          {
            oid: OID,
            actions: {
              download: {
                href: 'https://storage.example.com/objects/abc?token=xyz',
                expires_at: expiresAt,
              },
            },
          },
        ],
      }),
    });

    const results = await batchDownload(PROXY, REPO_URL, [{ oid: OID, size: 100 }], TOKEN);

    expect(results).toHaveLength(1);
    expect(results[0].oid).toBe(OID);
    expect(results[0].url).toBe(
      'https://cors.example.com/storage.example.com/objects/abc?token=xyz',
    );
    expect(results[0].expiresAt).toBe(expiresAt);
  });

  it('skips objects without download actions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: [
          { oid: OID, actions: {} },
          { oid: 'b'.repeat(64), actions: { upload: { href: 'https://storage.example.com/upload' } } },
        ],
      }),
    });

    const results = await batchDownload(PROXY, REPO_URL, [{ oid: OID, size: 100 }], TOKEN);

    expect(results).toHaveLength(0);
  });

  it('defaults expiresAt to ~1 hour if not provided', async () => {
    const before = Date.now();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: [
          {
            oid: OID,
            actions: {
              download: { href: 'https://storage.example.com/objects/abc' },
            },
          },
        ],
      }),
    });

    const results = await batchDownload(PROXY, REPO_URL, [{ oid: OID, size: 100 }], TOKEN);
    const after = Date.now();

    const expiresMs = new Date(results[0].expiresAt).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });

    await expect(
      batchDownload(PROXY, REPO_URL, [{ oid: OID, size: 100 }], TOKEN),
    ).rejects.toThrow('LFS batch download failed: 403 Forbidden');
  });
});

describe('batchUpload', () => {
  it('POSTs to the correct proxied batch URL with operation upload', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ objects: [] }),
    });

    await batchUpload(PROXY, REPO_URL, [{ oid: OID, size: 200 }], TOKEN);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://cors.example.com/github.com/owner/repo.git/info/lfs/objects/batch',
    );
    const body = JSON.parse(options.body);
    expect(body.operation).toBe('upload');
  });

  it('parses upload results and returns raw upload URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: [
          {
            oid: OID,
            actions: {
              upload: { href: 'https://storage.example.com/upload/abc' },
            },
          },
        ],
      }),
    });

    const results = await batchUpload(PROXY, REPO_URL, [{ oid: OID, size: 200 }], TOKEN);

    expect(results).toHaveLength(1);
    expect(results[0].oid).toBe(OID);
    // Raw URL — uploadBlob handles proxying
    expect(results[0].uploadUrl).toBe('https://storage.example.com/upload/abc');
  });

  it('skips objects without upload actions (already on server)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: [
          { oid: OID, actions: {} },
          { oid: 'b'.repeat(64) },
        ],
      }),
    });

    const results = await batchUpload(PROXY, REPO_URL, [{ oid: OID, size: 200 }], TOKEN);

    expect(results).toHaveLength(0);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });

    await expect(
      batchUpload(PROXY, REPO_URL, [{ oid: OID, size: 200 }], TOKEN),
    ).rejects.toThrow('LFS batch upload failed: 401 Unauthorized');
  });
});

describe('uploadBlob', () => {
  it('PUTs the blob through the proxy URL', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const blob = new Blob(['binary data'], { type: 'application/octet-stream' });
    await uploadBlob('https://storage.example.com/upload/abc', PROXY, blob);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://cors.example.com/storage.example.com/upload/abc');
    expect(options.method).toBe('PUT');
    expect(options.headers['Content-Type']).toBe('application/octet-stream');
    expect(options.body).toBe(blob);
  });

  it('proxies query string parameters in the upload URL', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const blob = new Blob(['data']);
    await uploadBlob('https://storage.example.com/upload?sig=abc123', PROXY, blob);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://cors.example.com/storage.example.com/upload?sig=abc123');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const blob = new Blob(['data']);
    await expect(
      uploadBlob('https://storage.example.com/upload/abc', PROXY, blob),
    ).rejects.toThrow('LFS blob upload failed: 500 Internal Server Error');
  });
});
