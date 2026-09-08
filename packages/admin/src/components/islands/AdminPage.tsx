/**
 * The admin. Two hooks hold the state — the repository (`useRepo`) and the
 * documents in the current tab (`useContentList`) — and what is left here is
 * which of them is showing, and what the buttons do.
 */
import { useState, useMemo, useEffect } from 'react';
import { LangSwitcher } from '../admin/LangSwitcher';
import { AdminSidebar } from '../admin/AdminSidebar';
import { listCollections } from '../admin/collection-config';
import { ContentList } from '../admin/ContentList';
import type { NavView } from '../admin/types';
import { SetupScreen } from '../admin/SetupScreen';
import { LoadingScreen } from '../admin/LoadingScreen';
import { SettingsView } from '../admin/SettingsView';
import { ConnectRepoForm } from '../admin/ConnectRepoForm';
import { GitStatusBar } from '../admin/GitStatusBar';
import { PublishModal } from '../admin/PublishModal';
import { NewPageModal } from '../admin/NewPageModal';
import { useRepo } from '../admin/use-repo';
import { useContentList } from '../admin/use-content-list';
import SyncAllModal from '../SyncAllModal';
import { ConflictDialog } from '../conflict-prompt';
import DeploymentStatus from '../DeploymentStatus';
import { usePlinto } from '../../context';
import type { Section } from '@plinto/core';

