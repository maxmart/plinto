/**
 * Merging, made visible.
 *
 * A pull or publish that finds the remote has moved on while this browser has
 * unpublished work must merge, and a merge with conflicts must be resolved
 * before anything else can happen. All of that used to run behind a spinner:
 * the progress text went nowhere, the only dialog was the agent's question if
 * it had one, nothing stopped the editor leaving the page halfway, and when
 * resolution failed the editor was left with a Pull button that (until the
 * fix in ops/repo.ts) did nothing, with no idea what had happened.
 *
 * So the dialog opens the moment the operation reaches 'merging' — never for
 * the ordinary checks that find nothing — and stays until the editor has read
 * how it ended. Conflicts go to Claude when there is an API key; without one,
 * when Claude fails, or when the editor asks for it, each conflicting file is
 * decided by hand: keep mine, or take the published version.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { OnConflict, OnOpsProgress, OpsPhase } from '@plinto/core/ops';
import type { ConflictFile } from '@plinto/core/storage/git-store/types';
import { usePlinto } from '../context';
import { useConflictPrompt, type ConflictPrompt } from './conflict-prompt';
import { ProgressModal } from './ui/ProgressModal';
import { StepRow } from './ui/StepRow';

export type MergeStage =
  | 'idle'       // nothing to show: no merge has started
  | 'merging'    // combining the remote's commits with ours
  | 'resolving'  // Claude is working on the conflicts
  | 'choosing'   // the editor decides each conflicting file
  | 'finishing'  // conflicts settled; committing the merge (and pushing, on publish)
  | 'done'
  | 'failed';

export type Side = 'ours' | 'theirs';

export interface MergeSession {
  stage: MergeStage;
  /** A merge is under way; leaving the page now would cancel it. */
  busy: boolean;
  /** Latest progress line, or the tail of what Claude is writing. */
  detail: string | null;
  /** The conflicting files, once the merge has found them. */
  conflicts: ConflictFile[];
  /** Why Claude is not the one resolving, when it is not. */
  manualReason: string | null;
  /** Per-file choices while choosing. */
  choices: Record<string, Side>;
  mergedFiles: string[];
  error: string | null;
  /** Claude's question, when it has one. */
  prompt: ConflictPrompt | null;
  /** Pass straight to ops.pull / ops.push. */
  onProgress: OnOpsProgress;
  onConflict: OnConflict;
  /** Record how the operation ended. Both return whether a merge was showing. */
  finish: (mergedFiles?: string[]) => boolean;
  fail: (err: unknown) => boolean;
  choose: (path: string, side: Side) => void;
  /** Complete the merge with the choices made. */
  confirmChoices: () => void;
  /** Stop waiting for Claude and decide by hand. */
  resolveManually: () => void;
  /** Give up on the merge; ops rolls it back. */
  cancel: () => void;
  /** Dismiss a finished or failed merge. */
  close: () => void;
}

const BUSY: MergeStage[] = ['merging', 'resolving', 'choosing', 'finishing'];
export const CANCELLED = 'Cancelled while resolving a conflict.';

type Resolved = { path: string; content: string }[];

/**
 * Who resolves the conflicts, and what happens when they cannot. Pure, so the
 * rules can be tested without rendering anything:
 *
 * - no API key: the editor decides, straight away;
 * - otherwise Claude, until it finishes, fails, or the editor asks to decide
 *   instead — a failure falls back to the editor rather than ending the merge,
 *   since a merge that ends is a merge rolled back;
 * - the editor cancelling (the dialog's Cancel, or cancelling Claude's
 *   question) ends it, and ops rolls the merge back.
 */
