
import { useState, useEffect, useRef } from 'react';
import { parseGitHubRepo } from '@plinto/core';
import { usePlinto } from '../context';
import {
  getLatestWorkflowRun,
  getGitHubPagesUrl,
  getWorkflowJobs,
  WorkflowRun,
  WorkflowJob,
} from '../github';


interface DeploymentStatusProps {
  repoUrl: string;
  token?: string;
  triggerPoll: number;
  lastPushedSha?: string;
}

/** True when a run is for the given push — either sha may be abbreviated. */
function runMatchesSha(run: WorkflowRun, sha: string | undefined): boolean {
  return !sha || !!run.head_sha?.startsWith(sha.slice(0, 7)) || !!sha.startsWith(run.head_sha?.slice(0, 7) ?? '\0');
}

export default function DeploymentStatus({ repoUrl, token: tokenProp, triggerPoll, lastPushedSha }: DeploymentStatusProps) {
  const { settings, config } = usePlinto();
  const [storedToken, setStoredToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [jobs, setJobs] = useState<WorkflowJob[]>([]);
  const [pagesUrl, setPagesUrl] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [polling, setPolling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Resolve token from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const pat = settings.githubToken();
    if (pat) setStoredToken(pat);
  }, []);

  const token = tokenProp || storedToken;
  const parsed = parseGitHubRepo(repoUrl);

  const clearPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setPolling(false);
  };

  // Single fetch function — always uses latest refs
  const doFetch = async (): Promise<WorkflowRun | null> => {
    if (!parsed || !token) return null;
    const result = await getLatestWorkflowRun(parsed.owner, parsed.repo, token, config.git.defaultBranch);
    if (!mountedRef.current) return null;
    setRun(result);
    if (result) {
      const jobList = await getWorkflowJobs(parsed.owner, parsed.repo, token, result.id);
      if (mountedRef.current) setJobs(jobList);
    }
    return result;
  };

  // Handle fetch result — stop polling if completed AND matches our push
  const handleResult = async (result: WorkflowRun | null) => {
    if (!result || !mountedRef.current) return;
    if (result.status === 'completed') {
      // Check if this run is for our latest push
      if (runMatchesSha(result, lastPushedSha)) {
        clearPolling();
        if (result.conclusion === 'success' && parsed) {
          const url = await getGitHubPagesUrl(parsed.owner, parsed.repo, token);
          if (mountedRef.current) setPagesUrl(url);
        }
      }
      // If doesn't match, keep polling — waiting for our build to start
    }
  };

  // Start polling with interval
  const startPolling = () => {
    if (intervalRef.current) return; // already polling
    setPolling(true);
    intervalRef.current = setInterval(async () => {
      const result = await doFetch();
      await handleResult(result);
    }, 10000);
  };

  // On mount: one-shot fetch to show current state
  useEffect(() => {
    mountedRef.current = true;
    if (!parsed || !token) return;

    (async () => {
      const result = await doFetch();
      if (!mountedRef.current) return;
      if (result && (result.status === 'queued' || result.status === 'in_progress' || result.status === 'waiting')) {
        startPolling();
      } else {
        await handleResult(result);
      }
    })();

    return () => {
      mountedRef.current = false;
      clearPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.owner, parsed?.repo, token]);

  // After a push: start polling
  useEffect(() => {
    if (!parsed || !token || triggerPoll === 0) return;

    setDismissed(false);
    clearPolling();

    // Delay to let GitHub register the push
    const timeout = setTimeout(async () => {
      if (!mountedRef.current) return;
      const result = await doFetch();
      if (!mountedRef.current) return;
      if (result && (result.status === 'queued' || result.status === 'in_progress' || result.status === 'waiting')) {
        startPolling();
      } else {
        await handleResult(result);
      }
    }, 3000);

    return () => {
      clearTimeout(timeout);
      clearPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerPoll]);

  const saveToken = () => {
    if (!tokenInput.trim()) return;
    settings.setGithubToken(tokenInput.trim());
    setStoredToken(tokenInput.trim());
    setTokenInput('');
  };

  // No token — show input prompt
  if (!token) {
    return (
      <div className="px-4 py-2 flex items-center gap-2 text-sm bg-gray-50 border-b border-gray-200 text-gray-600">
        <span>GitHub PAT for deployment status:</span>
        <input
          type="password"
          value={tokenInput}
          onChange={e => setTokenInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveToken()}
          placeholder="ghp_..."
          className="border rounded px-2 py-0.5 text-sm w-64"
        />
        <button
          onClick={saveToken}
          className="bg-gray-700 text-white px-3 py-0.5 rounded text-sm hover:bg-gray-800"
        >
          Save
        </button>
      </div>
    );
  }

  // Nothing to show yet
  if (!run || dismissed) return null;

  const isActive = run.status === 'queued' || run.status === 'in_progress' || run.status === 'waiting';
  const isSuccess = run.status === 'completed' && run.conclusion === 'success';
  const isFailure = run.status === 'completed' && run.conclusion !== 'success';

  // Check if the latest run matches the user's last pushed commit
  const runMatchesPush = runMatchesSha(run, lastPushedSha);
  const buildIsStale = !runMatchesPush && (isSuccess || isFailure);

  if (!isActive && !isSuccess && !isFailure && !buildIsStale) return null;

  // Find the current active step for display
  const getProgressText = (): string => {
    if (!isActive || jobs.length === 0) return 'Deploying to GitHub Pages...';

    const activeJob = jobs.find(j => j.status === 'in_progress') || jobs.find(j => j.status === 'queued');

    if (!activeJob) {
      const waitingJob = jobs.find(j => j.status === 'waiting');
      if (waitingJob) return `Waiting: ${waitingJob.name}...`;
      return 'Deploying to GitHub Pages...';
    }

    if (activeJob.steps.length === 0) {
      return `${activeJob.name}: starting...`;
    }

    const activeStep = activeJob.steps.find(s => s.status === 'in_progress');
    const completedSteps = activeJob.steps.filter(s => s.status === 'completed').length;
    const totalSteps = activeJob.steps.length;

    if (activeStep) {
      return `${activeJob.name}: ${activeStep.name} (${completedSteps}/${totalSteps})`;
    }

    return `${activeJob.name} (${completedSteps}/${totalSteps})`;
  };

  const renderJobProgress = () => {
    if (!isActive || jobs.length === 0) return null;

    return (
      <div className="flex items-center gap-1.5 ml-2">
        {jobs.map((job) => {
          const isJobActive = job.status === 'in_progress';
          const isJobDone = job.status === 'completed' && job.conclusion === 'success';
          const isJobFailed = job.status === 'completed' && job.conclusion !== 'success';
          const isJobWaiting = job.status === 'queued' || job.status === 'waiting';

          return (
            <span
              key={job.name}
              title={`${job.name}: ${job.status}${job.conclusion ? ` (${job.conclusion})` : ''}`}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
                isJobActive
                  ? 'bg-amber-200 text-amber-900'
                  : isJobDone
                  ? 'bg-green-200 text-green-900'
                  : isJobFailed
                  ? 'bg-red-200 text-red-900'
                  : isJobWaiting
                  ? 'bg-gray-200 text-gray-600'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {isJobActive && (
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {isJobDone && '✓'}
              {isJobFailed && '✗'}
              {job.name}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={`px-4 py-2 flex items-center justify-between text-sm ${
        isActive || buildIsStale
          ? 'bg-amber-50 text-amber-800 border-b border-amber-200'
          : isSuccess
          ? 'bg-green-50 text-green-800 border-b border-green-200'
          : 'bg-red-50 text-red-800 border-b border-red-200'
      }`}
    >
      <div className="flex items-center gap-2">
        {isActive && (
          <>
            <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>{getProgressText()}</span>
            {renderJobProgress()}
          </>
        )}
        {isSuccess && !buildIsStale && (
          <>
            <span>Site published</span>
            {pagesUrl && (
              <a
                href={pagesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline font-medium"
              >
                {pagesUrl}
              </a>
            )}
          </>
        )}
        {buildIsStale && (
          <>
            <svg className="animate-spin h-4 w-4 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Waiting for build to start for your latest push...</span>
          </>
        )}
        {isFailure && (
          <>
            <span>Deployment failed</span>
            <a
              href={run.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline font-medium"
            >
              View run
            </a>
          </>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-current opacity-60 hover:opacity-100 ml-4"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
