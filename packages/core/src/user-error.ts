/**
 * An error whose message is already written for the person who will read it.
 *
 * Most failures reach the admin through `translateError`, which turns a raw
 * message into something a content editor can act on and hides the rest. Some
 * failures are *already* that: the store refusing to commit past an
 * interrupted merge knows exactly what happened and exactly what to do about
 * it, and anything the translator substitutes is worse.
 *
 * It exists because the first attempt at this matched on a word. The
 * translator passed through anything containing "merge", and the one message
 * it was written for says "merging" — so the sentence explaining an
 * unrecoverable state became "Something went wrong. Please try again.", and
 * the Discard button that keyed on the same word never rendered. The state
 * the message described has no other way out. Carrying the intent on the
 * error instead of hoping to recognise its wording is the whole point.
 *
 * A leaf module on purpose: the storage layer raises these and the ops layer
 * reads them, and neither should have to import the other.
 */
export class UserFacingError extends Error {
  constructor(
    message: string,
    /** What the admin can offer that would actually help. */
    readonly remedy?: 'discard',
  ) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** The remedy to offer for a failure, if the failure named one. */
export function remedyFor(err: unknown): 'discard' | undefined {
  if (err instanceof UserFacingError) return err.remedy;
  const cause = (err as { cause?: unknown })?.cause;
  return cause instanceof UserFacingError ? cause.remedy : undefined;
}
