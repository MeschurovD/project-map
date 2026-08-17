import fs from "node:fs/promises";
import path from "node:path";
import type { GeneratorConfig } from "../../config/types.js";
import { runProcess } from "./processRunner.js";

/** Job lifecycle callbacks a module supplies from its own job store. */
export type GenerationJobHooks = {
  markJobRunning: (jobId: string) => void;
  appendJobLog: (jobId: string, message: string) => void;
  markJobSuccess: (jobId: string, warning?: string) => void;
  markJobError: (jobId: string, error: string) => void;
};

export type OpenCodeJobParams = {
  projectRoot: string;
  prompt: string;
  jobId: string;
  generator: GeneratorConfig;
  hooks: GenerationJobHooks;
  /** Message logged when the job starts (module-specific wording). */
  startLog: string;
  /** Message logged after the target file is verified. */
  successLog: string;
  /** Module-specific check that the expected output file now exists. */
  verifyTarget: () => Promise<void>;
  /**
   * Optional content validation run after verifyTarget. A non-empty error
   * list triggers one corrective retry (buildRetryPrompt); if the retry still
   * fails validation, the job finishes as success with a warning — the file
   * stays on disk, consumers decide what to skip.
   */
  validateTarget?: () => Promise<string[]>;
  buildRetryPrompt?: (errors: string[]) => string;
  /** Commit a validated temporary result to its final destination. */
  finalizeTarget?: () => Promise<void>;
};

/**
 * Shared OpenCode generation workflow: mark the job running, persist the
 * prompt, run the generator, verify the produced file, and record the result.
 * Module-specific concerns (target verification, log wording, which job store)
 * are passed in by the caller.
 */
export async function runOpenCodeJob(params: OpenCodeJobParams): Promise<void> {
  const { hooks, jobId } = params;
  hooks.markJobRunning(jobId);
  hooks.appendJobLog(jobId, params.startLog);

  try {
    const jobDir = path.join(params.projectRoot, ".project-map", "jobs", jobId);
    await fs.mkdir(jobDir, { recursive: true });
    const promptPath = path.join(jobDir, "prompt.md");
    await fs.writeFile(promptPath, params.prompt, "utf8");
    hooks.appendJobLog(jobId, "Writing prompt file");
    hooks.appendJobLog(jobId, "Running opencode");

    await runGenerator(params, params.prompt);
    await params.verifyTarget();

    const warning = await validateWithOneRetry(params);
    if (!warning && params.finalizeTarget) {
      await params.finalizeTarget();
    }
    hooks.appendJobLog(jobId, params.successLog);
    hooks.markJobSuccess(jobId, warning);
  } catch (error) {
    hooks.markJobError(jobId, error instanceof Error ? error.message : String(error));
  }
}

async function validateWithOneRetry(params: OpenCodeJobParams): Promise<string | undefined> {
  const { hooks, jobId } = params;
  if (!params.validateTarget) return undefined;

  const errors = await params.validateTarget();
  if (errors.length === 0) return undefined;

  if (!params.buildRetryPrompt) {
    return validationWarning(errors);
  }

  hooks.appendJobLog(jobId, `Validation failed (${errors.length}); retrying once with corrections`);
  await runGenerator(params, params.buildRetryPrompt(errors));
  await params.verifyTarget();

  const retryErrors = await params.validateTarget();
  if (retryErrors.length === 0) {
    hooks.appendJobLog(jobId, "Validation passed after retry");
    return undefined;
  }
  return validationWarning(retryErrors);
}

function validationWarning(errors: string[]) {
  return `Validation failed: ${errors.join(" | ")}`;
}

function runGenerator(params: OpenCodeJobParams, prompt: string) {
  return runProcess({
    cwd: params.projectRoot,
    command: params.generator.command,
    args: params.generator.args,
    stdin: prompt,
    env: {
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    },
    failureLabel: "OpenCode",
    onLog: (message) => params.hooks.appendJobLog(params.jobId, message),
  });
}
