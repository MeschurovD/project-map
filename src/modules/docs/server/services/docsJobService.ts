import { createGenerationJobStore } from "../../../../generation/jobs/createJobStore.js";
import type { DocsJobMetadata } from "./docsTypes.js";

const jobs = createGenerationJobStore<DocsJobMetadata>("docs-job");

export function createDocsJob(params: DocsJobMetadata) {
  return jobs.createJob(params);
}

export function markJobRunning(jobId: string) {
  jobs.markJobRunning(jobId);
}

export function appendJobLog(jobId: string, message: string) {
  jobs.appendJobLog(jobId, message);
}

export function markJobSuccess(jobId: string) {
  jobs.markJobSuccess(jobId);
}

export function markJobError(jobId: string, error: string) {
  jobs.markJobError(jobId, error);
}

export function getDocsJob(jobId: string) {
  return jobs.getJob(jobId);
}
