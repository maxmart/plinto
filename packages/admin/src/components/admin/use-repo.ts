/**
 * The admin's view of the repository, and the five things it can do to one:
 * connect, pull, publish, discard, log out.
 *
 * All of this was inline in AdminPage, interleaved with the content listing
 * and the JSX, which made the component 800 lines and made the repository's
 * actual state machine — cloning, initialized, behind, mid-merge, refusing —
 * something you had to reconstruct by reading past everything else.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { usePlinto } from '../../context';
import { OpsError } from '@plinto/core/ops/errors';
import { remedyFor, UserFacingError } from '@plinto/core/user-error';
import { useConflictPrompt } from '../conflict-prompt';
import type { AdminGitState } from './GitStatusBar';

export interface CloneProgress {
  phase: string;
  loaded: number;
  total: number;
}

/**
 * A failure, and whatever would actually help with it.
 *
 * The two are one fact. Held as separate pieces of state they came apart: a
 * merge-blocked pull left `discard` set, and the next unrelated failure —
 * "No credentials stored. Please reconnect." — rendered with a
 * Discard-all-changes button beside it.
 */
export interface RepoError {
  message: string;
  remedy?: 'discard';
}

/**
 * What to show the user about a failure.
 *
 * `||` rather than a truthiness ladder, at every step: an Error whose message
 * is the empty string is still a failure, and letting it through renders a red
 * box with nothing in it. Something that says less than we would like is
 * better than something that says nothing at all.
 */
