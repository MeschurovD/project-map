import type { GenerationJob } from "./types.js";

// Finished jobs are kept for late polling, then evicted so the in-memory
// store cannot grow without bound over a long dev-server session.
const FINISHED_JOB_TTL_MS = 30 * 60 * 1000;
const MAX_FINISHED_JOBS = 50;

export function createGenerationJobStore<TMetadata extends Record<string, unknown>>(idPrefix: string) {
  const jobs = new Map<string, GenerationJob<TMetadata>>();

  function createJob(metadata: TMetadata): GenerationJob<TMetadata> {
    evictFinishedJobs();
    const id = `${idPrefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const job = {
      ...metadata,
      id,
      status: "pending",
      startedAt: new Date().toISOString(),
      logs: [],
    } satisfies GenerationJob<TMetadata>;
    jobs.set(id, job);
    return job;
  }

  function markJobRunning(jobId: string) {
    requireJob(jobId).status = "running";
  }

  function appendJobLog(jobId: string, message: string) {
    requireJob(jobId).logs.push(redactLog(message));
  }

  function markJobSuccess(jobId: string, warning?: string) {
    const job = requireJob(jobId);
    job.status = "success";
    if (warning) job.warning = redactLog(warning);
    job.finishedAt = new Date().toISOString();
  }

  function markJobError(jobId: string, error: string) {
    const job = requireJob(jobId);
    job.status = "error";
    job.error = redactLog(error);
    job.finishedAt = new Date().toISOString();
  }

  function getJob(jobId: string) {
    return jobs.get(jobId);
  }

  function requireJob(jobId: string) {
    const job = jobs.get(jobId);
    if (!job) throw new Error(`Generation job not found: ${jobId}`);
    return job;
  }

  function evictFinishedJobs() {
    const now = Date.now();
    const finished = Array.from(jobs.values())
      .filter((job) => job.finishedAt)
      .sort((left, right) => Date.parse(left.finishedAt ?? "") - Date.parse(right.finishedAt ?? ""));

    for (const [index, job] of finished.entries()) {
      const expired = now - Date.parse(job.finishedAt ?? "") > FINISHED_JOB_TTL_MS;
      const overCap = finished.length - index > MAX_FINISHED_JOBS;
      if (expired || overCap) jobs.delete(job.id);
    }
  }

  return {
    createJob,
    markJobRunning,
    appendJobLog,
    markJobSuccess,
    markJobError,
    getJob,
  };
}

function redactLog(message: string) {
  return message
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*)=([^\s]+)/gi, "$1=[redacted]")
    .slice(0, 4000);
}
