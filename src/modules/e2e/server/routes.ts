import type { Connect } from "vite";
import type { ResolvedProjectMapConfig } from "../../../config/types.js";
import type { ProjectMapGraph } from "../../../graph/types.js";
import { ensureMethod, sendJson } from "../../server/http.js";
import { createGenerationRoutes, type GenerationPromptRequest, type NodeActionContext } from "../../server/generationRoutes.js";
import { selectContextItems } from "../../server/selectContextItems.js";
import type { E2eGenerationTarget } from "../shared/apiTypes.js";
import { buildE2eContextForNode } from "./services/e2eContextService.js";
import { readE2eFile } from "./services/e2eFileService.js";
import { createE2eJob, getE2eJob } from "./services/e2eJobService.js";
import { resolveComponentE2eTargets, resolveE2eTargetPath } from "./services/e2ePathResolver.js";
import { buildE2ePrompt } from "./services/e2ePromptService.js";
import { getE2eStatusForNode, getGraphNode } from "./services/e2eStatusService.js";
import { runOpenCodeE2eJob } from "./services/opencodeRunner.js";

type E2ePromptRequest = GenerationPromptRequest & {
  target?: E2eGenerationTarget;
};

type E2ePromptResponse = {
  nodeId: string;
  target: E2eGenerationTarget;
  targetPath: string;
  prompt: string;
  includedFiles: string[];
};

export function e2eRoutes(config: ResolvedProjectMapConfig): Connect.NextHandleFunction {
  return createGenerationRoutes<E2ePromptRequest, E2ePromptResponse>(config, {
    namespace: "e2e",
    errorLabel: "E2E request failed",
    jobNotFoundLabel: "E2E job not found",
    disabledMessage: "E2E generation is disabled",
    getJob: getE2eJob,
    getStatus: (ctx) => getE2eStatusForNode({ graph: ctx.graph, nodeId: ctx.nodeId, projectRoot: ctx.config.projectRoot }),
    getContext: (ctx) => buildE2eContextForNode({
      graph: ctx.graph,
      nodeId: ctx.nodeId,
      projectRoot: ctx.config.projectRoot,
      target: parseTarget(ctx.url.searchParams.get("target")),
    }),
    isEnabled: (config) => config.e2e.enabled,
    buildPromptResponse: buildE2ePromptResponse,
    startGeneration: (ctx, promptResponse) => {
      const job = createE2eJob({
        nodeId: ctx.nodeId,
        target: promptResponse.target,
        targetPath: promptResponse.targetPath,
      });
      void runOpenCodeE2eJob({
        projectRoot: ctx.config.projectRoot,
        prompt: promptResponse.prompt,
        targetPath: promptResponse.targetPath,
        jobId: job.id,
        generator: ctx.config.e2e.generator,
      });
      return job.id;
    },
    handleExtraAction: async (action, ctx) => {
      if (action !== "page-object" && action !== "po-spec") return false;
      ensureMethod(ctx.request, "GET");
      sendJson(ctx.response, 200, await readTargetFile({
        config: ctx.config,
        graph: ctx.graph,
        nodeId: ctx.nodeId,
        target: action,
      }));
      return true;
    },
  });
}

async function buildE2ePromptResponse(ctx: NodeActionContext, body: E2ePromptRequest): Promise<E2ePromptResponse> {
  const target = parseTarget(body.target);
  const node = getGraphNode(ctx.graph, ctx.nodeId);
  const context = await buildE2eContextForNode({
    graph: ctx.graph,
    nodeId: ctx.nodeId,
    projectRoot: ctx.config.projectRoot,
    target,
  });

  const selectedContext = selectContextItems(context.suggestedContext, body.selectedContextIds);
  const prompt = await buildE2ePrompt({
    node,
    target,
    pageObjectPath: context.pageObjectPath,
    poSpecPath: context.poSpecPath,
    targetPath: context.targetPath,
    userComment: body.userComment,
    selectedContext,
    graphSummary: context.graphSummary,
    projectRoot: ctx.config.projectRoot,
  });

  return {
    nodeId: ctx.nodeId,
    target,
    targetPath: context.targetPath,
    prompt,
    includedFiles: unique(selectedContext.map((entry) => entry.file).filter((entry): entry is string => Boolean(entry))),
  };
}

async function readTargetFile(args: {
  config: ResolvedProjectMapConfig;
  graph: ProjectMapGraph;
  nodeId: string;
  target: E2eGenerationTarget;
}) {
  const node = getGraphNode(args.graph, args.nodeId);
  const targets = resolveComponentE2eTargets(node);
  if (!targets) {
    throw Object.assign(new Error("Node is not supported by Page Object coverage"), { statusCode: 400 });
  }

  const expectedPath = resolveE2eTargetPath(targets, args.target);
  try {
    return {
      nodeId: args.nodeId,
      target: args.target,
      status: "exists",
      path: expectedPath,
      content: await readE2eFile(args.config.projectRoot, expectedPath),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        nodeId: args.nodeId,
        target: args.target,
        status: "missing",
        expectedPath,
      };
    }
    throw error;
  }
}

function parseTarget(value: string | null | undefined): E2eGenerationTarget {
  return value === "po-spec" ? "po-spec" : "page-object";
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
