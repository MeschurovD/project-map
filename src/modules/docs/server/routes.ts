import type { Connect } from "vite";
import type { ResolvedProjectMapConfig } from "../../../config/types.js";
import { readGraph } from "../../../dev/services/graphStore.js";
import { readFlowIndexIfPresent } from "../../../dev/services/flowStore.js";
import { ensureMethod, readJsonBody, sendJson, statusCodeForError } from "../../server/http.js";
import { createGenerationRoutes, type GenerationPromptRequest, type NodeActionContext } from "../../server/generationRoutes.js";
import { selectContextItems } from "../../server/selectContextItems.js";
import { buildDocsContextForNode } from "./services/docsContextService.js";
import {
  buildDocsCoverage,
  listStaleV2Docs,
} from "./services/docsCoverageService.js";
import {
  computeSourceDigest,
  readDocsFile,
} from "./services/docsFileService.js";
import { createDocsJob, getDocsJob } from "./services/docsJobService.js";
import {
  buildDocsPartialPrompt,
  buildDocsPrompt,
} from "./services/docsPromptService.js";
import { setDocsReviewed } from "./services/docsReviewService.js";
import { getDocsStatusForNode, getGraphNode } from "./services/docsStatusService.js";
import type {
  DocsGenerationScope,
  DocsPromptMode,
} from "./services/docsTypes.js";
import { runOpenCodeDocsJob } from "./services/opencodeRunner.js";
import type { DocsV2Source } from "./services/docsV2FileFormat.js";
import { buildDocsV2OwnerReferenceAllowlist } from "./services/docsV2ReferenceValidator.js";

const STALE_PATH = "/api/docs/stale";
const COVERAGE_PATH = "/api/docs/coverage";

type DocsPromptRequest = GenerationPromptRequest & {
  mode?: DocsPromptMode;
  scope?: DocsGenerationScope;
};

type DocsPromptResponse = {
  nodeId: string;
  docsPath: string;
  prompt: string;
  includedFiles: string[];
  scope: DocsGenerationScope;
  sourceManifest: DocsV2Source[];
};

export function docsRoutes(config: ResolvedProjectMapConfig): Connect.NextHandleFunction {
  const generationRoutes = docsGenerationRoutes(config);

  // The shared skeleton only routes /jobs/* and /node/*; collection routes
  // are handled here before delegating.
  return (request, response, next) => {
    const pathname = (request.url ?? "").split("?")[0];
    if (pathname === STALE_PATH) {
      void handleStaleList(config, request, response);
      return;
    }
    if (pathname === COVERAGE_PATH) {
      void handleCoverage(config, request, response);
      return;
    }
    generationRoutes(request, response, next);
  };
}

