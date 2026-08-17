export type GenerationJobStatus = "pending" | "running" | "success" | "error";

export type GenerationJob<TMetadata extends Record<string, unknown>> = TMetadata & {
  id: string;
  status: GenerationJobStatus;
  startedAt: string;
  finishedAt?: string;
  logs: string[];
  error?: string;
  /** Set when the job finished but post-generation validation kept failing. */
  warning?: string;
};
