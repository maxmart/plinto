export interface DownloadResult {
  oid: string;
  url: string;
  expiresAt: string;
}

/**
 * One git-lfs action as the batch API returns it. `header` is part of the
 * action, not decoration: the spec says the client must send it with the
 * request. GitHub signs uploads this way — the S3 `href` carries no signature
 * at all (only actor_id, key_id, repo_id), and `Authorization`,
 * `x-amz-content-sha256` and `x-amz-date` travel in `header`. A PUT without
 * them is an unsigned request, and S3 answers 403 AccessDenied.
 */
export interface LfsAction {
  href: string;
  header?: Record<string, string>;
  expires_at?: string;
}

export interface UploadResult {
  oid: string;
  size: number;
  /** Raw URL — uploadBlob handles proxying. */
  uploadUrl: string;
  /** Headers the upload must carry (the storage signature, on GitHub). */
  header: Record<string, string>;
  /**
   * Confirms the upload to the LFS server. GitHub sends one, to
   * lfs.github.com, and the git-lfs client always calls it; absent means the
   * server does not want it.
   */
  verify?: LfsAction;
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
  actions?: Record<string, LfsAction>;
}

/** One git-lfs batch call; returns the objects that carry the wanted action. */
async function batchRequest(
  operation: 'download' | 'upload',
  proxy: string,
  repoUrl: string,
  objects: { oid: string; size: number }[],
  token: string,
): Promise<{ oid: string; action: LfsAction; actions: Record<string, LfsAction> }[]> {
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
      return action ? [{ oid: obj.oid, action, actions: obj.actions! }] : [];
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
  const sizes = new Map(objects.map(o => [o.oid, o.size]));
  return results.map(({ oid, action, actions }) => ({
    oid,
    size: sizes.get(oid) ?? 0,
    uploadUrl: action.href,
    header: action.header ?? {},
    verify: actions.verify,
  }));
}

export async function uploadBlob(
  targetUrl: string,
  proxy: string,
  blob: Blob,
  /** The upload action's `header`, sent as given. */
  header: Record<string, string> = {},
): Promise<void> {
  const url = proxied(proxy, targetUrl);

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...header,
    },
    body: blob,
  });

  if (!resp.ok) {
    throw new Error(`LFS blob upload failed: ${resp.status} ${resp.statusText}`);
  }
}

/**
 * The verify step of the basic transfer: POST {oid, size} to the action's
 * href with its header. Run after uploadBlob succeeds.
 */
export async function verifyUpload(
  action: LfsAction,
  proxy: string,
  object: { oid: string; size: number },
): Promise<void> {
  const resp = await fetch(proxied(proxy, action.href), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.git-lfs+json',
      Accept: 'application/vnd.git-lfs+json',
      ...(action.header ?? {}),
    },
    body: JSON.stringify(object),
  });

  if (!resp.ok) {
    throw new Error(`LFS verify failed: ${resp.status} ${resp.statusText}`);
  }
}