async function handleCoverage(
  config: ResolvedProjectMapConfig,
  request: Parameters<Connect.NextHandleFunction>[0],
  response: Parameters<Connect.NextHandleFunction>[1]
) {
  try {
    ensureMethod(request, "GET");
    const [graph, flowIndex] = await Promise.all([
      readGraph(config.projectRoot),
      readFlowIndexIfPresent(config.projectRoot),
    ]);
    sendJson(response, 200, await buildDocsCoverage({
      graph,
      flowIndex,
      projectRoot: config.projectRoot,
    }));
  } catch (error) {
    sendJson(response, statusCodeForError(error), {
      error: "Docs coverage failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleStaleList(
  config: ResolvedProjectMapConfig,
  request: Parameters<Connect.NextHandleFunction>[0],
  response: Parameters<Connect.NextHandleFunction>[1]
) {
  try {
    ensureMethod(request, "GET");
    const [graph, flowIndex] = await Promise.all([
      readGraph(config.projectRoot),
      readFlowIndexIfPresent(config.projectRoot),
    ]);
    const coverage = await buildDocsCoverage({
      graph,
      flowIndex,
      projectRoot: config.projectRoot,
    });
    sendJson(response, 200, { nodes: listStaleV2Docs(coverage) });
  } catch (error) {
    sendJson(response, statusCodeForError(error), {
      error: "Docs request failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function docsGenerationRoutes(config: ResolvedProjectMapConfig): Connect.NextHandleFunction {
  return createGenerationRoutes<DocsPromptRequest, DocsPromptResponse>(config, {
    namespace: "docs",
    errorLabel: "Docs request failed",
    jobNotFoundLabel: "Docs job not found",
    disabledMessage: "Docs generation is disabled",
    getJob: getDocsJob,
    getStatus: (ctx) => getDocsStatusForNode({ graph: ctx.graph, nodeId: ctx.nodeId, projectRoot: ctx.config.projectRoot }),
    getContext: (ctx) => buildDocsContext(ctx, ctx.url.searchParams.get("flowNodeId") ?? undefined),
    isEnabled: (config) => config.docs.enabled,
    buildPromptResponse: buildDocsPromptResponse,
    startGeneration: async (ctx, promptResponse) => {
      const job = createDocsJob({ nodeId: ctx.nodeId, docsPath: promptResponse.docsPath });
      const flowIndex = await readFlowIndexIfPresent(ctx.config.projectRoot);
      void runOpenCodeDocsJob({
        projectRoot: ctx.config.projectRoot,
        prompt: promptResponse.prompt,
        docsPath: promptResponse.docsPath,
        nodeId: ctx.nodeId,
        jobId: job.id,
        generator: ctx.config.docs.generator,
        scope: promptResponse.scope,
        sourceManifest: promptResponse.sourceManifest,
        referenceAllowlist: buildDocsV2OwnerReferenceAllowlist(
          ctx.graph,
          flowIndex,
          ctx.nodeId
        ),
      });
      return job.id;
    },
    handleExtraAction: async (action, ctx) => {
      if (action === "reviewed") {
        ensureMethod(ctx.request, "POST");
        const body = await readJsonBody<{
          reviewed?: boolean;
          annotationIds?: string[];
        }>(ctx.request);
        const status = await setDocsReviewed({
          graph: ctx.graph,
          nodeId: ctx.nodeId,
          projectRoot: ctx.config.projectRoot,
          reviewed: body.reviewed !== false,
          annotationIds: body.annotationIds,
        });
        sendJson(ctx.response, 200, status);
        return true;
      }
      if (action !== "") return false;
      ensureMethod(ctx.request, "GET");
      const status = await getDocsStatusForNode({ graph: ctx.graph, nodeId: ctx.nodeId, projectRoot: ctx.config.projectRoot });
      if (status.status !== "exists" && status.status !== "stale") {
        sendJson(ctx.response, 200, status);
        return true;
      }
      sendJson(ctx.response, 200, {
        nodeId: ctx.nodeId,
        status: "exists",
        path: status.path,
        content: await readDocsFile(ctx.config.projectRoot, status.path),
      });
      return true;
    },
  });
}

async function buildDocsPromptResponse(ctx: NodeActionContext, body: DocsPromptRequest): Promise<DocsPromptResponse> {
  const node = getGraphNode(ctx.graph, ctx.nodeId);
  const scope = normalizeDocsScope(body.scope);
  const context = await buildDocsContext(
    ctx,
    scope.type === "target" && scope.target.type === "flow-node"
      ? scope.target.id
      : undefined
  );

  if (!context.docsPath || !node.file) throw Object.assign(new Error("Node has no source file"), { statusCode: 400 });

  const selectedContext = selectContextItems(context.suggestedContext, body.selectedContextIds);
  const sourceManifest = await buildSourceManifest(
    ctx.config.projectRoot,
    unique([
      node.file,
      ...selectedContext.map((entry) => entry.file),
    ].filter((file): file is string => Boolean(file)))
  );
  const mode: DocsPromptMode =
    body.mode === "regenerate" || body.mode === "migrate"
      ? body.mode
      : "create";
  if (scope.type !== "document") {
    if (mode === "migrate") {
      throw Object.assign(
        new Error("Миграция поддерживается только для всего документа."),
        { statusCode: 409 }
      );
    }
    const status = await getDocsStatusForNode({
      graph: ctx.graph,
      nodeId: ctx.nodeId,
      projectRoot: ctx.config.projectRoot,
    });
    if (
      (status.status !== "exists" && status.status !== "stale") ||
      status.format !== "structured-v2"
    ) {
      throw Object.assign(
        new Error("Partial regeneration доступна только для существующего docs v2."),
        { statusCode: 409 }
      );
    }
    const existingDocs = await readDocsFile(ctx.config.projectRoot, status.path);
    const targetValue = scope.type === "target" && scope.target.type === "flow-node"
      ? context.values.find((value) => value.id === scope.target.id)
      : undefined;
    return {
      nodeId: ctx.nodeId,
      docsPath: status.path,
      prompt: buildDocsPartialPrompt({
        node,
        docsPath: status.path,
        scope,
        userComment: body.userComment,
        selectedContext,
        existingDocs,
        graphSummary: context.graphSummary,
        valueFlowSummary: context.valueFlowSummary,
        suggestedValueCategory: targetValue?.suggestedCategory,
      }),
      includedFiles: unique(selectedContext.map((entry) => entry.file).filter((entry): entry is string => Boolean(entry))),
      scope,
      sourceManifest,
    };
  }
  const existingDocs = mode === "create"
    ? undefined
    : await readCurrentDocsForMode(ctx, mode);
  const prompt = await buildDocsPrompt({
    node,
    docsPath: context.docsPath,
    mode,
    userComment: body.userComment,
    selectedContext,
    sourceManifest,
    existingDocs,
    graphSummary: context.graphSummary,
    valueFlowSummary: context.valueFlowSummary,
  });

  return {
    nodeId: ctx.nodeId,
    docsPath: context.docsPath,
    prompt,
    includedFiles: unique(selectedContext.map((entry) => entry.file).filter((entry): entry is string => Boolean(entry))),
    scope,
    sourceManifest,
  };
}

async function buildDocsContext(
  ctx: NodeActionContext,
  targetFlowNodeId?: string
) {
  return buildDocsContextForNode({
    graph: ctx.graph,
    nodeId: ctx.nodeId,
    projectRoot: ctx.config.projectRoot,
    flowIndex: await readFlowIndexIfPresent(ctx.config.projectRoot),
    targetFlowNodeId,
  });
}

async function readCurrentDocsForMode(
  ctx: NodeActionContext,
  mode: DocsPromptMode
) {
  const status = await getDocsStatusForNode({
    graph: ctx.graph,
    nodeId: ctx.nodeId,
    projectRoot: ctx.config.projectRoot,
  });
  if (status.status !== "exists" && status.status !== "stale") {
    throw Object.assign(new Error("Исходная документация отсутствует."), {
      statusCode: 409,
    });
  }
  if (mode === "migrate" && status.format !== "structured") {
    throw Object.assign(
      new Error("Явная миграция доступна только для structured docs v1."),
      { statusCode: 409 }
    );
  }
  return readDocsFile(ctx.config.projectRoot, status.path);
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

async function buildSourceManifest(
  projectRoot: string,
  files: string[]
): Promise<DocsV2Source[]> {
  return Promise.all(files.map(async (file) => ({
    path: file,
    hash: await computeSourceDigest(projectRoot, file),
  })));
}

function normalizeDocsScope(value: unknown): DocsGenerationScope {
  if (value === undefined || value === null) return { type: "document" };
  if (!isRecord(value) || typeof value.type !== "string") {
    throw Object.assign(new Error("Некорректный docs generation scope."), {
      statusCode: 400,
    });
  }
  if (value.type === "document") return { type: "document" };
  if (value.type === "annotation") {
    const annotationIds = Array.isArray(value.annotationIds)
      ? value.annotationIds.filter((id): id is string =>
          typeof id === "string" && Boolean(id.trim())
        )
      : [];
    if (annotationIds.length > 0) {
      return { type: "annotation", annotationIds: unique(annotationIds) };
    }
  }
  if (
    value.type === "target" &&
    isRecord(value.target) &&
    (value.target.type === "node" ||
      value.target.type === "flow-node" ||
      value.target.type === "occurrence") &&
    typeof value.target.id === "string" &&
    value.target.id.trim()
  ) {
    return {
      type: "target",
      target: { type: value.target.type, id: value.target.id.trim() },
      createIfMissing: value.createIfMissing === true,
      ensureValueMeaning: value.ensureValueMeaning === true,
      includeBusinessLogic: value.includeBusinessLogic === true,
    };
  }
  throw Object.assign(new Error("Некорректный docs generation scope."), {
    statusCode: 400,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
