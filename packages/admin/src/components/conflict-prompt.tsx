/**
 * Putting the merge agent's question to the user: a promise the agent can
 * await, and a guarantee that the promise is always settled. The merge
 * session (merge-session.tsx) uses it and shows the question inside its own
 * dialog, for both places that can merge: the admin page (pull, publish) and
 * Quick Publish.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { AskConflictQuestion, ConflictChoice } from '@plinto/core/agents/conflict';

/** A question waiting on screen, with the two ways it can end. */
export interface ConflictPrompt {
  filePath: string;
  question: string;
  options: ConflictChoice[];
  /** Answer it. */
  resolve: (index: number) => void;
  /** Give up on the whole operation. */
  cancel: () => void;
}

/**
 * A conflict question the caller can `await`, plus the state to render it.
 *
 * `pull()` and `push()` stage a merge, hand the conflicted files to Claude,
 * and block on whatever it asks — with the merge staged and uncommitted for
 * the whole time. A question that is never answered therefore holds the
 * repository half-merged for the life of the page, and the next ordinary save
 * sweeps the remote's changes into a single-parent commit. So every way out
 * of here settles the promise: answering, cancelling, `clear()`, unmounting.
 *
 * Rejecting whatever is currently waiting does not cover all of it. Between
 * the merge staging its conflicts and Claude reaching its first question
 * there are seconds of streaming with no promise in existence, and a cancel
 * in that window left the operation running headless: the question arrived at
 * a dead component where setState does nothing, and no promise had yet been
 * created to reject. `alive` closes that window by refusing outright.
 */
export function useConflictPrompt(): {
  prompt: ConflictPrompt | null;
  ask: AskConflictQuestion;
  /** Drop a question whose operation has ended, however it ended. */
  clear: () => void;
} {
  const [prompt, setPrompt] = useState<ConflictPrompt | null>(null);
  const pending = useRef<((reason: Error) => void) | null>(null);
  const alive = useRef(true);

  // Set on the way in as well as cleared on the way out. A ref initialised at
  // `true` is only true once, and React runs an effect's cleanup before
  // re-running it — under StrictMode's double-mount, or any remount, the
  // cleanup below would leave `alive` false on a component that is very much
  // alive, and every question after that would be refused.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.(new Error('Closed while a conflict was being resolved.'));
      pending.current = null;
    };
  }, []);

  const ask = useCallback<AskConflictQuestion>(
    (filePath, question, options) =>
      new Promise<number>((resolve, reject) => {
        if (!alive.current) {
          reject(new Error('Cancelled before this conflict could be resolved.'));
          return;
        }
        const settle = () => { pending.current = null; setPrompt(null); };
        pending.current = reject;
        setPrompt({
          filePath,
          question,
          options,
          resolve: index => { settle(); resolve(index); },
          cancel: () => { settle(); reject(new Error('Cancelled while resolving a conflict.')); },
        });
      }),
    [],
  );

  // Settles, not just hides. Callers run this in a `finally`, where the whole
  // point is that the operation is over however it ended — so a question left
  // on screen there has nobody left to answer it, and taking the dialog away
  // without rejecting would leave the merge staged behind a promise that
  // never resolves. Today every path settles before reaching the finally, so
  // this finds nothing to do; the invariant is that there is no fourth way
  // out, not that this particular one is currently unused.
  const clear = useCallback(() => {
    pending.current?.(new Error('Cancelled while resolving a conflict.'));
    pending.current = null;
    setPrompt(null);
  }, []);

  // Memoised, because callers put this in dependency arrays. A fresh object
  // every render made `useRepo`'s pull and publish fresh every render too,
  // and the auto-pull effect that depends on pull therefore ran its body on
  // every render — with nothing but a ref guard between the admin and a pull
  // per render. A dependency array that cannot be relied on is worse than
  // none, because it reads as though it can.
  return useMemo(() => ({ prompt, ask, clear }), [prompt, ask, clear]);
}
