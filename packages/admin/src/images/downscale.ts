/**
 * Bounding an upload before it enters the repository.
 *
 * The build-time ladder shrinks what a visitor downloads, but it cannot touch
 * what is stored: media is committed to Git LFS, and LFS history is immutable.
 * A 12 MP phone photo dropped into a news article is ~6 MB in the repository
 * for the life of the repository, and there is no later build that undoes it.
 * So the original has to be bounded at the moment it enters, which is here.
 *
 * Runs in the browser in both modes — the MediaBrowser is the same component in
 * dev and in the deployed editor — so it uses `createImageBitmap` and a canvas
 * rather than anything node-side.
 *
 */

/** Longest edge an upload may keep; anything larger is downscaled to this. */
const MAX_SOURCE_EDGE = 2560;
/** Files at or below this byte size skip re-encoding entirely. */
const MAX_SOURCE_BYTES = 300 * 1024;
/** WebP quality for re-encoded uploads, 0–100. */
const WEBP_QUALITY = 80;

export interface NormalisedUpload {
  data: Uint8Array;
  /** Matches `data` — WebP when re-encoded, the file's own type when not. */
  mimeType: string;
  /**
   * Extension matches whatever `data` actually is. The stored path is the
   * string a block references, so a `.png` holding WebP bytes would be a file
   * that works today and confuses every tool that reads the name later.
   */
  fileName: string;
  /** True when the bytes below are not the bytes that were picked. */
  reencoded: boolean;
  originalBytes: number;
}

/** Formats left strictly alone. SVG is resolution-independent, so rasterising
 *  it would be a straight downgrade; GIF is frequently animated and a canvas
 *  would silently keep only the first frame. */
const PASS_THROUGH = /^image\/(svg\+xml|gif)$/i;

const asIs = async (file: File, fileName: string): Promise<NormalisedUpload> => ({
  data: new Uint8Array(await file.arrayBuffer()),
  mimeType: file.type,
  fileName,
  reencoded: false,
  originalBytes: file.size,
});

/**
 * The bytes to store for a picked file: downscaled and re-encoded to WebP where
 * that is worth doing, the original otherwise.
 *
 * Every failure path returns the original. Losing an upload, or storing
 * something a browser cannot decode, is far worse than storing a large file —
 * the large file is merely expensive, and the build ladder still fixes delivery.
 *
 * @param fileName the safe name already derived from the picked file
 */
export async function normaliseUpload(file: File, fileName: string): Promise<NormalisedUpload> {
  if (!file.type.startsWith('image/') || PASS_THROUGH.test(file.type)) {
    return asIs(file, fileName);
  }

  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);

    // Already within both budgets: re-encoding would spend quality to save
    // nothing. A 200 KB 1600px JPEG is a perfectly good original, and the build
    // ladder will serve it at card size regardless.
    if (longest <= MAX_SOURCE_EDGE && file.size <= MAX_SOURCE_BYTES) {
      bitmap.close?.();
      return asIs(file, fileName);
    }

    const scale = Math.min(1, MAX_SOURCE_EDGE / longest);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const blob = await encodeWebp(bitmap, width, height);
    bitmap.close?.();

    // A browser without WebP encoding quietly hands back a PNG instead, which
    // for a photograph is usually larger than what was picked.
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) {
      return asIs(file, fileName);
    }

    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      mimeType: 'image/webp',
      fileName: fileName.replace(/\.[^./]+$/, '') + '.webp',
      reencoded: true,
      originalBytes: file.size,
    };
  } catch {
    // Undecodable, canvas tainted, out of memory — store what was picked.
    return asIs(file, fileName);
  }
}

/**
 * Draw onto a transparent canvas and encode. Transparency is never filled: the
 * media directory is full of logos with alpha, and WebP carries an alpha
 * channel, so flattening onto white would be a visible regression on exactly
 * the images that need it most.
 */
async function encodeWebp(bitmap: ImageBitmap, width: number, height: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY / 100 });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY / 100));
}
