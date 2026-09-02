import { useState } from 'react';
import { usePlinto } from '../../context';

/** Connect Repository form: the browser-mode first-run clone. */
export function ConnectRepoForm({
  onConnect,
  loading,
  progress,
  error,
}: {
  onConnect: (url: string, token: string) => void;
  loading: boolean;
  progress: { phase: string; loaded: number; total: number } | null;
  error: string | null;
}) {
  const { config } = usePlinto();
  const repoUrl = (config.git.defaultRepoUrl ?? '');
  const [token, setToken] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConnect(repoUrl, token);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold mb-2">Connect Repository</h1>
        <p className="text-gray-600 mb-6">
          Clone your Plinto site repository to start editing.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Repository
            </label>
            <div className="w-full px-3 py-2 border rounded-md bg-gray-50 text-gray-600 text-sm">
              {repoUrl}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Personal Access Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..."
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Create a PAT at GitHub → Settings → Developer settings → Personal access tokens
            </p>
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
              {error}
            </div>
          )}

          {loading && progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>{progress.phase}</span>
                {progress.total > 0 && (
                  <span>{Math.round((progress.loaded / progress.total) * 100)}%</span>
                )}
              </div>
              {progress.total > 0 && (
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-blue-600 h-1.5 rounded-full transition-all"
                    style={{ width: `${Math.round((progress.loaded / progress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Cloning...' : 'Clone Repository'}
          </button>
        </form>
      </div>
    </div>
  );
}
