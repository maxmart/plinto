import { useState, useEffect, useRef } from 'react';
import TranslationTaskList from './TranslationTaskList';
import type { TranslationTask } from './translation-queue';
import { usePlinto } from '../context';
import { getOrPromptApiKey, pendingTasks, runTranslationQueue, type QueueItem } from './translation-queue';
import { ProgressModal } from './ui/ProgressModal';

interface SyncAllModalProps {
  items: QueueItem[];
  onComplete: () => void;
  onClose: () => void;
}

/** "Content → LANG", with the home page called Home. */
function taskLabel(task: TranslationTask): string {
  const path = task.contentPath ?? '';
  const name = path === 'page/' ? 'Home' : path.replace(/^page\//, '');
  return `${name} → ${task.targetLang.toUpperCase()}`;
}

export default function SyncAllModal({ items, onComplete, onClose }: SyncAllModalProps) {
  const plinto = usePlinto();
  const [tasks, setTasks] = useState<TranslationTask[]>(() => pendingTasks(items));
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const cancelledRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to follow active item output
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [tasks]);

  // Auto-start on mount
  useEffect(() => {
    (async () => {
      const apiKey = getOrPromptApiKey(plinto);
      if (!apiKey) return;
      setRunning(true);
      cancelledRef.current = false;
      await runTranslationQueue(plinto, items, apiKey, {
        isCancelled: () => cancelledRef.current,
        onTasks: setTasks,
      });
      setRunning(false);
      setFinished(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = tasks.filter(t => t.status === 'done').length;
  const errorCount = tasks.filter(t => t.status === 'error').length;
  const skippedCount = tasks.filter(t => t.status === 'skipped').length;
  const active = tasks.find(t => t.status === 'translating' || t.status === 'saving');

  return (
    <ProgressModal
      title="Syncing Translations"
      subtitle={
        running && active
          ? `Translating ${tasks.indexOf(active) + 1}/${tasks.length}: ${taskLabel(active)}...`
          : finished
            ? `Done. ${doneCount} translated${errorCount > 0 ? `, ${errorCount} failed` : ''}${skippedCount > 0 ? `, ${skippedCount} skipped` : ''}.`
            : 'Starting...'
      }
      progress={((doneCount + errorCount + skippedCount) / tasks.length) * 100}
      tone={finished ? (errorCount > 0 ? 'warn' : 'done') : 'active'}
      width="w-[700px]"
      bodyRef={bodyRef}
      footer={
        running ? (
          <button
            onClick={() => { cancelledRef.current = true; }}
            className="flex-1 py-2 border rounded hover:bg-gray-100 text-sm"
          >
            Cancel (after current)
          </button>
        ) : (
          <button
            onClick={() => { if (finished) onComplete(); onClose(); }}
            className="flex-1 py-2 border rounded hover:bg-gray-100 text-sm"
          >
            Close
          </button>
        )
      }
    >
      <TranslationTaskList tasks={tasks} sourceLang="" formatLabel={taskLabel} />
    </ProgressModal>
  );
}
