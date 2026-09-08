import { useState, useEffect, useMemo } from 'react';
import { parseGitHubRepo } from '@plinto/core';
import { usePlinto } from '../../context';

/**
 * Settings view: the invite-an-editor flow. An admin creates a scoped GitHub
 * token for the new editor, bundles it with a Claude API key into a base64
 * setup code, and sends the ready-made invite message.
 */
export function SettingsView() {
  const { settings, config } = usePlinto();
  const [userName, setUserName] = useState('');
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [copied, setCopied] = useState<'code' | 'message' | null>(null);

  useEffect(() => {
    const storedApiKey = settings.apiKey();
    if (storedApiKey) setApiKey(storedApiKey);
  }, []);

  // The site's own repository, for prefilling GitHub's new-token form.
  const repo = useMemo(() => {
    const url = settings.repoUrl() || config.git.defaultRepoUrl || '';
    return parseGitHubRepo(url);
  }, []);

  const patUrl = useMemo(() => {
    const encodedName = encodeURIComponent(`Plinto - ${userName || 'User'}`);
    const target = repo ? `&target_name=${encodeURIComponent(repo.owner)}` : '';
    return `https://github.com/settings/personal-access-tokens/new?name=${encodedName}&description=Plinto+CMS+editor+access${target}&expires_in=366&contents=write`;
  }, [userName, repo]);

  const generatedCode = useMemo(() => {
    if (!userName.trim() || !token.trim() || !apiKey.trim()) return '';
    try {
      return btoa(JSON.stringify({ name: userName.trim(), token: token.trim(), apikey: apiKey.trim() }));
    } catch { return ''; }
  }, [userName, token, apiKey]);

  /**
   * The whole invite, ready to paste into a message.
   *
   * Addresses come from wherever the admin is open. Invites are composed on
   * the deployed admin, where the origin IS the site's canonical home; an
   * invite composed on a dev server points at localhost, which is at least
   * honest about where it was made.
   */
  const inviteMessage = useMemo(() => {
    if (!generatedCode) return '';
    const name = userName.trim();
    const base = window.location.origin;
    return [
      `Hi ${name}!`,
      `You've been added as admin for ${base}/`,
      `Admin is at: ${base}/plinto/admin/`,
      '',
      `Enter your name: ${name}`,
      `And this code: ${generatedCode}`,
    ].join('\n');
  }, [generatedCode, userName]);

  const handleCopy = async (text: string, which: 'code' | 'message') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API needs a secure context and permission; fall back to the
      // old execCommand path rather than leaving the button doing nothing.
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="p-6 max-w-xl space-y-8">
      <h2 className="text-lg font-semibold">Settings</h2>

      <div>
        <h3 className="font-semibold text-sm text-gray-800 mb-3 uppercase tracking-wide">
          Step 1: Create a GitHub Token
        </h3>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex items-start gap-2">
            <span className="bg-gray-200 text-gray-700 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
            <div className="flex-1">
              <span>Enter the user&apos;s name, then click the link to create a token:</span>
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="User name"
                  className="flex-1 px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <a
                  href={patUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 px-3 py-1.5 bg-gray-800 text-white rounded text-sm hover:bg-gray-700 inline-flex items-center gap-1"
                >
                  Create token
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-gray-200 text-gray-700 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
            <span>Select <strong>&quot;Only select repositories&quot;</strong> and pick <strong>{repo?.repo ?? 'your site repository'}</strong>. Click <strong>&quot;Generate token&quot;</strong> and copy it.</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-sm text-gray-800 mb-3 uppercase tracking-wide">
          Step 2: Generate Setup Code
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GitHub Token</label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_..."
              className="w-full px-3 py-2 border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Claude API Key</label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-3 py-2 border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Generated Code</label>
            <div className="relative">
              <textarea
                readOnly
                value={generatedCode}
                placeholder="Fill in all fields above to generate a code"
                className="w-full px-3 py-2 border rounded-md text-sm font-mono bg-gray-50 text-gray-700 resize-none focus:outline-none"
                rows={3}
              />
              {generatedCode && (
                <button
                  type="button"
                  onClick={() => handleCopy(generatedCode, 'code')}
                  className="absolute top-2 right-2 px-2.5 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                >
                  {copied === 'code' ? 'Copied!' : 'Copy'}
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Send this code to the user. They will enter it on the setup screen.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-sm text-gray-800 mb-3 uppercase tracking-wide">
          Step 3: Send the Invite
        </h3>
        <div className="relative">
          <textarea
            readOnly
            value={inviteMessage}
            placeholder="Fill in all fields above to generate the invite"
            className="w-full px-3 py-2 border rounded-md text-sm bg-gray-50 text-gray-700 resize-none focus:outline-none"
            /* Sized so a real invite fits without scrolling: a fine-grained
               PAT plus an Anthropic key base64 to ~320 characters, which wraps
               to roughly six lines on top of the five lines of message. */
            rows={12}
          />
          {inviteMessage && (
            <button
              type="button"
              onClick={() => handleCopy(inviteMessage, 'message')}
              className="absolute top-2 right-2 px-2.5 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            >
              {copied === 'message' ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Copy and send this to {userName.trim() || 'the user'}.{' '}
          <strong className="text-gray-700">
            It contains a GitHub token and a Claude API key — send it privately, not over a public channel.
          </strong>
        </p>
      </div>
    </div>
  );
}