export default function AdminPage() {
  const { sections, toFilePath, config } = usePlinto();
  const repo = useRepo();
  const [lang, setLang] = useState(config.i18n.defaultLocale);
  const [activeView, setActiveView] = useState<NavView>({ kind: 'pages' });
  const collections = useMemo(() => listCollections(config), []);
  const content = useContentList(activeView, lang, repo.ready);

  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showNewPageModal, setShowNewPageModal] = useState(false);
  const [syncAllItems, setSyncAllItems] = useState<{ contentPath: string; targetLang: string }[] | null>(null);

  const activeSection: Section | undefined =
    activeView.kind === 'section' ? sections().find(s => s.folder === activeView.folder) : undefined;

  function openPublishModal() {
    if (!repo.canPublish) {
      repo.showError('No credentials stored. Please reconnect.');
      return;
    }
    setShowPublishModal(true);
  }

  function createPage(slug: string, title: string, copyFrom?: string) {
    // The file is not written until the editor saves it.
    const filePath = toFilePath(`page/${slug}`, lang);
    const copyParam = copyFrom ? `&copyFrom=${encodeURIComponent(copyFrom)}` : '';
    window.location.href =
      `/plinto/admin/edit/?file=${encodeURIComponent(filePath)}&lang=${lang}&new=true&title=${encodeURIComponent(title)}${copyParam}`;
  }

  /** Sync one document to every language that needs it — all of them if none does. */
  function syncOne(contentPath: string) {
    const item = content.state.items.find(i => i.contentPath === contentPath);
    const stale = config.i18n.locales.filter(
      l => item?.staleness?.[l] === 'stale' || item?.staleness?.[l] === 'missing');
    const targets = stale.length > 0 ? stale : config.i18n.locales.filter(l => l !== lang);
    setSyncAllItems(targets.map(targetLang => ({ contentPath, targetLang })));
  }

  if (repo.needsAuth && !repo.devMode) return <SetupScreen />;

  if (repo.needsSetup && !repo.devMode) {
    return (
      <ConnectRepoForm
        onConnect={repo.connect}
        loading={repo.loading}
        progress={repo.cloneProgress}
        error={repo.error?.message ?? null}
      />
    );
  }

  if (repo.loading) return <LoadingScreen cloneProgress={repo.cloneProgress} />;

  // A failure before the repository exists has no admin to show it in.
  if (repo.error && !repo.status.initialized && !repo.needsSetup) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-500 text-4xl mb-3">!</div>
          <h2 className="text-lg font-semibold mb-2">Connection failed</h2>
          <p className="text-sm text-red-600 bg-red-50 p-3 rounded mb-4">{repo.error.message}</p>
          <div className="space-y-2">
            <button
              onClick={() => { repo.clearError(); repo.reload(); }}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Try again
            </button>
            <button
              onClick={repo.logout}
              className="w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm"
            >
              Start over
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {repo.status.initialized && (
        <GitStatusBar
          status={repo.status}
          onPull={repo.pull}
          onPublish={openPublishModal}
          onLogout={!repo.devMode && repo.adminName ? repo.logout : undefined}
          adminName={repo.adminName || undefined}
          pulling={repo.pulling}
          merging={repo.pulling && repo.conflict.prompt !== null}
          mergeResult={repo.mergeResult}
          onReconnect={repo.reconnect}
        />
      )}

      {repo.status.repoUrl && !repo.devMode && (
        <DeploymentStatus
          repoUrl={repo.status.repoUrl}
          token={repo.token ?? undefined}
          triggerPoll={repo.pushCount}
          lastPushedSha={repo.lastPushedSha}
        />
      )}

      {showPublishModal && (
        <PublishModal
          onClose={() => setShowPublishModal(false)}
          onPublish={async () => { if (await repo.publish()) setShowPublishModal(false); }}
          publishing={repo.publishing}
          commitsAhead={repo.status.commitsAhead || 0}
        />
      )}

      <ConflictDialog prompt={repo.conflict.prompt} />

      {showNewPageModal && (
        <NewPageModal
          lang={lang}
          pages={content.state.items}
          section={activeSection}
          onClose={() => setShowNewPageModal(false)}
          onCreatePage={createPage}
        />
      )}

      <div className="flex flex-1 min-h-0">
        <AdminSidebar
          activeView={activeView}
          collections={collections}
          onNavigate={setActiveView}
        />

        <main className="flex-1 overflow-y-auto bg-white">
          {activeView.kind !== 'settings' && (
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              {/* One locale means no language versions to switch between. */}
              {config.i18n.locales.length > 1 ? <LangSwitcher activeLang={lang} onChange={setLang} /> : <div />}
              <div className="flex items-center gap-2">
                {(activeView.kind === 'pages' || activeView.kind === 'section') && (
                  <button
                    onClick={() => setShowNewPageModal(true)}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    {activeSection ? `+ Add ${activeSection.label}` : '+ New Page'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* An unfinished merge blocks every save, and nothing else in the
              admin's start-up notices — so it is announced rather than left
              to be discovered by a save that fails. */}
          {repo.mergePending && (
            <div className="mx-4 mt-4 p-4 bg-amber-50 text-amber-800 rounded-lg">
              <p className="font-medium">A publish was interrupted part-way through merging.</p>
              <p className="mt-1 text-sm">
                Nothing can be saved until it is finished or undone. Pull to try the merge again,
                or discard local changes to start from what is published.
              </p>
              <button
                onClick={repo.discard}
                className="mt-3 px-4 py-2 bg-amber-700 text-white rounded hover:bg-amber-800 text-sm"
              >
                Discard All Changes &amp; Reset
              </button>
            </div>
          )}

          {repo.error && (
            <div className="mx-4 mt-4 p-4 bg-red-50 text-red-600 rounded-lg">
              <p>{repo.error.message}</p>
              {repo.error.remedy === 'discard' && (
                <button
                  onClick={repo.discard}
                  className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                >
                  Discard All Changes &amp; Reset
                </button>
              )}
            </div>
          )}

          {activeView.kind === 'settings' ? (
            <SettingsView />
          ) : (
            <ContentList
              items={content.state.items}
              loading={content.state.loading || !content.state.loaded}
              error={content.state.error}
              onRetry={content.reload}
              activeLang={lang}
              modifiedPaths={repo.modifiedPaths}
              devMode={repo.devMode}
              grouped={activeView.kind === 'pages'}
              presorted={activeView.kind === 'section'}
              onSync={syncOne}
            />
          )}

          {syncAllItems && (
            <SyncAllModal
              items={syncAllItems}
              onComplete={() => {
                setSyncAllItems(null);
                repo.reload();
                content.reload();
              }}
              onClose={() => setSyncAllItems(null)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
