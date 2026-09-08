/**
 * The one thing the storage layer needs to know about GitHub: how to read an
 * owner and repo out of a clone URL.
 *
 * Everything else GitHub-shaped — workflow runs, Pages URLs, deployment
 * status — is the admin's, and lives with it.
 */

/**
 * Parse a GitHub repository URL into owner and repo.
 * Supports HTTPS and SSH formats.
 */
export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/owner/repo(.git)  SSH: git@github.com:owner/repo(.git)
  // Repo names may contain dots ("my.site"), so only a trailing ".git" is
  // stripped rather than cutting at the first dot.
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}
