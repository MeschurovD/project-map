import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { ResolvedProjectMapConfig } from "../../config/types.js";
import type { ProjectMapGraph } from "../../graph/types.js";
import { readGraph } from "../../dev/services/graphStore.js";
import { decodeRouteId, ensureMethod, readJsonBody, sendJson, splitNodeRoute, statusCodeForError } from "./http.js";

/** Request body shared by every generation module's prompt/generate actions. */
export type GenerationPromptRequest = {
  selectedContextIds?: string[];
  userComment?: string;
};

/** Per-request context handed to a generation module's action handlers. */
export type NodeActionContext = {
  config: ResolvedProjectMapConfig;
  graph: ProjectMapGraph;
  nodeId: string;
  url: URL;
  request: IncomingMessage;
  response: ServerResponse;
};

type JobRecord = { id: string } & Record<string, unknown>;

/**
 * Declarative description of a generation module's HTTP surface. The shared
 * skeleton owns routing (prefix guard, jobs route, node/action split, graph
 * read, error wrapper) and the common status/context/prompt/generate actions;
 * the module supplies only what differs.
 */
export type GenerationRouteModule<
  TBody extends GenerationPromptRequest,
  TPromptResponse extends { prompt: string },
> = {
  /** API namespace, e.g. "docs" -> /api/docs/*. */
  namespace: string;
  errorLabel: string;
  jobNotFoundLabel: string;
  disabledMessage: string;
  getJob: (jobId: string) => JobRecord | undefined;
  getStatus: (ctx: NodeActionContext) => Promise<unknown>;
  getContext: (ctx: NodeActionContext) => Promise<unknown>;
  buildPromptResponse: (ctx: NodeActionContext, body: TBody) => Promise<TPromptResponse>;
  isEnabled: (config: ResolvedProjectMapConfig) => boolean;
  /** Create the job and kick off the generator; returns the new job id. */
  startGeneration: (
    ctx: NodeActionContext,
    promptResponse: TPromptResponse
  ) => string | Promise<string>;
  /** Handle module-specific actions (e.g. read a generated file). */
  handleExtraAction?: (action: string, ctx: NodeActionContext) => Promise<boolean>;
};

export function createGenerationRoutes<
  TBody extends GenerationPromptRequest,
  TPromptResponse extends { prompt: string },
>(
  config: ResolvedProjectMapConfig,
  module: GenerationRouteModule<TBody, TPromptResponse>
): Connect.NextHandleFunction {
  const apiPrefix = `/api/${module.namespace}/`;
  const jobsPrefix = `/api/${module.namespace}/jobs/`;
  const nodePrefix = `/api/${module.namespace}/node/`;

  return async (request, response, next) => {
    if (!request.url?.startsWith(apiPrefix)) {
      next();
      return;
    }

    try {
      const url = new URL(request.url, "http://project-map.local");

      if (url.pathname.startsWith(jobsPrefix)) {
        ensureMethod(request, "GET");
        const jobId = decodeRouteId(url.pathname, jobsPrefix);
        const job = module.getJob(jobId);
        if (!job) throw Object.assign(new Error(`${module.jobNotFoundLabel}: ${jobId}`), { statusCode: 404 });
        sendJson(response, 200, { jobId: job.id, ...job });
        return;
      }

      if (!url.pathname.startsWith(nodePrefix)) {
        next();
        return;
      }

      const rest = url.pathname.slice(nodePrefix.length);
      const [encodedNodeId, action] = splitNodeRoute(rest);
      const nodeId = decodeURIComponent(encodedNodeId);
      const graph = await readGraph(config.projectRoot);
      const ctx: NodeActionContext = { config, graph, nodeId, url, request, response };

      if (action === "status") {
        ensureMethod(request, "GET");
        sendJson(response, 200, await module.getStatus(ctx));
        return;
      }

      if (action === "context") {
        ensureMethod(request, "GET");
        sendJson(response, 200, await module.getContext(ctx));
        return;
      }

      if (action === "prompt") {
        ensureMethod(request, "POST");
        const body = await readJsonBody<TBody>(request);
        sendJson(response, 200, await module.buildPromptResponse(ctx, body));
        return;
      }

      if (action === "generate") {
        ensureMethod(request, "POST");
        if (!module.isEnabled(config)) throw Object.assign(new Error(module.disabledMessage), { statusCode: 403 });
        const body = await readJsonBody<TBody>(request);
        const promptResponse = await module.buildPromptResponse(ctx, body);
        const jobId = await module.startGeneration(ctx, promptResponse);
        sendJson(response, 200, { jobId, status: "running" });
        return;
      }

      if (module.handleExtraAction && (await module.handleExtraAction(action, ctx))) {
        return;
      }

      next();
    } catch (error) {
      sendJson(response, statusCodeForError(error), {
        error: module.errorLabel,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
