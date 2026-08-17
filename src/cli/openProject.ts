import { spawn } from "node:child_process";
import path from "node:path";
import { assessArtifactDirectory } from "../artifacts/status.js";
import type { ArtifactHealth } from "../artifacts/types.js";
import { startDevServer } from "../dev/startDevServer.js";
import { runScan } from "../scan/runScan.js";

export type OpenProjectOptions = {
  projectRoot: string;
  host?: string;
  port?: number;
  scan?: boolean;
  openBrowser?: boolean;
  log?: (message: string) => void;
};

type OpenProjectDependencies = {
  assessArtifacts: typeof assessArtifactDirectory;
  scanProject: typeof runScan;
  startServer: typeof startDevServer;
  launchBrowser: (url: string) => void;
};

const defaultDependencies: OpenProjectDependencies = {
  assessArtifacts: assessArtifactDirectory,
  scanProject: runScan,
  startServer: startDevServer,
  launchBrowser,
};

/**
 * User-facing explorer entry point: repair artifacts when possible, then serve
 * the project. Dependencies are injectable so the orchestration contract can
 * be tested without starting Vite or a real browser.
 */
export async function openProject(
  options: OpenProjectOptions,
  dependencies: OpenProjectDependencies = defaultDependencies
) {
  const projectRoot = path.resolve(options.projectRoot);
  const log = options.log ?? console.log;
  const initialHealth = await dependencies.assessArtifacts(projectRoot);
  const shouldScan = initialHealth.status !== "fresh" && options.scan !== false;

  if (shouldScan) {
    log(scanMessage(initialHealth));
    const result = await dependencies.scanProject({ projectRoot });
    log(
      `Analysis ready: ${result.stats.filesCount} files, ` +
      `${result.graph.nodes.length} nodes, ${result.flowIndex.flows.length} value traces.`
    );
  } else if (initialHealth.status !== "fresh") {
    log(`Analysis is ${initialHealth.status}; starting without repair because --no-scan was used.`);
  }

  const started = await dependencies.startServer({
    projectRoot,
    host: options.host,
    port: options.port,
  });
  log(`Explorer ready at ${started.url}`);

  if (options.openBrowser !== false) {
    dependencies.launchBrowser(started.url);
  }

  return {
    ...started,
    initialHealth,
    scanned: shouldScan,
  };
}

function scanMessage(health: ArtifactHealth) {
  if (health.status === "incompatible") {
    return "The analysis format changed. Rebuilding project analysis…";
  }
  if (health.reasons.some((reason) => reason.code === "manifest-missing")) {
    return "Running the first project analysis…";
  }
  return "Project sources or analysis artifacts changed. Refreshing analysis…";
}

function launchBrowser(url: string) {
  const command = process.platform === "darwin"
    ? { executable: "open", args: [url] }
    : process.platform === "win32"
      ? { executable: "cmd", args: ["/c", "start", "", url] }
      : { executable: "xdg-open", args: [url] };

  const child = spawn(command.executable, command.args, {
    detached: true,
    stdio: "ignore",
  });
  child.once("error", () => {
    // The printed URL remains a complete fallback in headless environments.
  });
  child.unref();
}
