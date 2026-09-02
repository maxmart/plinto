/**
 * Client-safe MIME type lookup. Used by browser-mode file-store code where
 * importing Node's `mime-types` package pulls in `path.extname` and crashes
 * in the browser bundle.
 *
 * The map covers the extensions Plinto actually touches (MDX, images, video,
 * common text files). Server-side code (routes/api/_shared.ts, node file
 * store) uses the full `mime-types` package.
 */

const MIME_MAP: Record<string, string> = {
  // Text content
  mdx: 'text/markdown; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  // Docs
  pdf: 'application/pdf',
};

/**
 * Look up a MIME type by filename or path. Falls back to
 * application/octet-stream for unknown or missing extensions.
 */
export function lookupMime(filePath: string): string {
  // Strip query string/hash if present, then grab everything after the
  // last dot. Lowercase for case-insensitive match. No `path` module.
  const cleaned = filePath.split(/[?#]/)[0];
  const dotIdx = cleaned.lastIndexOf('.');
  if (dotIdx === -1 || dotIdx === cleaned.length - 1) {
    return 'application/octet-stream';
  }
  const ext = cleaned.slice(dotIdx + 1).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}
