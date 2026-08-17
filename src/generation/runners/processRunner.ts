import { spawn } from "node:child_process";

export type ProcessRunnerOptions = {
  cwd: string;
  command: string;
  args?: string[];
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  failureLabel?: string;
  onLog?: (message: string) => void;
};

export function runProcess(options: ProcessRunnerOptions) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...options.env,
      },
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => emitLog(options, chunk));
    child.stderr.on("data", (chunk) => emitLog(options, chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${options.failureLabel ?? options.command} exited with code ${code}`));
    });

    child.stdin.end(options.stdin ?? "");
  });
}

function emitLog(options: ProcessRunnerOptions, chunk: unknown) {
  const message = String(chunk).trim();
  if (message) options.onLog?.(message);
}
