import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGenerationJobStore } from "../src/generation/jobs/createJobStore.js";
import { runOpenCodeJob, type OpenCodeJobParams } from "../src/generation/runners/opencodeRunner.js";
import { runProcess } from "../src/generation/runners/processRunner.js";

describe("processRunner", () => {
  it("passes stdin and reports stdout and stderr logs", async () => {
    const logs: string[] = [];

    await runProcess({
      cwd: process.cwd(),
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdin.setEncoding('utf8');",
          "let input = '';",
          "process.stdin.on('data', chunk => input += chunk);",
          "process.stdin.on('end', () => {",
          "  process.stdout.write(`stdout:${input}`);",
          "  process.stderr.write('stderr:done');",
          "});",
        ].join(""),
      ],
      stdin: "hello",
      onLog: (message) => logs.push(message),
    });

    expect(logs).toContain("stdout:hello");
    expect(logs).toContain("stderr:done");
  });

  it("rejects when the process exits with a non-zero code", async () => {
    await expect(runProcess({
      cwd: process.cwd(),
      command: process.execPath,
      args: ["-e", "process.exit(7);"],
    })).rejects.toThrow(`${process.execPath} exited with code 7`);
  });
});

describe("runOpenCodeJob validation retry", () => {
  it("retries once on validation errors and finishes clean when the retry passes", async () => {
    const { store, params, validateResults } = await setupJob();
    validateResults.push(["Summary длиннее лимита"], []);

    await runOpenCodeJob(params);

    const job = store.getJob(params.jobId);
    expect(job?.status).toBe("success");
    expect(job?.warning).toBeUndefined();
    expect(job?.logs).toContain("Validation failed (1); retrying once with corrections");
    expect(job?.logs).toContain("Validation passed after retry");
    expect(validateResults).toHaveLength(0);
  });

  it("finishes as success with a warning when validation keeps failing", async () => {
    const { store, params, validateResults } = await setupJob();
    validateResults.push(["нет секции Summary"], ["нет секции Summary"]);

    await runOpenCodeJob(params);

    const job = store.getJob(params.jobId);
    expect(job?.status).toBe("success");
    expect(job?.warning).toContain("Validation failed: нет секции Summary");
  });

  it("skips retry machinery when validation passes immediately", async () => {
    const { store, params, validateResults } = await setupJob();
    validateResults.push([]);

    await runOpenCodeJob(params);

    const job = store.getJob(params.jobId);
    expect(job?.status).toBe("success");
    expect(job?.warning).toBeUndefined();
    expect(validateResults).toHaveLength(0);
  });

  it("finalizes only a validated target", async () => {
    const valid = await setupJob();
    let validFinalizations = 0;
    valid.validateResults.push([]);
    valid.params.finalizeTarget = async () => {
      validFinalizations += 1;
    };

    await runOpenCodeJob(valid.params);
    expect(validFinalizations).toBe(1);

    const invalid = await setupJob();
    let invalidFinalizations = 0;
    invalid.validateResults.push(["invalid"], ["still invalid"]);
    invalid.params.finalizeTarget = async () => {
      invalidFinalizations += 1;
    };

    await runOpenCodeJob(invalid.params);
    expect(invalidFinalizations).toBe(0);
  });
});

async function setupJob() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-runner-"));
  const store = createGenerationJobStore<Record<string, never>>("test-job");
  const job = store.createJob({});
  const validateResults: string[][] = [];

  const params: OpenCodeJobParams = {
    projectRoot,
    prompt: "prompt",
    jobId: job.id,
    generator: {
      type: "opencode" as const,
      command: process.execPath,
      args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"],
    },
    hooks: {
      markJobRunning: store.markJobRunning,
      appendJobLog: store.appendJobLog,
      markJobSuccess: store.markJobSuccess,
      markJobError: store.markJobError,
    },
    startLog: "start",
    successLog: "done",
    verifyTarget: async () => {},
    validateTarget: async () => validateResults.shift() ?? [],
    buildRetryPrompt: (errors) => `retry: ${errors.join(", ")}`,
  };

  return { store, params, validateResults };
}
