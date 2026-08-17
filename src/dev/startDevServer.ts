import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer, type Connect, type Plugin } from "vite";
import { assessArtifactDirectory } from "../artifacts/status.js";
import { loadConfig } from "../config/loadConfig.js";
import type { ResolvedProjectMapConfig } from "../config/types.js";
import type { ProjectMapGraph } from "../graph/types.js";
import { projectMapServerModules } from "../modules/registry.js";
import { buildMergedEnrichment } from "../modules/server/buildMergedEnrichment.js";
import { runScan } from "../scan/runScan.js";
import { FLOW_SCHEMA_VERSION } from "../flow/types.js";
import { readFlowIndexIfPresent } from "./services/flowStore.js";
import { readGraph } from "./services/graphStore.js";
import { sourceRoutes } from "./sourceRoutes.js";

export type DevServerOptions = {
  projectRoot: string;
  host?: string;
  port?: number;
};

type JsonResponse = ProjectMapGraph | Record<string, unknown> | unknown[];

export async function startDevServer(options: DevServerOptions) {
  const projectRoot = path.resolve(options.projectRoot);
  const config = await loadConfig(projectRoot);
  const uiRoot = await resolveUiRoot();
  const server = await createServer({
    root: uiRoot,
    plugins: [projectMapApiPlugin(config), react()],
    server: {
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 3000,
      strictPort: false,
      fs: {
        allow: [uiRoot, projectRoot],
      },
    },
    define: {
      __PROJECT_ROOT__: JSON.stringify(projectRoot),
    },
  });

  try {
    await server.listen();
  } catch (error) {
    await server.close();
    throw error;
  }
  const urls = server.resolvedUrls?.local ?? [];
  const url = urls[0] ?? `http://127.0.0.1:${options.port ?? 3000}/`;
  console.log(`project-map dev server running at ${url}`);

  return {
    server,
    url,
  };
}

function projectMapApiPlugin(config: ResolvedProjectMapConfig): Plugin {
  return {
    name: "project-map-api",
    configureServer(server) {
      const projectRoot = config.projectRoot;
      server.middlewares.use("/api/graph", artifactMiddleware(projectRoot, "graph.json"));
      server.middlewares.use("/api/facts", artifactMiddleware(projectRoot, "facts.json"));
      server.middlewares.use("/api/flows", artifactMiddleware(projectRoot, "flows.json", FLOW_SCHEMA_VERSION));
      server.middlewares.use("/api/stats", artifactMiddleware(projectRoot, "stats.json"));
      server.middlewares.use("/api/unresolved", artifactMiddleware(projectRoot, "unresolved.json"));
      server.middlewares.use("/api/artifacts/status", artifactStatusMiddleware(projectRoot));
      server.middlewares.use("/api/scan", scanMiddleware(projectRoot));
      server.middlewares.use("/api/enrichment", enrichmentMiddleware(config));
      for (const module of projectMapServerModules) {
        for (const route of module.registerRoutes({ config, projectRoot })) {
          server.middlewares.use(route);
        }
      }
      server.middlewares.use(sourceRoutes(projectRoot));
    },
  };
}

export function artifactMiddleware(
  projectRoot: string,
  fileName: string,
  expectedSchemaVersion?: string
): Connect.NextHandleFunction {
  return async (_request, response) => {
    const artifactPath = path.join(projectRoot, ".project-map", fileName);

    let raw: string;
    try {
      raw = await fs.readFile(artifactPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        // The project has not been scanned yet (or was scanned elsewhere).
        sendJson(response, 404, {
          error: `.project-map/${fileName} not found`,
          message: 'Run "project-map scan" to generate the artifacts.',
        });
        return;
      }
      // Permission denied, path is a directory, etc.
      sendJson(response, 500, {
        error: `Cannot read .project-map/${fileName}`,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    try {
      const artifact = JSON.parse(raw) as JsonResponse;
      if (expectedSchemaVersion) {
        const actualSchemaVersion = schemaVersionOf(artifact);
        if (actualSchemaVersion !== expectedSchemaVersion) {
          sendJson(response, 409, {
            error: `.project-map/${fileName} has incompatible schema`,
            expectedSchemaVersion,
            actualSchemaVersion,
          });
          return;
        }
      }
      sendJson(response, 200, artifact);
    } catch (error) {
      // The file exists but is not valid JSON (truncated or corrupt artifact).
      sendJson(response, 500, {
        error: `.project-map/${fileName} is not valid JSON`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

export function artifactStatusMiddleware(projectRoot: string): Connect.NextHandleFunction {
  return async (_request, response) => {
    try {
      sendJson(response, 200, await assessArtifactDirectory(projectRoot));
    } catch (error) {
      sendJson(response, 500, {
        error: "Cannot assess artifact status",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function schemaVersionOf(value: JsonResponse): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof schemaVersion === "string" ? schemaVersion : null;
}

// Re-runs the scan and rewrites the artifacts the other endpoints serve.
// Concurrent requests share one in-flight scan instead of starting another.
function scanMiddleware(projectRoot: string): Connect.NextHandleFunction {
  let inFlight: Promise<Awaited<ReturnType<typeof runScan>>> | null = null;

  return async (request, response) => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Use POST /api/scan" });
      return;
    }

    const scan = inFlight ?? runScan({ projectRoot });
    inFlight = scan;
    try {
      const result = await scan;
      sendJson(response, 200, { ok: true, stats: result.stats });
    } catch (error) {
      sendJson(response, 500, {
        error: "Scan failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (inFlight === scan) inFlight = null;
    }
  };
}

// Serves the combined enrichment overlay of all modules. Built per request:
// it depends on the current graph and module state (e.g. which .docs.md files
// exist right now), and both change with every rescan.
function enrichmentMiddleware(config: ResolvedProjectMapConfig): Connect.NextHandleFunction {
  return async (_request, response) => {
    let graph: ProjectMapGraph;
    try {
      graph = await readGraph(config.projectRoot);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        sendJson(response, 404, {
          error: ".project-map/graph.json not found",
          message: 'Run "project-map scan" to generate the artifacts.',
        });
        return;
      }
      sendJson(response, 500, {
        error: "Cannot read .project-map/graph.json",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const enrichment = await buildMergedEnrichment(projectMapServerModules, {
      config,
      projectRoot: config.projectRoot,
      graph,
      flowIndex: await readFlowIndexIfPresent(config.projectRoot),
    });
    sendJson(response, 200, enrichment);
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function resolveUiRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.PROJECT_MAP_UI_ROOT,
    path.resolve(here, "../ui"),
    path.resolve(here, "../../src/ui"),
    path.resolve(process.cwd(), "src/ui"),
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, "index.html"));
      return candidate;
    } catch {
      // Try the next known layout.
    }
  }

  throw new Error("Cannot find project-map UI root");
}
