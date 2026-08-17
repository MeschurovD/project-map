#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { startDevServer } from "../dev/startDevServer.js";
import { runScan } from "../scan/runScan.js";
import { openProject } from "./openProject.js";

const program = new Command();

program
  .name("project-map")
  .description("Static semantic project map for React/FSD/Redux codebases")
  .version("0.1.0");

program
  .command("open [project-root]")
  .description("Analyze a project if needed and open the visual explorer")
  .option("-p, --project-root <path>", "Project root to explore")
  .option("--host <host>", "Explorer host", "127.0.0.1")
  .option("--port <port>", "Explorer port", parsePort, 3000)
  .option("--no-scan", "Do not repair missing, stale, or incompatible artifacts")
  .option("--no-open", "Print the URL without opening a browser")
  .action(async (
    projectRootArgument: string | undefined,
    options: {
      projectRoot?: string;
      host: string;
      port: number;
      scan: boolean;
      open: boolean;
    }
  ) => {
    const { server } = await openProject({
      projectRoot: options.projectRoot ?? projectRootArgument ?? process.cwd(),
      host: options.host,
      port: options.port,
      scan: options.scan,
      openBrowser: options.open,
    });
    await waitForShutdown(async () => {
      await server.close();
    });
  });

program
  .command("scan")
  .description("Scan a project and write .project-map artifacts")
  .option("-p, --project-root <path>", "Project root to scan", process.cwd())
  .action(async (options: { projectRoot: string }) => {
    const projectRoot = path.resolve(options.projectRoot);
    const result = await runScan({ projectRoot });
    console.log(
      `project-map scan complete: ${result.stats.filesCount} files, ` +
        `${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges`
    );
  });

program
  .command("dev")
  .description("Start local visual explorer")
  .option("-p, --project-root <path>", "Project root with .project-map artifacts", process.cwd())
  .option("--host <host>", "Dev server host", "127.0.0.1")
  .option("--port <port>", "Dev server port", parsePort, 3000)
  .action(async (options: { projectRoot: string; host: string; port: number }) => {
    const { server } = await startDevServer({
      projectRoot: path.resolve(options.projectRoot),
      host: options.host,
      port: options.port,
    });
    await waitForShutdown(async () => {
      await server.close();
    });
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function parsePort(value: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

function waitForShutdown(onShutdown: () => Promise<void>) {
  return new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      void onShutdown().finally(resolve);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
