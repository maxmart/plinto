/**
 * User-facing error translation for the long-running git orchestrations.
 * The raw failure survives in the console; the OpsError's userMessage is
 * what the admin UI shows.
 */

import { UserFacingError } from '../user-error';

export class OpsError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly cause: Error,
  ) {
    super(userMessage);
  }
}

export function translateError(err: unknown): OpsError {
  const msg = err instanceof Error ? err.message : String(err);
  // Already written for the reader, and often the only thing that explains a
  // state with one specific way out. Substituting "Please try again" for one
  // of these is not a downgrade in tone, it is wrong advice.
  if (err instanceof UserFacingError) return new OpsError(err.message, err);
  // Deliberately noisy: the OpsError shown to the user hides the real message,
  // so the console is the only place the underlying failure survives.
  console.error('[ops] translateError:', msg, err);
  // Auth first: an auth failure phrased around a fetch ("GitHub fetch failed:
  // 401") must not read as a connectivity problem.
  if (/401|auth|credential/i.test(msg)) {
    return new OpsError('Authentication failed. Check your access token in settings.', err instanceof Error ? err : new Error(msg));
  }
  if (/fetch|network|CORS/i.test(msg)) {
    return new OpsError('Could not reach the server. Check your internet connection.', err instanceof Error ? err : new Error(msg));
  }
  if (/429|rate/i.test(msg)) {
    return new OpsError('Service temporarily unavailable. Please try again in a moment.', err instanceof Error ? err : new Error(msg));
  }
  if (/not available in dev mode/i.test(msg)) {
    return new OpsError('This operation is not available in development mode.', err instanceof Error ? err : new Error(msg));
  }
  return new OpsError('Something went wrong. Please try again.', err instanceof Error ? err : new Error(msg));
}
