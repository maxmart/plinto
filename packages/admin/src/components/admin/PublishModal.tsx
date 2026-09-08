import { useState, useEffect } from 'react';
import type { FileChange } from '@plinto/core/storage';
import { usePlinto } from '../../context';

/**
 * What is about to be published, and a button to publish it.
 *
 * This was `CommitModal`, and it did not commit. Every save in plinto commits
 * as it goes — that is what makes a page's history a page's history — so by
 * the time this opens there is nothing left to commit and `push` is all that
 * happens. The name said otherwise, and so did the whole middle of it: a
 * commit-message box, and a button that spent an API call having Claude draft
 * one, feeding a parameter the caller has never read. Someone writes that
 * message carefully. Dead UI is worse than dead code.
 *
 * Only reachable with unpushed commits — the Publish button in the status bar
 * is disabled otherwise — so what is left is a list and a confirmation.
 */
export function PublishModal({
  onClose,
  onPublish,
  publishing,
  commitsAhead,
}: {
  onClose: () => void;
  onPublish: () => void;
  publishing: boolean;
  commitsAhead: number;
}) {
  const { ops } = usePlinto();
  const { getCommitLog } = ops;
  const [files, setFiles] = useState<FileChange[]>([]);
  const [commitMessages, setCommitMessages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // `depth: 0` is not "no commits" to isomorphic-git — its loop compares
    // length to depth only after pushing the first, so 0 never matches and it
    // walks the entire history, diffing two trees per commit against
    // IndexedDB. 853 of them, here. The status this modal was opened with can
    // reach 0 while it is still up: a publish from another tab lands, and the
    // visibility refresh or the 60-second poll reads it back.
    if (commitsAhead <= 0) { setLoading(false); return; }

    // Back to loading on every refetch, not just the first. Without it a modal
    // that opened at 0 and then saw a commit land showed "Publish 1 change"
    // over "No changes", with Publish enabled, until the fetch returned — and
    // 3 → 0 → 3 showed the *first* fetch's rows under the third fetch's count.
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const commits = await getCommitLog(commitsAhead);
        if (cancelled) return;
        // One row per path, keeping the latest status: a file added and then
        // edited across two commits is one added file, not two rows.
        const byPath = new Map<string, FileChange>();
        for (const c of commits) for (const f of c.files) byPath.set(f.path, f);
        setFiles([...byPath.values()]);
        // A merge commit's message describes the merge, not the work.
        setCommitMessages(
          commits.map(c => c.message).filter(m => !m.startsWith('Merge remote-tracking branch')),
        );
      } catch {
        // The list is context, not the operation. Publishing what git already
        // holds does not depend on being able to describe it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [commitsAhead]);

  const typeColors = {
    added: 'text-green-600',
    modified: 'text-yellow-600',
    deleted: 'text-red-600',
    renamed: 'text-blue-600',
  };

  const typeLabels = {
    added: '+',
    modified: '~',
    deleted: '-',
    renamed: '→',
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[500px] max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="font-bold text-lg">
            {commitsAhead > 0
              ? `Publish ${commitsAhead} change${commitsAhead !== 1 ? 's' : ''}`
              : 'Nothing to publish'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            &times;
          </button>
        </div>

        <div className="p-4 flex-1 overflow-auto">
          {loading ? (
            <p className="text-gray-500">Loading changes...</p>
          ) : commitsAhead <= 0 ? (
            /* Reached while the modal is open — someone else published these,
               or this tab did and the status caught up. */
            <p className="text-sm text-gray-500">Everything here is already published.</p>
          ) : commitMessages.length > 0 ? (
            <>
              <label className="block text-sm font-medium mb-2">
                Unpublished changes ({commitMessages.length})
              </label>
              <div className="bg-gray-50 rounded border max-h-60 overflow-auto">
                <ul className="text-sm">
                  {commitMessages.map((msg, i) => (
                    <li key={i} className="px-3 py-1 border-b last:border-0 text-gray-700">
                      {msg}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            /* Reachable: unpushed commits that are all merges have no message
               worth showing, but they still move files. */
            <>
              <label className="block text-sm font-medium mb-2">Changed files ({files.length})</label>
              <div className="bg-gray-50 rounded border max-h-60 overflow-auto">
                {files.length === 0 ? (
                  <p className="p-3 text-gray-500 text-sm">No changes</p>
                ) : (
                  <ul className="text-sm font-mono">
                    {files.map(file => (
                      <li key={file.path} className="px-3 py-1 border-b last:border-0 flex items-center gap-2 min-w-0">
                        <span className={`font-bold shrink-0 ${typeColors[file.type]}`}>
                          {typeLabels[file.type]}
                        </span>
                        <span className="truncate min-w-0">{file.path}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 border rounded hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing || commitsAhead <= 0}
            className="flex-1 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
