/**
 * Collapse `.` and `..` segments in a slash-separated path, textually.
 *
 * The browser stores join siteSubdir onto site-relative paths before handing
 * them to lightning-fs and isomorphic-git, and site-relative paths may climb
 * with `../` (shared collections live outside the site directory). Neither
 * lightning-fs nor iso-git resolves dot segments, so the join has to.
 *
 * Leading `..` that would escape the root is an error — nothing above the
 * repo clone exists in lightning-fs, so a path that still points there after
 * collapsing is a config mistake worth surfacing, not resolving.
 */
export function collapseDots(p: string): string {
  const absolute = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0 || out[out.length - 1] === '..') {
        throw new Error(`Path escapes the repository root: ${p}`);
      }
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return (absolute ? '/' : '') + out.join('/');
}
