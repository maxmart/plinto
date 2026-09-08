import { useState, useEffect, useRef } from 'react';
import TranslationTaskList from './TranslationTaskList';
import { useConflictPrompt, ConflictDialog } from './conflict-prompt';
import type { TranslationTask } from './translation-queue';
import { saveAndSync } from './translation-queue';
import { ProgressModal } from './ui/ProgressModal';
import { StepRow } from './ui/StepRow';
import { usePlinto } from '../context';

/**
 * The one save flow: commit the document, bring the other languages up to
 * date, and — with `publish` — push.
 *
 * Save & Sync and Quick Publish were two modals, and the second was the first
 * plus a push tail. Everything before the tail was duplicated: the state, the
 * autoscroll, the saveAndSync call and its outcome handling, the step rows,
 * the task list, the error and success boxes. The copies had already drifted —
 * Save & Sync showed a "Sync translations" step on a single-language site,
 * where there is nothing to sync and its own title admits it by saying "Save".
 */

type Step =
  | 'saving'
  | 'checking-translations'
  | 'translating'
  | 'checking-push'
  | 'confirming-push'
  | 'pushing'
  | 'done'
  | 'error';

export interface SaveFlowProps {
  /**
   * Abstract content path, e.g. 'page/streaming' or 'staff/anton'. Not a file
   * path with the pages directory prefixed on: collection entries live
   * somewhere else entirely and would resolve to nonsense.
   */
  contentPath: string;
  lang: string;
  /** The content to save, already computed by the caller. */
  mdxContent: string;
  /** Continue into a push once the languages are in step. */
  publish?: boolean;
  /**
   * The content reached disk. Fired the moment the commit lands, not when the
   * modal closes: from then on the editor holds nothing the file does not,
   * however the rest of the run ends. Cancelling mid-translation, or a
   * translation failing, does not un-save what was already saved.
   */
  onSaved: () => void;
  onDone: () => void;
  onCancel: () => void;
}

