import { batchDownload, batchUpload, uploadBlob, verifyUpload } from '../batch';

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

/**
 * The shape GitHub actually returns for an upload, as of 2026-09: the S3 href
 * carries no signature (only actor_id, key_id, repo_id) — it travels in the
 * action's header — and a verify action points at lfs.github.com. A PUT
 * without that header is unsigned and S3 answers 403 AccessDenied, which is
 * what an editor saw when publishing an image.
 */
const S3_HREF = `https://github-cloud.s3.amazonaws.com/alambic/media/1/aa/bb/${OID}?actor_id=1&key_id=0&repo_id=2`;
const GITHUB_UPLOAD = {
  href: S3_HREF,
  header: {
    Authorization:
      'AWS4-HMAC-SHA256 Credential=AKIA/20260930/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=abc',
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-amz-date': '20260930T120000Z',
  },
  expires_at: '2026-09-30T13:00:00Z',
};
const GITHUB_VERIFY = {
  href: 'https://lfs.github.com/owner/repo/objects/verify',
  header: { Authorization: 'RemoteAuth verifytoken', Accept: 'application/vnd.git-lfs+json' },
};

describe('the upload action header (GitHub)', () => {
  it('batchUpload keeps the upload header, the size and the verify action', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: [{ oid: OID, size: 200, actions: { upload: GITHUB_UPLOAD, verify: GITHUB_VERIFY } }],
      }),
    });

    const [result] = await batchUpload(PROXY, REPO_URL, [{ oid: OID, size: 200 }], TOKEN);

    expect(result.uploadUrl).toBe(S3_HREF);
    expect(result.header).toEqual(GITHUB_UPLOAD.header);
    expect(result.size).toBe(200);
    expect(result.verify).toEqual(GITHUB_VERIFY);
  });

  it('an action without a header yields an empty one, and no verify', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: [{ oid: OID, actions: { upload: { href: 'https://storage.example.com/upload/abc' } } }],
      }),
    });

    const [result] = await batchUpload(PROXY, REPO_URL, [{ oid: OID, size: 200 }], TOKEN);

    expect(result.header).toEqual({});
    expect(result.verify).toBeUndefined();
  });

  it('uploadBlob sends the action header with the PUT', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await uploadBlob(S3_HREF, PROXY, new Blob(['x']), GITHUB_UPLOAD.header);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `https://cors.example.com/github-cloud.s3.amazonaws.com/alambic/media/1/aa/bb/${OID}?actor_id=1&key_id=0&repo_id=2`,
    );
    expect(options.headers).toEqual({
      'Content-Type': 'application/octet-stream',
      ...GITHUB_UPLOAD.header,
    });
  });

  it('a Content-Type in the action header wins over the default', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await uploadBlob('https://storage.example.com/u', PROXY, new Blob(['x']), { 'Content-Type': 'image/webp' });

    expect(mockFetch.mock.calls[0][1].headers['Content-Type']).toBe('image/webp');
  });
});

describe('verifyUpload', () => {
  it('POSTs {oid, size} to the proxied verify href with its header', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await verifyUpload(GITHUB_VERIFY, PROXY, { oid: OID, size: 200 });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://cors.example.com/lfs.github.com/owner/repo/objects/verify');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('RemoteAuth verifytoken');
    expect(options.headers['Content-Type']).toBe('application/vnd.git-lfs+json');
    expect(JSON.parse(options.body)).toEqual({ oid: OID, size: 200 });
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });

    await expect(verifyUpload(GITHUB_VERIFY, PROXY, { oid: OID, size: 200 }))
      .rejects.toThrow('LFS verify failed: 404 Not Found');
  });
});
