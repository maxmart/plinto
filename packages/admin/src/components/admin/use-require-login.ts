import { useEffect } from 'react';
import { usePlinto } from '../../context';

/**
 * The editor pages have no login form of their own; the admin page does. A
 * browser-mode editor page opened without a login — a bookmark, a new tab, a
 * reload — goes there, and the admin brings them back here once they have
 * one. Dev mode needs no login and is left alone.
 */
export function useRequireLogin(): void {
  const { dev, settings } = usePlinto();
  const needed = !dev && !settings.githubToken();
  useEffect(() => {
    if (!needed) return;
    const here = window.location.pathname + window.location.search;
    // replace, not assign: the page without a login should not be a history
    // entry the back button returns to, only to be sent away again.
    window.location.replace(`/plinto/admin/?next=${encodeURIComponent(here)}`);
  }, [needed]);
}
