import type { GeneratorConfig } from "../../../../config/types.js";
import { runOpenCodeJob } from "../../../../generation/runners/opencodeRunner.js";
import { appendJobLog, markJobError, markJobRunning, markJobSuccess } from "./e2eJobService.js";
import { e2eFileStat } from "./e2eFileService.js";

export function runOpenCodeE2eJob(params: {
  projectRoot: string;
  prompt: string;
  targetPath: string;
  jobId: string;
  generator: GeneratorConfig;
}): Promise<void> {
  return runOpenCodeJob({
    projectRoot: params.projectRoot,
    prompt: params.prompt,
    jobId: params.jobId,
    generator: params.generator,
    hooks: { markJobRunning, appendJobLog, markJobSuccess, markJobError },
    startLog: "Building e2e context",
    successLog: "E2E target file created",
    verifyTarget: async () => {
      await e2eFileStat(params.projectRoot, params.targetPath);
    },
  });
}
