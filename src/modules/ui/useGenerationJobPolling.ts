import { useEffect } from "react";
import { fetchJson } from "./apiClient.js";

export type PollableGenerationJob = {
  jobId: string;
  status: "pending" | "running" | "success" | "error";
  error?: string;
};

export function useGenerationJobPolling<TJob extends PollableGenerationJob>(options: {
  job: TJob | null;
  enabled?: boolean;
  buildJobUrl: (jobId: string) => string;
  intervalMs?: number;
  onJob: (job: TJob) => void;
  onSuccess: (job: TJob) => void;
  onError: (job: TJob) => void;
  onRequestError: (error: unknown) => void;
}) {
  useEffect(() => {
    if (options.enabled === false) return;
    if (!options.job || !isPendingJob(options.job)) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      fetchJson<TJob>(options.buildJobUrl(options.job!.jobId))
        .then((nextJob) => {
          if (cancelled) return;

          options.onJob(nextJob);
          if (nextJob.status === "success") options.onSuccess(nextJob);
          if (nextJob.status === "error") options.onError(nextJob);
        })
        .catch((error) => {
          if (!cancelled) options.onRequestError(error);
        });
    }, options.intervalMs ?? 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [options]);
}

function isPendingJob(job: PollableGenerationJob) {
  return job.status === "running" || job.status === "pending";
}
