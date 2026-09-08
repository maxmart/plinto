import { useState } from 'react';
import { usePlinto } from '../../context';

/**
 * Setup screen shown when the user has no stored credentials yet: they enter
 * their name and the base64 setup code an admin generated in SettingsView.
 */
export function SetupScreen() {
  const { settings, config } = usePlinto();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  const handleActivate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !code.trim()) {
      setError('Please fill in both fields');
      return;
    }

    try {
      const decoded = JSON.parse(atob(code.trim()));
      if (!decoded.name || !decoded.token || !decoded.apikey) {
        setError('Invalid setup code');
        return;
      }
      if (decoded.name.toLowerCase() !== name.trim().toLowerCase()) {
        setError("Name doesn't match the setup code");
        return;
      }

      // Store credentials
      settings.setAdminName(decoded.name);
      settings.setGithubToken(decoded.token);
      settings.setApiKey(decoded.apikey);
      settings.setRepoUrl(config.git.defaultRepoUrl ?? '');

      setActivating(true);
      setTimeout(() => window.location.reload(), 800);
    } catch {
      setError('Invalid setup code');
    }
  };

  if (activating) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-green-500 text-4xl mb-3">&#10003;</div>
          <h2 className="text-xl font-semibold mb-1">Welcome, {name}!</h2>
          <p className="text-gray-500 text-sm">Setting up your workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold mb-2">Welcome to Plinto</h1>
        <p className="text-gray-600 mb-6">
          Enter your name and the setup code you received from your administrator.
        </p>

        <form onSubmit={handleActivate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            {/* name/autocomplete let the browser's password manager store the
                pair as username + password and autofill on the next visit. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Setup Code
            </label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste the code here"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Activate
          </button>
        </form>
      </div>
    </div>
  );
}
