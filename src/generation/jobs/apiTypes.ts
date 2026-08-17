import type { GenerationJobStatus } from "./types.js";

export type StartGenerationJobResponse<TStatus extends "pending" | "running" = "running"> = {
  jobId: string;
  status: TStatus;
};

export type GenerationJobResponse<TMetadata extends Record<string, unknown>> = TMetadata & {
  jobId: string;
  id?: string;
  status: GenerationJobStatus;
  startedAt: string;
  finishedAt?: string;
  logs: string[];
  error?: string;
  /** Set when the job finished but post-generation validation kept failing. */
  warning?: string;
};