export async function resolveWithFallback(opts: {
  hasKey: boolean;
  claude: () => Promise<Resolved>;
  /** Settles when the editor asks to decide by hand. */
  manualRequested: Promise<unknown>;
  /** Rejects when the editor cancels. */
  cancelled: Promise<never>;
  /** Called as Claude starts. */
  onClaude?: () => void;
  /** Hand the files to the editor; `reason` says why it is them. */
  decideByHand: (reason: string) => Promise<Resolved>;
}): Promise<Resolved> {
  const byHand = (reason: string) => Promise.race([opts.decideByHand(reason), opts.cancelled]);

  if (!opts.hasKey) return byHand('No Claude API key is set, so decide each file yourself.');

  opts.onClaude?.();
  const claude = opts.claude().then(resolved => ({ resolved }), (err: unknown) => ({ err }));
  const winner = await Promise.race([
    claude,
    opts.manualRequested.then(() => 'manual' as const),
    opts.cancelled,
  ]);
  if (winner === 'manual') return byHand('You chose to decide each file yourself.');
  if ('err' in winner) {
    const message = winner.err instanceof Error ? winner.err.message : String(winner.err);
    // Cancelling Claude's question is the editor cancelling, not Claude failing.
    if (message === CANCELLED) throw winner.err;
    return byHand(`Claude could not resolve this (${message}). Decide each file yourself.`);
  }
  return winner.resolved;
}

