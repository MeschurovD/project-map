import { createGenerationJobStore } from "../../../../generation/jobs/createJobStore.js";
import type { E2eGenerationTarget } from "../../shared/apiTypes.js";

export type E2eJobMetadata = {
  nodeId: string;
  target: E2eGenerationTarget;
  targetPath: string;
};

const jobs = createGenerationJobStore<E2eJobMetadata>("e2e-job");

export function createE2eJob(params: E2eJobMetadata) {
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

export function getE2eJob(jobId: string) {
  return jobs.getJob(jobId);
}
