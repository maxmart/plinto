
import { usePlinto } from '../../context';
export interface AdminGitState {
  initialized: boolean;
  repoUrl?: string;
  branch?: string;
  commitsAhead: number;
  commitsBehind: number;
}

/** The dark bar across the top of the admin: repo, branch, sync state, Publish. */
export function GitStatusBar({
  status,
  onPull,
  onPublish,
  onReconnect,
  onLogout,
  adminName,
  pulling,
  merging,
  mergeResult,
}: {
  status: AdminGitState;
  onPull: () => void;
  onPublish: () => void;
  onReconnect: () => void;
  onLogout?: () => void;
  adminName?: string;
  pulling?: boolean;
  merging?: boolean;
  mergeResult?: { mergedCount: number } | null;
}) {
  const { dev } = usePlinto();
  const devMode = dev;
  if (!status.initialized) return null;

  const hasRemote = !!status.repoUrl;

  return (
    <div className="bg-gray-800 text-white px-4 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center gap-4">
        {hasRemote ? (
          <span className="text-gray-400">
            {status.repoUrl?.replace('https://github.com/', '').replace('.git', '')}
          </span>
        ) : (
          <button
            onClick={onReconnect}
            className="text-amber-400 hover:text-amber-300 underline"
          >
            Local repo (no remote) — tap to reconnect
          </button>
        )}
        <span className="px-2 py-0.5 bg-gray-700 rounded text-xs">
          {status.branch}
        </span>
        {devMode && (
          <span className="px-2 py-0.5 bg-amber-600 rounded text-xs font-medium">
            Dev Mode
          </span>
        )}
        {adminName && (
          <span className="text-gray-400 text-xs">
            {adminName}
          </span>
        )}
        {!devMode && (status.commitsAhead ?? 0) > 0 && (
          <span className="px-2 py-0.5 bg-blue-600 rounded text-xs">
            {status.commitsAhead} unpublished change{status.commitsAhead !== 1 ? 's' : ''}
          </span>
        )}
        {!devMode && (status.commitsBehind ?? 0) > 0 && (
          <span className="px-2 py-0.5 bg-purple-600 rounded text-xs">
            {status.commitsBehind} update{status.commitsBehind !== 1 ? 's' : ''} available
          </span>
        )}
        {pulling && (
          <span className="px-2 py-0.5 bg-blue-700 rounded text-xs animate-pulse">
            {merging ? 'Merging…' : 'Pulling…'}
          </span>
        )}
        {!pulling && mergeResult && (
          <span className="px-2 py-0.5 bg-green-700 rounded text-xs">
            Merged {mergeResult.mergedCount} file{mergeResult.mergedCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {!devMode && hasRemote && (
          <button
            onClick={onPull}
            disabled={pulling}
            className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-50"
          >
            {pulling ? 'Pulling...' : 'Pull'}
          </button>
        )}
        {!devMode && hasRemote && (
          <button
            onClick={onPublish}
            disabled={!(status.commitsAhead && status.commitsAhead > 0) || pulling}
            className="px-3 py-1 bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {`Publish${status.commitsAhead ? ` (${status.commitsAhead})` : ''}`}
          </button>
        )}
        {onLogout && (
          <button
            onClick={onLogout}
            className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-gray-300"
            title="Log out"
          >
            Log out
          </button>
        )}
      </div>
    </div>
  );
}
