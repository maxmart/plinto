/**
import { usePlinto } from './context';
 * GitHub API utilities for deployment status tracking.
 */

export interface WorkflowRun {
  id: number;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  html_url: string;
  created_at: string;
  head_sha: string;
}

export interface JobStep {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
}

export interface WorkflowJob {
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  steps: JobStep[];
}

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github.v3+json',
});

/**
 * Fetch the latest workflow run for push events on the configured branch.
 */
export async function getLatestWorkflowRun(
  owner: string,
  repo: string,
  token: string,
  branch: string,
): Promise<WorkflowRun | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${branch}&event=push&per_page=1`,
      { headers: ghHeaders(token), cache: 'no-store' }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const run = data.workflow_runs?.[0];
    if (!run) return null;

    return {
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url,
      created_at: run.created_at,
      head_sha: run.head_sha,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch jobs (with steps) for a specific workflow run.
 */
export async function getWorkflowJobs(
  owner: string,
  repo: string,
  token: string,
  runId: number
): Promise<WorkflowJob[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
      { headers: ghHeaders(token), cache: 'no-store' }
    );

    if (!response.ok) return [];

    const data = await response.json();
    return (data.jobs || []).map((job: Record<string, unknown>) => ({
      name: job.name as string,
      status: job.status as string,
      conclusion: job.conclusion as string | null,
      steps: ((job.steps as Record<string, unknown>[]) || []).map((step) => ({
        name: step.name as string,
        status: step.status as string,
        conclusion: step.conclusion as string | null,
      })),
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch the GitHub Pages URL for a repository.
 */
export async function getGitHubPagesUrl(
  owner: string,
  repo: string,
  token: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pages`,
      { headers: ghHeaders(token) }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.html_url || `https://${owner}.github.io/${repo}/`;
  } catch {
    // Fallback: construct from convention
    return `https://${owner}.github.io/${repo}/`;
  }
}