function messageOf(err: unknown, fallback: string): string {
  if (err instanceof OpsError) return err.userMessage || fallback;
  if (err instanceof UserFacingError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

export function useRepo() {
  const { dev, settings, ops, agents } = usePlinto();
  const {
    discard: opsDiscard, initRepo: opsInitRepo,
    pull: opsPull, push: opsPush,
    getCommitLog, getSyncState, getRepoInfo,
  } = ops;
  const { resolveConflictsWithClaude } = agents;
  const devMode = dev;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RepoError | null>(null);
  const [status, setStatus] = useState<AdminGitState>({ initialized: false, commitsAhead: 0, commitsBehind: 0 });
  const [needsSetup, setNeedsSetup] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [adminName, setAdminName] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(null);
  const [modifiedPaths, setModifiedPaths] = useState<Set<string>>(new Set());
  const [pulling, setPulling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [mergeResult, setMergeResult] = useState<{ mergedCount: number } | null>(null);
  const [lastPushedSha, setLastPushedSha] = useState<string | undefined>(undefined);
  const [pushCount, setPushCount] = useState(0);
  /**
   * The repository is part-way through a merge nobody finished, so every save
   * will be refused. Read from the repo rather than waited for: the pull that
   * would have surfaced it short-circuits to up_to_date, so the admin was told
   * all was well and the user only found out when a save they had already
   * typed came back rejected.
   */
  const [mergePending, setMergePending] = useState(false);

  const conflict = useConflictPrompt();
  // Both are stable for the life of the hook; naming them keeps them out of
  // the dependency arrays below as the whole `conflict` object, which changes
  // whenever a question appears or goes away.
  const { ask: askConflict, clear: clearConflict } = conflict;

  /**
   * Whether anything can be pushed at all. Dev mode commits through the local
   * git config; the browser needs a token.
   */
  const canPublish = devMode || !!token;

  /**
   * Show a failure, and whatever remedy it names.
   *
   * A UserFacingError can arrive unwrapped — editContent, syncContent and
   * fixContent all reach commitFiles without going through translateError.
   * Reading only OpsError put the generic "Please try again." next to a
   * Discard button with nothing explaining why it was there.
   */
  const report = useCallback((err: unknown, fallback: string) => {
    setError({ message: messageOf(err, fallback), remedy: remedyFor(err) });
  }, []);

  /** Read the repository's current state into `status` and `mergePending`. */
  const readStatus = useCallback(async () => {
    const [info, sync] = await Promise.all([getRepoInfo(), getSyncState()]);
    setMergePending(info.mergePending);
    const next: AdminGitState = {
      initialized: info.initialized,
      repoUrl: info.repoUrl,
      branch: info.branch,
      commitsAhead: sync.commitsAhead,
      commitsBehind: sync.commitsBehind,
    };
    setStatus(next);
    return next;
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCloneProgress(null);

    try {
      const current = await readStatus();

      if (!devMode && !current.initialized) {
        // Credentials from the setup code are enough to clone unattended.
        const storedToken = settings.githubToken();
        const storedRepoUrl = settings.repoUrl();
        if (!storedToken || !storedRepoUrl) {
          setNeedsSetup(true);
          setLoading(false);
          return;
        }
        try {
          await opsInitRepo(storedRepoUrl, storedToken, (phase, loaded, total) =>
            setCloneProgress({ phase, loaded, total }));
          setToken(storedToken);
          await readStatus();
        } catch (err) {
          setError({ message: messageOf(err, 'Failed to clone repository') });
          setCloneProgress(null);
          setLoading(false);
          return;
        }
      }

      setNeedsSetup(false);
    } catch (err) {
      const msg = messageOf(err, 'Failed to load files');
      // Sync metadata can name a commit that is no longer reachable after a
      // history rewrite. Expected, and not the user's problem.
      if (!msg.startsWith('Could not find')) setError({ message: msg });
    } finally {
      setLoading(false);
    }
  }, [devMode, readStatus]);

  useEffect(() => { reload(); }, [reload]);

  // Stored credentials and admin name.
  useEffect(() => {
    setToken(settings.githubToken());
    const storedName = settings.adminName();
    setAdminName(storedName);
    // In browser mode, no stored name means nobody has set this browser up.
    if (!dev && !storedName) setNeedsAuth(true);
  }, []);

  // Which documents sit in unpushed commits — recomputed whenever that count
  // changes (initial load, after a commit, after a push).
  useEffect(() => {
    let cancelled = false;
    const ahead = status.commitsAhead;
    if (!ahead || ahead <= 0) { setModifiedPaths(new Set()); return; }
    (async () => {
      try {
        const commits = await getCommitLog(ahead);
        if (cancelled) return;
        const paths = new Set<string>();
        for (const c of commits) for (const f of c.files) paths.add(f.path);
        setModifiedPaths(paths);
      } catch { if (!cancelled) setModifiedPaths(new Set()); }
    })();
    return () => { cancelled = true; };
  }, [status.commitsAhead]);

  // Re-read when the tab becomes visible or is restored from bfcache — e.g.
  // coming back from the editor. Without it the admin sits on a stale
  // snapshot and Publish is disabled over a commit that already exists.
  useEffect(() => {
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try { await readStatus(); } catch { /* leave state unchanged */ }
      finally { busy = false; }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', refresh);
    };
  }, [readStatus]);

  const pull = useCallback(async () => {
    if (!canPublish) {
      setError({ message: 'No credentials stored. Please reconnect.' });
      return;
    }
    setPulling(true);
    setError(null);
    setMergeResult(null);
    try {
      const result = await opsPull(token ?? '', c =>
        resolveConflictsWithClaude(c, { onQuestion: askConflict }));
      if (result.status === 'merged') {
        setMergeResult({ mergedCount: result.mergedFiles?.length ?? 0 });
        setTimeout(() => setMergeResult(null), 4000);
      }
      await reload();
    } catch (err) {
      report(err, 'Failed to pull. Please try again.');
    } finally {
      setPulling(false);
      clearConflict();
    }
  }, [token, canPublish, reload, report, askConflict, clearConflict]);

  // Auto-pull once, when the repository first turns out to be there.
  const pulledOnLoad = useRef(false);
  useEffect(() => {
    if (status.initialized && status.repoUrl && !devMode && !pulledOnLoad.current) {
      pulledOnLoad.current = true;
      pull();
    }
  }, [status.initialized, status.repoUrl, devMode, pull]);

  // Keep the "behind" badge honest while the tab sits open.
  useEffect(() => {
    if (!status.initialized || !status.repoUrl || devMode) return;
    const interval = setInterval(() => { readStatus().catch(() => {}); }, 60_000);
    return () => clearInterval(interval);
  }, [status.initialized, status.repoUrl, devMode, readStatus]);

  /** Push every local commit. push() pulls first, so this can merge. */
  const publish = useCallback(async () => {
    setPublishing(true);
    setError(null);
    try {
      const hash = await opsPush(token ?? '', c =>
        resolveConflictsWithClaude(c, { onQuestion: askConflict }));
      setLastPushedSha(hash);
      setPushCount(c => c + 1);
      await reload();
      return true;
    } catch (err) {
      report(err, 'Failed to commit. Please try again.');
      return false;
    } finally {
      setPublishing(false);
      clearConflict();
    }
  }, [token, reload, report, askConflict, clearConflict]);

  const connect = useCallback(async (url: string, newToken: string) => {
    setLoading(true);
    setError(null);
    setCloneProgress(null);
    try {
      await opsInitRepo(url, newToken, (phase, loaded, total) =>
        setCloneProgress({ phase, loaded, total }));
      settings.setGithubToken(newToken);
      setToken(newToken);
      await reload();
    } catch (err) {
      setError({ message: messageOf(err, 'Failed to clone repository') });
      setLoading(false);
    }
  }, [reload]);

  const discard = useCallback(async () => {
    if (!confirm('Are you sure you want to discard ALL local changes? This cannot be undone.')) return;
    setError(null);
    try {
      await opsDiscard();
      // reload re-reads it, but clearing here means the banner goes the moment
      // the discard lands rather than after the listing reloads.
      setMergePending(false);
      await reload();
    } catch (err) {
      report(err, 'Failed to discard changes');
    }
  }, [reload, report]);

  const logout = useCallback(() => {
    if (!confirm('Are you sure you want to log out?')) return;
    settings.clear();
    window.location.reload();
  }, []);

  /**
   * Point this browser at a different repository. The browser store restores
   * the remote config from localStorage on the reload that follows.
   */
  const reconnect = useCallback(() => {
    const url = window.prompt('Enter repository URL:', settings.repoUrl() || 'https://github.com/');
    if (!url) return;
    settings.setRepoUrl(url);
    const pat = window.prompt('Enter GitHub token (PAT):');
    if (pat) settings.setGithubToken(pat);
    window.location.reload();
  }, []);

  return {
    devMode, loading, error, status, needsSetup, needsAuth, token, adminName,
    cloneProgress, modifiedPaths, mergePending, mergeResult, pulling, publishing,
    lastPushedSha, pushCount, conflict,
    /** Storage can be read: dev mode always, browser mode once the clone lands. */
    ready: devMode || status.initialized,
    canPublish,
    showError: useCallback((message: string) => setError({ message }), []),
    clearError: useCallback(() => setError(null), []),
    reload, pull, publish, connect, discard, logout, reconnect,
  };
}