export default function SaveFlow({
  contentPath, lang, mdxContent, publish = false, onSaved, onDone, onCancel,
}: SaveFlowProps) {
  const plinto = usePlinto();
  const { langLabel, settings, config } = plinto;
  const { ops } = usePlinto();
  const { getSyncState, push } = ops;
  const { agents } = usePlinto();
  const { resolveConflictsWithClaude } = agents;
  const [step, setStep] = useState<Step>('saving');
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TranslationTask[]>([]);
  const [preExistingCommits, setPreExistingCommits] = useState(0);
  const [newCommits, setNewCommits] = useState(0);
  // What the publish is actually doing right now — uploading media, fetching,
  // merging, resolving conflicts with Claude… Without it the step sits on
  // "Publishing…" for however long all of that takes and looks stuck.
  const [pushDetail, setPushDetail] = useState<string | null>(null);
  const conflict = useConflictPrompt();
  const cancelledRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [tasks]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    try {
      // What was already waiting to go out, recorded before we add ours.
      const { commitsAhead } = publish ? await getSyncState() : { commitsAhead: 0 };
      setPreExistingCommits(commitsAhead);

      const outcome = await saveAndSync(plinto, {
        contentPath, lang, mdxContent,
        isCancelled: () => cancelledRef.current,
        onPhase: setStep,
        onSaved,
        onTasks: setTasks,
      });
      if (outcome === 'cancelled') { onCancel(); return; }
      if (outcome === 'no-key') {
        setError('Claude API key is required for translation.');
        setStep('error');
        return;
      }
      if (!publish) { setStep('done'); return; }
      if (cancelledRef.current) { onCancel(); return; }

      setStep('checking-push');
      const { commitsAhead: totalNow } = await getSyncState();
      setNewCommits(totalNow - commitsAhead);

      if (totalNow === 0) { setStep('done'); return; }

      if (commitsAhead > 0) {
        // Somebody else's unpublished work would ride along. Pause here; the
        // user clicks "Publish All" or cancels.
        setStep('confirming-push');
        return;
      }

      // Last chance to stop before anything leaves this machine. Without it,
      // clicking Cancel during "Checking publish status…" closed the modal
      // and pushed anyway.
      if (cancelledRef.current) { onCancel(); return; }

      await doPush();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('error');
    }
  }

  async function doPush() {
    setStep('pushing');
    try {
      const token = settings.githubToken();
      if (!token) {
        setError('GitHub token not configured. Set it up in the admin page.');
        setStep('error');
        return;
      }
      await push(
        token,
        c => resolveConflictsWithClaude(c, { onQuestion: conflict.ask, onProgress: setPushDetail }),
        setPushDetail,
      );
      setPushDetail(null);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('error');
    } finally {
      // The push is over however it ended, so nobody is going to answer a
      // question still on screen. Unmounting is not enough — the error screen
      // it can end on stays mounted, with the dialog on top of it.
      conflict.clear();
    }
  }

  // Where the sync sits on the bar: a publish continues past it, so the save
  // and the sync take a smaller share.
  const syncStart = publish ? 20 : 25;
  // Short of 100 either way: the last translation settling is not the end of
  // the run, and a bar that reads full while work continues looks stuck.
  const syncEnd = publish ? 70 : 90;
  const settled = tasks.filter(t => t.status === 'done' || t.status === 'error' || t.status === 'skipped').length;
  const progress =
    step === 'saving' ? 10 :
    step === 'checking-translations' ? syncStart :
    step === 'translating' ? syncStart + (tasks.length > 0 ? (settled / tasks.length) * (syncEnd - syncStart) : 0) :
    step === 'checking-push' ? 75 :
    step === 'confirming-push' ? 80 :
    step === 'pushing' ? 90 :
    100;

  const subtitle =
    step === 'saving' ? 'Saving and committing...' :
    step === 'checking-translations' ? 'Checking translations...' :
    step === 'translating' ? 'Translating to other languages...' :
    step === 'checking-push' ? 'Checking publish status...' :
    step === 'confirming-push' ? 'Review before publishing...' :
    step === 'pushing' ? 'Publishing…' :
    step === 'done' ? (publish ? 'Published successfully!' : 'Done!') :
    'An error occurred';

  const cancel = () => { cancelledRef.current = true; onCancel(); };

  return (
    <>
      <ProgressModal
        title={publish ? <>&#9889; Quick Publish</> : config.i18n.locales.length > 1 ? 'Save & Sync' : 'Save'}
        subtitle={subtitle}
        progress={progress}
        tone={step === 'done' ? 'done' : step === 'error' ? 'error' : 'active'}
        width={publish ? 'w-[680px]' : undefined}
        bodyRef={bodyRef}
        footer={
          step === 'done' && publish ? (
            <button onClick={onDone} className="w-full py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium">
              Back to Admin
            </button>
          ) : step === 'done' || step === 'error' ? (
            <button onClick={step === 'done' ? onDone : onCancel} className="w-full py-2 border rounded hover:bg-gray-100 text-sm">
              Close
            </button>
          ) : step === 'confirming-push' ? <div /> : (
            <button onClick={cancel} className="w-full py-2 border rounded hover:bg-gray-100 text-sm">
              Cancel
            </button>
          )
        }
      >
        <StepRow label={`Save ${langLabel(lang)} content`} status={step === 'saving' ? 'active' : 'done'} />

        {/* One locale: there are no translations to sync, so no step to show. */}
        {step !== 'saving' && config.i18n.locales.length > 1 && (
          <>
            <StepRow
              label="Sync translations"
              status={step === 'checking-translations' || step === 'translating' ? 'active' : 'done'}
              // Only once the sync has actually finished: an error before the
              // check completes is not "all up to date".
              suffix={
                tasks.length === 0 && ['checking-push', 'confirming-push', 'pushing', 'done'].includes(step)
                  ? ' (all up to date)' : undefined
              }
            />
            {tasks.length > 0 && (
              <div className="ml-7 mt-1">
                <TranslationTaskList tasks={tasks} sourceLang={lang} />
              </div>
            )}
          </>
        )}

        {publish && ['checking-push', 'confirming-push', 'pushing', 'done'].includes(step) && (
          <>
            <StepRow
              label={
                step === 'checking-push' ? 'Checking publish status...' :
                step === 'pushing' ? 'Publishing…' :
                step === 'confirming-push' ? 'Publish requires confirmation' :
                'Published'
              }
              status={
                step === 'checking-push' || step === 'pushing' ? 'active' :
                step === 'confirming-push' ? 'warning' :
                'done'
              }
            />
            {step === 'pushing' && pushDetail && <p className="ml-7 text-xs text-gray-500">{pushDetail}</p>}
          </>
        )}

        {step === 'confirming-push' && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg ml-7">
            <p className="text-sm text-amber-800 font-medium mb-1">
              There {preExistingCommits === 1 ? 'is' : 'are'} {preExistingCommits} other unpublished change{preExistingCommits !== 1 ? 's' : ''} that will also be published.
            </p>
            <p className="text-sm text-amber-700 mb-3">Publish everything, or cancel and review in admin first?</p>
            <div className="flex gap-2">
              <button
                onClick={() => doPush()}
                className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 text-sm font-medium"
              >
                Publish All ({preExistingCommits + newCommits} changes)
              </button>
              <button
                onClick={onCancel}
                className="px-4 py-2 border border-amber-300 rounded hover:bg-amber-100 text-sm text-amber-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}

        {step === 'done' && (
          <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
            {publish
              ? 'All changes saved, translated, and pushed. The site will rebuild automatically.'
              : 'Changes saved and translations synced.'}
          </div>
        )}
      </ProgressModal>

      <ConflictDialog prompt={conflict.prompt} />
    </>
  );
}
