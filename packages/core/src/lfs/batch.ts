export interface DownloadResult {
  oid: string;
  url: string;
  expiresAt: string;
}

export interface UploadResult {
  oid: string;
  uploadUrl: string;
}

function batchUrl(proxyUrl: string, repoUrl: string): string {
  const url = new URL(repoUrl);
  return `${proxyUrl}/${url.host}${url.pathname}/info/lfs/objects/batch`;
}

function proxied(proxy: string, targetUrl: string): string {
  const url = new URL(targetUrl);
  return `${proxy}/${url.host}${url.pathname}${url.search}`;
}

function authHeader(token: string): string {
  return 'Basic ' + btoa(`x-access-token:${token}`);
}

interface BatchObject {
  oid: string;
  actions?: Record<string, { href: string; expires_at?: string }>;
}

/** One git-lfs batch call; returns the objects that carry the wanted action. */
async function batchRequest(
  operation: 'download' | 'upload',
  proxy: string,
  repoUrl: string,
  objects: { oid: string; size: number }[],
  token: string,
): Promise<{ oid: string; action: { href: string; expires_at?: string } }[]> {
  const resp = await fetch(batchUrl(proxy, repoUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.git-lfs+json',
      Accept: 'application/vnd.git-lfs+json',
      Authorization: authHeader(token),
    },
    body: JSON.stringify({ operation, transfers: ['basic'], objects }),
  });

  if (!resp.ok) {
    throw new Error(`LFS batch ${operation} failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  return ((data.objects ?? []) as BatchObject[])
    .flatMap(obj => {
      const action = obj.actions?.[operation];
      return action ? [{ oid: obj.oid, action }] : [];
    });
}

export async function batchDownload(
  proxy: string,
  repoUrl: string,
  objects: { oid: string; size: number }[],
  token: string,
): Promise<DownloadResult[]> {
  const results = await batchRequest('download', proxy, repoUrl, objects, token);
  return results.map(({ oid, action }) => ({
    oid,
    url: proxied(proxy, action.href),
    expiresAt: action.expires_at ?? new Date(Date.now() + 3600 * 1000).toISOString(),
  }));
}

export async function batchUpload(
  proxy: string,
  repoUrl: string,
  objects: { oid: string; size: number }[],
  token: string,
): Promise<UploadResult[]> {
  const results = await batchRequest('upload', proxy, repoUrl, objects, token);
  // Raw URL — uploadBlob handles proxying.
  return results.map(({ oid, action }) => ({ oid, uploadUrl: action.href }));
}

export async function uploadBlob(
  targetUrl: string,
  proxy: string,
  blob: Blob,
): Promise<void> {
  const url = proxied(proxy, targetUrl);

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: blob,
  });

  if (!resp.ok) {
    throw new Error(`LFS blob upload failed: ${resp.status} ${resp.statusText}`);
  }
}
