/**
 * Talking to Claude, from the browser.
 *
 * Everything plinto asks Claude — translating a page, resolving a merge
 * conflict, drafting a commit message — goes through a client built here, so
 * the two things that are true of all of them are stated once.
 */

import type AnthropicClient from '@anthropic-ai/sdk';
import type { APIError } from '@anthropic-ai/sdk';

/**
 * The SDK is fetched the first time something asks Claude, not when the admin
 * loads. Translating and publishing are occasional acts; a dynamic import
 * keeps their transport out of the editor's initial bundle and in a chunk of
 * its own.
 */
let sdk: Promise<typeof import('@anthropic-ai/sdk')> | null = null;

/**
 * The error class, kept from a successful load.
 *
 * Held here so describing a failure never has to await the module — which
 * matters most when the module is what failed.
 */
let apiErrorClass: typeof APIError | null = null;

function claudeSdk(): Promise<typeof import('@anthropic-ai/sdk')> {
  // Memoized, but only on success. A remembered rejection would be permanent:
  // one failed chunk fetch — a deploy while the tab was open, a moment
  // offline — and every Claude feature stays broken until the page is
  // reloaded, long after the network came back. Forgetting lets the next
  // attempt try again.
  return (sdk ??= import('@anthropic-ai/sdk').then(
    mod => {
      apiErrorClass = mod.APIError;
      return mod;
    },
    err => {
      sdk = null;
      throw err;
    },
  ));
}

/**
 * A client for the visitor's own API key.
 *
 * The admin runs inside the deployed site, so there is no server to keep a
 * key on: it is the editor's key, held in their browser, sent straight to the
 * API. That is what a site that can edit itself means, and it is the one
 * place plinto opts into direct browser access.
 */
export async function claudeClient(apiKey: string): Promise<AnthropicClient> {
  // Asked before the SDK is, because the SDK's own complaint is written for
  // whoever wired up a server: "Could not resolve authentication method.
  // Expected one of apiKey, authToken, credentials, config, or profile…".
  // A content editor stuck mid-merge deserves the sentence below instead.
  if (!apiKey) {
    throw new Error('No Claude API key is set. Add one in the admin settings to use this.');
  }
  const { default: Anthropic } = await claudeSdk();
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/**
 * The sentence to put in front of a human when a call to Claude fails.
 *
 * Deliberately synchronous. It used to await the SDK to get `APIError`, which
 * meant that when loading the SDK was itself the failure, describing it threw
 * too — the caller's catch never reached its setState and the UI showed
 * nothing at all, which is the exact silence this was written to end.
 */
export function claudeErrorMessage(err: unknown): string {
  if (apiErrorClass && err instanceof apiErrorClass) {
    // The readable sentence lives in the response body ("API key is
    // invalid."); err.message is the whole body serialized with the status
    // glued in front, which is not something to show anyone. When there is no
    // such sentence — an HTML error page from a proxy, a bodyless 500 —
    // err.message is the best available and already carries the status, so
    // adding one would print it twice.
    const body = err.error as { error?: { message?: string } } | undefined;
    const sentence = body?.error?.message;
    return sentence && err.status ? `${err.status} — ${sentence}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
