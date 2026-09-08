/**
 * The five things a browser-mode editor keeps between visits: who they are,
 * their GitHub token, their Claude key, the repository, and a CORS proxy
 * override.
 *
 * One object with named methods, not a key constant plus a `localStorage` call
 * at every site. This module used to open by claiming localStorage was "read
 * and written in one place" while seventeen raw calls lived in six other
 * files — the claim was the whole point of it and it was not true, so a reader
 * checking one place was checking the wrong one.
 *
 * An object rather than free functions because the storage layer takes it as a
 * parameter: `Settings` is the port, and this localStorage implementation is
 * the browser's answer to it. Nothing below the adapter reaches for
 * `localStorage` itself.
 *
 * Everything here is optional by construction: dev mode runs against the real
 * working tree and needs none of it. Every getter tolerates a missing
 * `localStorage`, because the git store's author lookup runs during a build too.
 */

/** What the storage layer needs to remember between visits. */
export interface Settings {
  /** The name commits are authored under, or '' before setup. */
  adminName(): string;
  setAdminName(name: string): void;
  /**
   * The stored GitHub PAT, or null. There is exactly one token; the username
   * side of GitHub's basic auth is always the literal 'x-access-token'.
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
  /** Remove every setting the library ever stored — the logout. */
  clear(): void;
}

/**
 * The localStorage-backed settings for one site.
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

  const read = (key: string): string =>
    typeof localStorage !== 'undefined' ? localStorage.getItem(key) ?? '' : '';
  const write = (key: string, value: string): void => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  };

  return {
    adminName: () => read(keys.adminName),
    setAdminName: name => write(keys.adminName, name),
    githubToken: () => read(keys.githubToken) || null,
    setGithubToken: token => write(keys.githubToken, token),
    apiKey: () => read(keys.apiKey),
    setApiKey: key => write(keys.apiKey, key),
    repoUrl: () => read(keys.repoUrl),
    setRepoUrl: url => write(keys.repoUrl, url),
    proxyUrl: () => read(keys.proxyUrl),
    clear: () => {
      if (typeof localStorage === 'undefined') return;
      for (const key of Object.values(keys)) localStorage.removeItem(key);
    },
  };
}