export function useMergeSession(): MergeSession {
  const { settings, agents } = usePlinto();
  const { resolveConflictsWithClaude } = agents;
  const question = useConflictPrompt();
  const { ask, clear: clearQuestion } = question;

  const [stage, setStage] = useState<MergeStage>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictFile[]>([]);
  const [manualReason, setManualReason] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Side>>({});
  const [mergedFiles, setMergedFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The live stage for callbacks that outlive a render.
  const stageRef = useRef<MergeStage>('idle');
  const go = useCallback((next: MergeStage) => { stageRef.current = next; setStage(next); }, []);

  // One pending manual decision, and the two ways out of resolution.
  const manualDone = useRef<((files: { path: string; content: string }[]) => void) | null>(null);
  const manualRequested = useRef<(() => void) | null>(null);
  const cancelled = useRef<((err: Error) => void) | null>(null);
  const choicesRef = useRef<Record<string, Side>>({});
  const conflictsRef = useRef<ConflictFile[]>([]);

  const reset = useCallback(() => {
    go('idle');
    setDetail(null); setConflicts([]); setManualReason(null);
    setChoices({}); choicesRef.current = {}; conflictsRef.current = [];
    setMergedFiles([]); setError(null);
    manualDone.current = null; manualRequested.current = null; cancelled.current = null;
  }, [go]);

  const onProgress = useCallback<OnOpsProgress>((message: string, phase?: OpsPhase) => {
    if (phase === 'merging' && stageRef.current === 'idle') {
      // A new merge starts from a clean slate, whatever the last one left.
      setDetail(null); setConflicts([]); setManualReason(null); setError(null); setMergedFiles([]);
      go('merging');
    }
    if (stageRef.current !== 'idle') setDetail(message);
  }, [go]);

  const onConflict = useCallback<OnConflict>(async (files) => {
    conflictsRef.current = files;
    setConflicts(files);
    choicesRef.current = {};
    setChoices({});
    // Every wait also ends if the editor cancels.
    const cancel = new Promise<never>((_, reject) => {
      cancelled.current = reject;
    });
    cancel.catch(() => {}); // settled by whichever race is listening; never unhandled
    let switchedToManual = false;
    const manual = new Promise<void>(resolve => {
      manualRequested.current = () => { switchedToManual = true; clearQuestion(); resolve(); };
    });
    // Claude's questions are only Claude's to ask while Claude is resolving.
    const guardedAsk: typeof ask = (...args) =>
      switchedToManual ? Promise.reject(new Error(CANCELLED)) : ask(...args);

    try {
      return await resolveWithFallback({
        hasKey: !!settings.apiKey(),
        claude: () => resolveConflictsWithClaude(files, {
          onQuestion: guardedAsk,
          onProgress: text => setDetail(text),
        }),
        manualRequested: manual,
        cancelled: cancel,
        onClaude: () => go('resolving'),
        decideByHand: reason => {
          setManualReason(reason);
          setDetail(null);
          go('choosing');
          return new Promise(resolve => { manualDone.current = resolve; });
        },
      });
    } finally {
      // Whatever happens next is ops committing (or rolling back) the merge.
      manualDone.current = null; manualRequested.current = null; cancelled.current = null;
      if (stageRef.current === 'resolving' || stageRef.current === 'choosing') {
        go('finishing');
        setDetail(null);
      }
    }
  }, [settings, resolveConflictsWithClaude, ask, clearQuestion, go]);

  const finish = useCallback((files?: string[]) => {
    if (stageRef.current === 'idle') return false;
    setMergedFiles(files ?? []);
    setDetail(null);
    go('done');
    return true;
  }, [go]);

  const fail = useCallback((err: unknown) => {
    clearQuestion();
    if (stageRef.current === 'idle') return false;
    const message = err instanceof Error ? err.message : String(err);
    setError(message === CANCELLED ? 'You cancelled the merge.' : message);
    setDetail(null);
    go('failed');
    return true;
  }, [go, clearQuestion]);

  const choose = useCallback((path: string, side: Side) => {
    choicesRef.current = { ...choicesRef.current, [path]: side };
    setChoices(choicesRef.current);
  }, []);

  const confirmChoices = useCallback(() => {
    const files = conflictsRef.current;
    if (!manualDone.current || files.some(f => !choicesRef.current[f.path])) return;
    manualDone.current(files.map(f => ({
      path: f.path,
      content: choicesRef.current[f.path] === 'ours' ? f.ours : f.theirs,
    })));
  }, []);

  const resolveManually = useCallback(() => { manualRequested.current?.(); }, []);

  const cancel = useCallback(() => {
    clearQuestion();
    cancelled.current?.(new Error(CANCELLED));
  }, [clearQuestion]);

  const close = useCallback(() => {
    if (BUSY.includes(stageRef.current)) return;
    reset();
  }, [reset]);

  // Leaving mid-merge cancels it. Say so before the browser does it.
  const busy = BUSY.includes(stage);
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  return useMemo(() => ({
    stage, busy, detail, conflicts, manualReason, choices, mergedFiles, error,
    prompt: question.prompt,
    onProgress, onConflict, finish, fail, choose, confirmChoices, resolveManually, cancel, close,
  }), [stage, busy, detail, conflicts, manualReason, choices, mergedFiles, error, question.prompt,
    onProgress, onConflict, finish, fail, choose, confirmChoices, resolveManually, cancel, close]);
}

/** The first few lines of a version, enough to recognise it. */
function excerpt(text: string): string {
  const lines = text.split('\n');
  const shown = lines.slice(0, 12).map(l => (l.length > 160 ? `${l.slice(0, 160)}…` : l));
  return shown.join('\n') + (lines.length > 12 ? '\n…' : '');
}

/**
 * The dialog. Mount it unconditionally: it renders nothing until a merge
 * starts. `onRetry` re-runs whatever failed (pull or publish).
 */
export function MergeDialog({ session, onRetry }: { session: MergeSession; onRetry?: () => void }) {
  const { stage, conflicts, detail, prompt } = session;
  if (stage === 'idle') return null;

  const n = conflicts.length;
  const conflictLabel = `${n} conflicting file${n === 1 ? '' : 's'}`;
  const allChosen = n > 0 && conflicts.every(f => session.choices[f.path]);

  const progress =
    stage === 'merging' ? 30 :
    stage === 'resolving' ? 55 :
    stage === 'choosing' ? 60 :
    stage === 'finishing' ? 85 : 100;

  const subtitle =
    stage === 'merging' ? 'Combining published changes with yours…' :
    stage === 'resolving' ? 'Claude is resolving the conflicts…' :
    stage === 'choosing' ? 'Choose a version for each conflicting file' :
    stage === 'finishing' ? 'Finishing…' :
    stage === 'done' ? 'Merged' :
    'The merge did not complete';

  const resolveStatus =
    stage === 'merging' ? 'pending' as const :
    stage === 'resolving' || stage === 'choosing' ? 'active' as const :
    stage === 'failed' ? 'warning' as const : 'done' as const;

  return (
    <ProgressModal
      title="Updating with published changes"
      subtitle={subtitle}
      progress={progress}
      tone={stage === 'done' ? 'done' : stage === 'failed' ? 'error' : stage === 'choosing' ? 'warn' : 'active'}
      width="w-[680px]"
      footer={
        stage === 'done' || stage === 'failed' ? (
          <>
            {stage === 'failed' && onRetry && (
              <button
                onClick={() => { session.close(); onRetry(); }}
                className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
              >
                Try again
              </button>
            )}
            <button onClick={session.close} className="flex-1 py-2 border rounded hover:bg-gray-100 text-sm">
              Close
            </button>
          </>
        ) : stage === 'choosing' ? (
          <>
            <button
              onClick={session.confirmChoices}
              disabled={!allChosen}
              className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Complete merge
            </button>
            <button onClick={session.cancel} className="flex-1 py-2 border rounded hover:bg-gray-100 text-sm">
              Cancel
            </button>
          </>
        ) : stage === 'resolving' ? (
          <>
            <button onClick={session.resolveManually} className="flex-1 py-2 border rounded hover:bg-gray-100 text-sm">
              Decide myself instead
            </button>
            <button onClick={session.cancel} className="flex-1 py-2 border rounded hover:bg-gray-100 text-sm">
              Cancel
            </button>
          </>
        ) : (
          <p className="text-xs text-gray-500">Working…</p>
        )
      }
    >
      <StepRow label="Download published changes" status="done" />
      <StepRow
        label="Combine them with your changes"
        status={stage === 'merging' ? 'active' : stage === 'failed' && n === 0 ? 'warning' : 'done'}
      />
      {n > 0 && <StepRow label={`Resolve ${conflictLabel}`} status={resolveStatus} />}
      {n > 0 && (
        <ul className="ml-7 text-xs text-gray-500 list-disc pl-4">
          {conflicts.map(f => <li key={f.path}>{f.path}</li>)}
        </ul>
      )}

      {detail && <p className="ml-7 text-xs text-gray-500 whitespace-pre-wrap break-words">{detail}</p>}

      {session.busy && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          Keep this page open until this is done. Leaving now cancels the merge — your changes stay
          safe in this browser, but you will have to start it again.
        </div>
      )}

      {/* Claude's question, in place rather than as a dialog on top. */}
      {stage === 'resolving' && prompt && (
        <div className="p-3 border border-blue-200 bg-blue-50 rounded">
          <div className="text-xs text-gray-500 mb-1">{prompt.filePath}</div>
          <p className="text-sm font-medium mb-3">{prompt.question}</p>
          <div className="space-y-2">
            {prompt.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => prompt.resolve(i)}
                className="w-full text-left px-3 py-2 bg-white border border-gray-200 rounded hover:border-blue-400 hover:bg-blue-50"
              >
                <div className="text-sm font-medium">{opt.label}</div>
                {opt.description && <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {stage === 'choosing' && (
        <div className="space-y-3">
          {session.manualReason && <p className="text-sm text-gray-700">{session.manualReason}</p>}
          {conflicts.map(f => {
            const picked = session.choices[f.path];
            return (
              <div key={f.path} className="border rounded p-3">
                <div className="text-sm font-medium mb-2 break-all">{f.path}</div>
                <div className="grid grid-cols-2 gap-2">
                  {(['ours', 'theirs'] as const).map(side => (
                    <button
                      key={side}
                      onClick={() => session.choose(f.path, side)}
                      className={`text-left px-3 py-2 border rounded text-sm ${
                        picked === side ? 'border-blue-500 bg-blue-50 font-medium' : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      {side === 'ours' ? 'Keep my version' : 'Use the published version'}
                      <div className="text-xs text-gray-500 font-normal mt-0.5">
                        {side === 'ours'
                          ? 'Your unpublished edits to this file win.'
                          : 'Your edits to this file are dropped.'}
                      </div>
                    </button>
                  ))}
                </div>
                <details className="mt-2">
                  <summary className="text-xs text-gray-500 cursor-pointer">Show both versions</summary>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {(['ours', 'theirs'] as const).map(side => (
                      <pre key={side} className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                        {excerpt(side === 'ours' ? f.ours : f.theirs)}
                      </pre>
                    ))}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}

      {stage === 'done' && (
        <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          Your changes now include everything that was published
          {session.mergedFiles.length > 0 ? ` (${session.mergedFiles.length} file${session.mergedFiles.length === 1 ? '' : 's'} updated)` : ''}.
        </div>
      )}

      {stage === 'failed' && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 space-y-1">
          <p>{session.error}</p>
          <p className="text-red-600">
            Nothing was lost: the merge was undone, and your unpublished changes are still in this
            browser. Try again to merge, or close and carry on.
          </p>
        </div>
      )}
    </ProgressModal>
  );
}
