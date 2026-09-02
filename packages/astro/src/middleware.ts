/**
 * The passthrough middleware Astro's `i18n.routing: 'manual'` requires.
 *
 * Manual mode exists here to switch Astro's built-in i18n enforcement OFF:
 * its routers 404 any URL outside the locale tree, which is exactly where
 * plinto's injected /plinto/* admin and /api/plinto/* routes live. The locale
 * config itself (locales, defaultLocale) stays fully in force — this
 * middleware just declines to police URLs, which file-based routing already
 * defines completely.
 *
 * Astro requires this to be the site's own file, so each site re-exports it:
 *   export { onRequest } from '@plinto/astro/middleware';
 */
import type { MiddlewareHandler } from 'astro';

export const onRequest: MiddlewareHandler = (_context, next) => next();
