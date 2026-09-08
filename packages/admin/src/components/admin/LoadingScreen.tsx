import { useState, useEffect } from 'react';

const PHASE_LABELS: Record<string, string> = {
  'Counting objects': 'Preparing download',
  'Compressing objects': 'Compressing data',
  'Receiving objects': 'Downloading repository',
  'Resolving deltas': 'Finalizing',
};

/** The admin's full-screen loading state, with clone progress when cloning. */
export function LoadingScreen({ cloneProgress }: { cloneProgress: { phase: string; loaded: number; total: number } | null }) {
  const [elapsed, setElapsed] = useState(0);
  const [phaseStart, setPhaseStart] = useState(0);
  const [lastPhase, setLastPhase] = useState('');

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  // Track how long we've been in the current phase
  useEffect(() => {
    if (cloneProgress?.phase && cloneProgress.phase !== lastPhase) {
      setLastPhase(cloneProgress.phase);
      setPhaseStart(elapsed);
    }
  }, [cloneProgress?.phase, lastPhase, elapsed]);

  const phaseLabel = cloneProgress ? (PHASE_LABELS[cloneProgress.phase] || cloneProgress.phase) : null;
  const pct = cloneProgress && cloneProgress.total > 0
    ? Math.min(100, Math.round((cloneProgress.loaded / cloneProgress.total) * 100))
    : null;
  const phaseElapsed = elapsed - phaseStart;
  // If stuck at 100% for over 5s, show indeterminate progress
  const stuckAtFull = pct === 100 && phaseElapsed > 5;

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
        {cloneProgress ? (
          <>
            <h2 className="text-lg font-semibold mb-1">Setting up your workspace</h2>
            <p className="text-sm text-gray-500 mb-3">
              {stuckAtFull ? 'Downloading repository data...' : `${phaseLabel}...`}
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2 overflow-hidden">
              {stuckAtFull ? (
                <div
                  className="bg-blue-600 h-2 rounded-full animate-pulse"
                  style={{ width: '100%', opacity: 0.7 }}
                />
              ) : pct !== null ? (
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              ) : null}
            </div>
            <p className="text-xs text-gray-400">
              {elapsed}s elapsed
            </p>
            {elapsed > 15 && (
              <p className="text-xs text-gray-400 mt-1">
                First-time setup takes a moment — this only happens once
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-gray-600">Loading...</p>
            {elapsed > 3 && (
              <p className="text-xs text-gray-400 mt-2">Connecting to repository...</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
