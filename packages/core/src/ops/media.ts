/**
 * Media operations. On disk (and in git) a media file is a git-LFS pointer;
 * the real bytes live in LFS. Dev mode leans on the developer's git-lfs
 * binary; browser mode writes pointers by hand, parks the bytes in an
 * IndexedDB pending store until push uploads them, and resolves pointers to
 * blob or CDN URLs for display.
 */

import type { Stores } from '../storage';
import type { Settings } from '../settings';
import type { ResolvedConfig } from '../resolved-config';
import { lookupMime } from '../storage/file-store/mime';
import { isLfsPointer, parsePointer, formatPointer } from '../lfs/pointer';
import { sha256 } from '../lfs/hash';
import { batchDownload } from '../lfs/batch';
import { LfsDb } from '../lfs/db';

export interface MediaFile {
  name: string;
  path: string;     // e.g. "media/foo.png" — relative URL without leading slash
  url: string;      // resolved via fileStore.getMediaUrl (may be a blob: URL in browser mode)
  size: number;
  mimeType: string;
  /** Last modified, ms since epoch. What "newest first" sorts on. */
  mtime: number;
}

export interface MediaOpsDeps {
  config: ResolvedConfig;
  stores: Stores;
  settings: Settings;
}

/** The media operations, bound to one site's configuration and storage. */
export function createMediaOps({ config, stores, settings }: MediaOpsDeps) {

  let _lfsDb: LfsDb | null = null;
  function getLfsDb(): LfsDb {
    if (!_lfsDb) _lfsDb = new LfsDb(config.storage.lfsDbName);
    return _lfsDb;
  }

  // Memoize blob URLs for pending LFS blobs to avoid createObjectURL leaks
  const _pendingBlobUrls = new Map<string, string>();

  const LFS_GITATTRIBUTES_LINE = 'public/media/** filter=lfs diff=lfs merge=lfs -text';

  async function ensureLfsGitattributes(): Promise<void> {
    const fileStore = await stores.getFileStore();
    let gitattributes = '';
    try {
      gitattributes = await fileStore.readFile('.gitattributes');
    } catch {
      // doesn't exist
    }
    if (!gitattributes.includes(LFS_GITATTRIBUTES_LINE)) {
      const newContent = gitattributes
        ? `${gitattributes.trimEnd()}\n${LFS_GITATTRIBUTES_LINE}\n`
        : `${LFS_GITATTRIBUTES_LINE}\n`;
      await fileStore.writeFile('.gitattributes', newContent);
      const gitStore = await stores.getGitStore();
      await gitStore.commitFiles('Add LFS tracking for media', ['.gitattributes']);
    }
  }

  /**
   * Media files in the library, or in one subfolder of it.
   *
   * `folder` scopes both the listing and — via MediaBrowser — where an upload
   * lands, which is what lets a picker offer just the icons instead of every
   * photo on the site. Directories are skipped rather than walked: a folder is
   * something you point at, not something the flat list quietly absorbs.
   */
  async function listMedia(folder = ''): Promise<MediaFile[]> {
    const fileStore = await stores.getFileStore();
    const dir = folder ? `${config.content.mediaDir}/${folder}` : config.content.mediaDir;
    // A folder nobody has uploaded to yet simply has nothing in it — readDir's
    // contract returns [] for a missing directory, in both stores.
    const entries = await fileStore.readDir(dir);
    const files: MediaFile[] = [];
    for (const entry of entries) {
      if (entry.type !== 'file') continue;
      if (entry.name.startsWith('.') || entry.name === '.gitkeep') continue;
      const rel = folder ? `${folder}/${entry.name}` : entry.name;
      const clientPath = `${config.content.mediaDir.split('/').slice(1).join('/')}/${rel}`;

      // Media files are stored as LFS pointer files on disk. The pointer's
      // embedded `size` field is the real media size; `entry.size` is only
      // the pointer file size (~130 B). Parse the pointer to get both the
      // correct size and a working blob URL via `getMediaUrl` (which knows
      // how to resolve pending LFS blobs).
      let size = entry.size;
      let url: string;
      try {
        const text = await fileStore.readFile(`${dir}/${entry.name}`);
        if (isLfsPointer(text)) {
          size = parsePointer(text).size;
          url = await getMediaUrl(clientPath);
        } else {
          url = await fileStore.getMediaUrl(clientPath);
        }
      } catch {
        url = await fileStore.getMediaUrl(clientPath);
      }

      files.push({
        name: entry.name,
        path: clientPath,
        url,
        size,
        mimeType: lookupMime(entry.name),
        mtime: entry.mtime,
      });
    }
    // Newest first: you upload a file in order to use it, so it should be the one
    // you land on. Sorted by name, a new upload disappeared into the middle of
    // the grid under whatever letter it happened to start with.
    //
    // Caveat worth knowing: a fresh clone stamps every file with its checkout
    // time, so on a machine that has just cloned the repo this ordering says
    // nothing until something is uploaded.
    return files.sort((a, b) => b.mtime - a.mtime);
  }

  async function writeMedia(path: string, data: Uint8Array, mimeType: string): Promise<void> {
    const fileStore = await stores.getFileStore();
    const gitStore = await stores.getGitStore();

    // Ensure .gitattributes has LFS line
    await ensureLfsGitattributes();

    // Dev mode writes into the real working tree and commits through the real
    // git binary (see routes/api/git.ts, which shells out to `git add`), so
    // git-lfs's own clean filter turns the file into a pointer at stage time.
    // Writing the pointer ourselves here left the developer's disk holding 130
    // bytes of text where the image should be: the media browser still looked
    // right, because getMediaUrl resolves pointers via the pending store, while
    // the dev server served that text to every <img> on the site.
    if (stores.dev) {
      await fileStore.writeFile(`public/${path}`, data);
      await gitStore.commitFiles(`Add media ${path}`, [`public/${path}`]);
      return;
    }

    // Browser mode has no git-lfs binary, so the pointer has to be written by
    // hand and the bytes parked in the pending store until push uploads them.

    // Compute hash and store blob in pending store
    const blob = new Blob([new Uint8Array(data).buffer as ArrayBuffer], { type: mimeType });
    const oid = await sha256(blob);
    const db = getLfsDb();
    await db.putPending(oid, blob);

    // Write LFS pointer to LightningFS (not the actual binary)
    const pointer = formatPointer(oid, data.byteLength);
    await fileStore.writeFile(`public/${path}`, pointer);

    // Commit the pointer file
    await gitStore.commitFiles(`Add media ${path}`, [`public/${path}`]);
  }

  async function deleteMedia(path: string): Promise<void> {
    const fileStore = await stores.getFileStore();
    const gitStore = await stores.getGitStore();
    await fileStore.deleteFile(`public/${path}`);
    await gitStore.commitFiles(`Delete media ${path}`, [`public/${path}`]);
  }

  async function getMediaUrl(path: string): Promise<string> {
    const fileStore = await stores.getFileStore();
    const filePath = path.startsWith('/') ? path.slice(1) : path;

    // Read the file content
    let fileContent: string;
    try {
      fileContent = await fileStore.readFile(`public/${filePath}`);
    } catch {
      return path; // fallback
    }

    // Not an LFS pointer — use existing behavior
    if (!isLfsPointer(fileContent)) {
      return fileStore.getMediaUrl(path);
    }

    const { oid, size } = parsePointer(fileContent);
    const db = getLfsDb();

    // 1. Check pending store (unpushed uploads) — memoize blob URL to avoid leaks
    if (_pendingBlobUrls.has(oid)) return _pendingBlobUrls.get(oid)!;
    const pendingBlob = await db.getPending(oid);
    if (pendingBlob) {
      const blobUrl = URL.createObjectURL(pendingBlob);
      _pendingBlobUrls.set(oid, blobUrl);
      return blobUrl;
    }

    // 2. Check URL cache
    const cachedUrl = await db.getCachedUrl(oid);
    if (cachedUrl) return cachedUrl;

    // 3. Fetch from LFS batch API
    const repoUrl = settings.repoUrl();
    const token = settings.githubToken();
    const proxyUrl = settings.proxyUrl() || config.git.corsProxy;

    if (!repoUrl || !token) return path;

    const results = await batchDownload(proxyUrl, repoUrl, [{ oid, size }], token);
    if (results.length > 0) {
      const { url, expiresAt } = results[0];
      await db.cacheUrl(oid, url, expiresAt);
      return url;
    }

    return path; // fallback
  }

  return {
    getLfsDb,
    listMedia,
    writeMedia,
    deleteMedia,
    getMediaUrl,
  };
}
