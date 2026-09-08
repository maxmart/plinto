/**
 * The preview shell's hooks, for a site's own `previewPath` module.
 *
 * The shell itself lives in @plinto/admin — it is React, and the editor draws
 * it. Published here as `@plinto/astro/preview` so a site keeps importing one
 * path, and because a site's shell module is named by the plinto() config,
 * which is this adapter's.
 */
export { usePartial, usePageMeta, PreviewShell } from '@plinto/admin/preview.tsx';
export type { ShellContext } from '@plinto/admin/preview.tsx';
