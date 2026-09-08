/**
 * Where a document is *served* — the site's URL rules, bound to its config.
 *
 * The counterpart to `@plinto/core`'s `layout.ts`, which says where a document
 * *lives*. That split is the boundary between the engine and this adapter:
 * a file path is storage and belongs to the engine; a URL is routing and
 * belongs to whatever generates the site. These two functions were in core,
 * which made its README's "what is not here: routing, URLs" untrue.
 *
 * `localeDir` is re-exported rather than moved: the URL segment and the
 * directory segment being the same string *is* Astro's i18n model, and it is
 * stated once, in the engine, because the file layout needs it too.
 *
 * Published as `@plinto/astro/lib/urls` — a site's language switcher is built
 * from `localizedPath`, and the preview button reads `localeDir`.
 */
import { localeDir as coreLocaleDir } from '@plinto/core';
import { config } from './site-config';

const localeDir = (lang: string) => coreLocaleDir(config, lang);
import { trailingSlash } from 'virtual:plinto-config';

export { localeDir };

/**
 * The same page in another language: the current URL with its locale segment
 * swapped for the target's.
 *
 * The primitive a language switcher is built from — plinto supplies the rule
 * (which is the same one that decides where a page's file lives), the site
 * supplies the markup. Paths keep their trailing slash if they had one, so
 * the result matches the site's `trailingSlash` setting either way.
 *
 *   localizedPath('/sv/support/', 'en')  ->  '/en/support/'
 *   localizedPath('/sv/', 'en')          ->  '/en/'
 *   // with an unprefixed default locale 'en':
 *   localizedPath('/sv/support/', 'en')  ->  '/support/'
 */
export function localizedPath(pathname: string, lang: string): string {
  const segments = pathname.split('/').filter(Boolean);
  // Drop a leading locale segment if there is one; what remains is the page.
  const rest = config.i18n.locales.includes(segments[0]) ? segments.slice(1) : segments;
  const dir = localeDir(lang);
  const parts = dir ? [dir, ...rest] : rest;
  const trailing = pathname.endsWith('/') || parts.length === 0 ? '/' : '';
  return `/${parts.join('/')}${trailing}`;
}

/**
 * The site path a page is served at — the inverse of the pages directory
 * layout, which is also Astro's routing. Partials have no URL of their own and
 * collection entries are not routed, so this only accepts `page/…`.
 *
 * The trailing slash comes from the site's own `trailingSlash` setting, read
 * off Astro's config like everything else about routing. It used to be the
 * caller's problem, and the two callers disagreed: the admin's View link
 * appended one and the preview's Exit did not, so leaving a preview on a
 * `trailingSlash: 'always'` site went through a redirect.
 */
export function toPageHref(contentPath: string, lang: string): string {
  const slug = contentPath.replace(/^page\/?/, '');
  const dir = localeDir(lang);
  const path = dir ? (slug ? `/${dir}/${slug}` : `/${dir}`) : (slug ? `/${slug}` : '/');
  if (path === '/' || trailingSlash !== 'always') return path;
  return `${path}/`;
}
