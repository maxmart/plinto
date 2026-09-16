/**
 * The five things a browser-mode editor keeps: who they are, their GitHub
 * token, their Claude key, the repository, and a CORS proxy override.
 *
 * The two secrets live in memory, for one page load. Nothing on disk holds
 * them, so a script on a public page of the same site — reached by the View
 * button, the back button, or a typed URL — has nothing to read, and closing
 * the tab is the logout. The price is a login per tab, and after a reload,
 * which a password manager pays.
 *
 * The admin is several documents, though, and the editor's Back link is a
 * real navigation. So a secret can be *carried* across exactly one hop: the
 * departing page writes it to `sessionStorage` and the arriving page takes it
 * back out, on construction, before anything else runs. It sits there only
 * for the duration of the navigation, and only for navigations the admin
 * itself makes to its own pages; a navigation anywhere else leaves nothing
 * behind. Every place that moves between admin pages goes through the admin's
 * `nav`, which is what does the carrying.
 *
 * The other three are not secrets and stay in `localStorage`, which is what
 * makes that login a single autofilled form. Anything a build before this one
 * stored there under the secret keys is removed on first use.
 *
 * One object with named methods, not a key constant plus a storage call at
 * every site. This module used to open by claiming localStorage was "read
 * and written in one place" while seventeen raw calls lived in six other
 * files — the claim was the whole point of it and it was not true, so a reader
 * checking one place was checking the wrong one.
 *
 * An object rather than free functions because the storage layer takes it as a
 * parameter: `Settings` is the port, and this implementation is the browser's
 * answer to it. Nothing below the adapter reaches for web storage itself.
 *
 * Everything here is optional by construction: dev mode runs against the real
 * working tree and needs none of it. Every getter tolerates missing storage,
 * because the git store's author lookup runs during a build too.
 */

/** What the storage layer needs to remember. */
export interface Settings {
  /** The name commits are authored under, or '' before setup. */
  adminName(): string;
  setAdminName(name: string): void;
  /**
   * The GitHub PAT for this page, or null. There is exactly one token; the
   * username side of GitHub's basic auth is always the literal 'x-access-token'.
   */
  githubToken(): string | null;
  setGithubToken(token: string): void;
  /** The Claude key the translation and merge agents run on, or ''. */
  apiKey(): string;
  setApiKey(key: string): void;
  /** The repository this browser has cloned, or is about to. */
  repoUrl(): string;
  setRepoUrl(url: string): void;
  /** A per-browser override for the configured CORS proxy. Usually ''. */
  proxyUrl(): string;
  /**
   * Hand the secrets to the next admin page in this tab. Call it immediately
   * before a navigation or reload to another admin page, and never before
   * anything else: what it writes is picked up, and removed, by whichever
   * admin page loads next.
   */
  carry(): void;
  /** Remove every setting the library ever stored — the logout. */
  clear(): void;
}

/**
 * The settings for one site in this browser.
 *
 * Keyed by the site's `storageKey`, which only matters when two plinto sites
 * share an origin — in practice local dev serving several sites from
 * localhost, where one site's clone must not clobber another's.
 */
export function createSettings(keyPrefix: string): Settings {
  const keys = {
    adminName: `${keyPrefix}-admin-name`,
    githubToken: `${keyPrefix}-github-token`,
    apiKey: `${keyPrefix}-api-key`,
    repoUrl: `${keyPrefix}-repo-url`,
    proxyUrl: `${keyPrefix}-proxy-url`,
  };
  const secretKeys = [keys.githubToken, keys.apiKey] as const;

  // Looked up on every call, never captured: tests stub the globals after
  // the settings object exists, and a build has no window at all.
  const local = (): Storage | null =>
    typeof localStorage === 'undefined' ? null : localStorage;
  const session = (): Storage | null =>
    typeof sessionStorage === 'undefined' ? null : sessionStorage;

  const read = (store: Storage | null, key: string): string => store?.getItem(key) ?? '';
  const write = (store: Storage | null, key: string, value: string): void => {
    store?.setItem(key, value);
  };

  // The secrets. Seeded from a carry left by the page before this one, which
  // is consumed here so it outlives no navigation but the one it was for.
  const secrets = new Map<string, string>();
  for (const key of secretKeys) {
    const carried = read(session(), key);
    session()?.removeItem(key);
    if (carried) secrets.set(key, carried);
    // Builds before this one persisted the secrets. Drop them the first time
    // a newer build runs, so an upgrade is also a cleanup.
    local()?.removeItem(key);
  }

  return {
    adminName: () => read(local(), keys.adminName),
    setAdminName: name => write(local(), keys.adminName, name),
    githubToken: () => secrets.get(keys.githubToken) || null,
    setGithubToken: token => { secrets.set(keys.githubToken, token); },
    apiKey: () => secrets.get(keys.apiKey) ?? '',
    setApiKey: key => { secrets.set(keys.apiKey, key); },
    repoUrl: () => read(local(), keys.repoUrl),
    setRepoUrl: url => write(local(), keys.repoUrl, url),
    proxyUrl: () => read(local(), keys.proxyUrl),
    carry: () => {
      for (const key of secretKeys) {
        const value = secrets.get(key);
        if (value) write(session(), key, value);
      }
    },
    clear: () => {
      secrets.clear();
      for (const key of Object.values(keys)) local()?.removeItem(key);
      for (const key of secretKeys) session()?.removeItem(key);
    },
  };
}
