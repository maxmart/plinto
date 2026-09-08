/**
 * Buffer polyfill for browser environments. Vite (unlike webpack) doesn't
 * polyfill it, and two dependencies need the global: isomorphic-git, and
 * gray-matter (whose to-file.js calls Buffer.from unguarded) — which makes
 * every frontmatter parse in the browser depend on this. Imported by the
 * storage layer, the choke point all of those paths go through.
 */
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}
