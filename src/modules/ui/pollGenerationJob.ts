import { fetchJson } from "./apiClient.js";
import type { PollableGenerationJob } from "./useGenerationJobPolling.js";

/**
 * Promise-based counterpart to {@link useGenerationJobPolling}: polls a job
 * until it reaches a terminal state and resolves with the final record. Used by
 * orchestration loops (e.g. the docs queue) where a React hook doesn't fit.
 */
export async function pollGenerationJob<TJob extends PollableGenerationJob>(options: {
  jobId: string;
  buildJobUrl: (jobId: string) => string;
  intervalMs?: number;
  onJob?: (job: TJob) => void;
}): Promise<TJob> {
  const intervalMs = options.intervalMs ?? 1500;
  for (;;) {
    const job = await fetchJson<TJob>(options.buildJobUrl(options.jobId));
    options.onJob?.(job);
    if (job.status === "success" || job.status === "error") return job;
    await delay(intervalMs);
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
