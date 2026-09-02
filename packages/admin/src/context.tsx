/**
 * How the admin reaches its runtime.
 *
 * React context rather than a module import, and that is the whole difference
 * between an application that can be mounted by any adapter and one that can
 * only be mounted by the adapter it was written next to. The islands are the
 * composition roots: the adapter builds a runtime and wraps its own entry
 * point in this provider.
 *
 * Everything below reads it with `usePlinto()` and destructures what it needs,
 * so call sites read exactly as they did when these were module imports.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { AdminRuntime } from './runtime';

const PlintoContext = createContext<AdminRuntime | null>(null);

export function PlintoProvider({ runtime, children }: { runtime: AdminRuntime; children: ReactNode }) {
  return <PlintoContext.Provider value={runtime}>{children}</PlintoContext.Provider>;
}

/**
 * The configured plinto this admin is running against.
 *
 * Throws rather than returning null: a component rendered outside the provider
 * is a mounting mistake, and every other symptom of it — an undefined config,
 * an ops call that never resolves — is much further from the cause.
 */
export function usePlinto(): AdminRuntime {
  const runtime = useContext(PlintoContext);
  if (!runtime) {
    throw new Error(
      '[@plinto/admin] usePlinto() outside an <PlintoProvider>. The adapter mounts each island ' +
      'inside one — see the island wrappers in @plinto/astro.',
    );
  }
  return runtime;
}
