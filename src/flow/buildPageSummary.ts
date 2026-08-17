import type { ProjectMapEdge, ProjectMapNode } from "../graph/types.js";
import type { FlowCoverage, FlowNode } from "./types.js";

export type PageSummaryReference = {
  id: string;
  name: string;
  type: ProjectMapNode["type"] | FlowNode["kind"];
  layer?: string;
};

export type PageSummary = {
  page: PageSummaryReference;
  primaryComponent?: PageSummaryReference;
  keyLogic: PageSummaryReference[];
  composition: {
    domainBlocks: PageSummaryReference[];
    componentsCount: number;
    hooksCount: number;
  };
  data: {
    stateFields: PageSummaryReference[];
    selectors: PageSummaryReference[];
    apis: PageSummaryReference[];
  };
  behavior: {
    operations: PageSummaryReference[];
    uiEffects: PageSummaryReference[];
  };
  quality: {
    valuesCount: number;
    originResolvedCount: number;
    originCoveragePct: number;
    issueCount: number;
    issueReasonCounts: Array<{ reasonCode: string; count: number }>;
  };
};

export type BuildPageSummaryInput = {
  overview: {
    pageId: string;
    primaryComponentId?: string;
    topologyNodes: ProjectMapNode[];
    topologyEdges: ProjectMapEdge[];
    flows: Array<{ id: string; coverage: FlowCoverage }>;
  };
  flowDetails: Array<{ nodes: FlowNode[]; gaps: FlowNode[] }>;
};

/** Build a compact, question-oriented page answer from canonical facts. */
export function buildPageSummary(input: BuildPageSummaryInput): PageSummary {
  const { overview } = input;
  const pageNode = overview.topologyNodes.find((node) => node.id === overview.pageId);
  const primaryComponent = overview.primaryComponentId
    ? overview.topologyNodes.find((node) => node.id === overview.primaryComponentId)
    : undefined;
  const components = uniqueGraphNodes(overview.topologyNodes.filter((node) => node.type === "component"));
  const hooks = uniqueGraphNodes(overview.topologyNodes.filter((node) => node.type === "hook"));
  const directHookIds = new Set(overview.topologyEdges
    .filter((edge) => edge.type === "usesHook")
    .filter((edge) => components.some((component) => component.id === edge.from))
    .map((edge) => edge.to));
  const keyLogic = hooks
    .filter((hook) => directHookIds.has(hook.id) && hook.fsd?.layer !== "shared")
    .sort(byLayerThenName);
  const domainBlocks = components
    .filter((node) => node.id !== overview.primaryComponentId)
    .filter((node) => node.fsd?.layer !== "shared")
    .sort(byLayerThenName);

  const flowNodes = uniqueFlowNodes(input.flowDetails.flatMap((detail) => detail.nodes));
  const gaps = uniqueFlowNodes(input.flowDetails.flatMap((detail) => detail.gaps));
  const operations = uniqueGraphNodes(overview.topologyNodes.filter((node) =>
    node.type === "action" || node.type === "thunk" || node.type === "api"
  )).sort(byLayerThenName);
  const issueReasonCounts = new Map<string, number>();
  for (const gap of gaps) {
    const reasonCode = gap.gap?.reasonCode ?? "unknown";
    issueReasonCounts.set(reasonCode, (issueReasonCounts.get(reasonCode) ?? 0) + 1);
  }
  const originResolvedCount = overview.flows.filter((flow) =>
    flow.coverage.origin === "proven" || flow.coverage.origin === "boundary"
  ).length;

  return {
    page: graphReference(pageNode ?? {
      id: overview.pageId,
      name: overview.pageId,
      type: "page",
    }),
    primaryComponent: primaryComponent ? graphReference(primaryComponent) : undefined,
    keyLogic: keyLogic.map(graphReference),
    composition: {
      domainBlocks: domainBlocks.map(graphReference),
      componentsCount: components.length,
      hooksCount: hooks.length,
    },
    data: {
      stateFields: flowNodes.filter((node) => node.kind === "state-field").map(flowReference),
      selectors: flowNodes.filter((node) => node.kind === "selector-result").map(flowReference),
      apis: flowNodes.filter((node) => node.kind === "api").map(flowReference),
    },
    behavior: {
      operations: operations.map(graphReference),
      uiEffects: flowNodes.filter((node) => node.kind === "ui-effect").map(flowReference),
    },
    quality: {
      valuesCount: overview.flows.length,
      originResolvedCount,
      originCoveragePct: overview.flows.length > 0
        ? Math.round((originResolvedCount / overview.flows.length) * 100)
        : 0,
      issueCount: gaps.length,
      issueReasonCounts: [...issueReasonCounts.entries()]
        .map(([reasonCode, count]) => ({ reasonCode, count }))
        .sort((left, right) => right.count - left.count || left.reasonCode.localeCompare(right.reasonCode)),
    },
  };
}

function graphReference(node: ProjectMapNode): PageSummaryReference {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    layer: node.fsd?.layer,
  };
}

function flowReference(node: FlowNode): PageSummaryReference {
  return {
    id: node.id,
    name: node.path ?? node.name,
    type: node.kind,
  };
}

function uniqueGraphNodes(nodes: ProjectMapNode[]) {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function uniqueFlowNodes(nodes: FlowNode[]) {
  return [...new Map(nodes.map((node) => [node.id, node])).values()]
    .sort((left, right) => (left.path ?? left.name).localeCompare(right.path ?? right.name));
}

function byLayerThenName(left: ProjectMapNode, right: ProjectMapNode) {
  return (left.fsd?.layer ?? "").localeCompare(right.fsd?.layer ?? "") ||
    left.name.localeCompare(right.name);
}
