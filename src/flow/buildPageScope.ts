import type {
  EdgeType,
  ProjectMapEdge,
  ProjectMapGraph,
  ProjectMapNode,
} from "../graph/types.js";
import type { FlowIndex, PageScope, PageScopeWarning } from "./types.js";

export type BuildPageScopeInput = {
  graph: ProjectMapGraph;
  flowIndex: FlowIndex;
  pageId: string;
};

const TRAVERSABLE_EDGE_TYPES = new Set<EdgeType>([
  "renders",
  "usesHook",
  "usesSelector",
  "dispatchesAction",
  "readsSlice",
  "writesSlice",
  "callsApi",
]);

const CONTEXT_EDGE_TYPES = new Set<EdgeType>([
  ...TRAVERSABLE_EDGE_TYPES,
  "contains",
  "definedIn",
  "dependsOn",
]);

/**
 * Build a reusable page boundary over topology + canonical value flows.
 *
 * The page entry is resolved through page → contains → file ← definedIn ←
 * component where possible. Semantic traversal starts from actual components,
 * never from the coarse FSD page module.
 */
export function buildPageScope(input: BuildPageScopeInput): PageScope | null {
  const { graph, flowIndex, pageId } = input;
  const page = graph.nodes.find((node) => node.id === pageId && node.type === "page");
  if (!page) return null;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = groupOutgoingEdges(graph.edges);
  const topologyNodeIds = new Set<string>([page.id]);
  const topologyEdgeIds = new Set<string>();
  const warnings: PageScopeWarning[] = [];
  const entry = resolvePageEntry(graph, page);

  for (const fileId of entry.fileIds) topologyNodeIds.add(fileId);
  for (const componentId of entry.componentIds) topologyNodeIds.add(componentId);
  for (const edgeId of entry.edgeIds) topologyEdgeIds.add(edgeId);

  if (entry.componentIds.length === 0) {
    warnings.push({
      code: "page-component-not-found",
      message: `No entry component could be resolved for ${page.name}`,
    });
  }

  const visited = new Set<string>();
  const queue = [...entry.componentIds];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    for (const edge of outgoing.get(currentId) ?? []) {
      if (!TRAVERSABLE_EDGE_TYPES.has(edge.type)) continue;
      if (!nodesById.has(edge.to)) continue;

      topologyNodeIds.add(edge.to);
      topologyEdgeIds.add(edge.id);
      if (!visited.has(edge.to)) queue.push(edge.to);
    }
  }

  const flowNodeById = new Map(flowIndex.nodes.map((node) => [node.id, node]));
  const relevantFlows = flowIndex.flows.filter((flow) => {
    const subject = flowNodeById.get(flow.subjectNodeId);
    return Boolean(subject?.ownerNodeId && topologyNodeIds.has(subject.ownerNodeId));
  });
  const flowIds = new Set(relevantFlows.map((flow) => flow.id));
  const flowNodeIds = new Set(relevantFlows.flatMap((flow) => flow.nodeIds));
  const flowEdgeIds = new Set(relevantFlows.flatMap((flow) => flow.edgeIds));

  for (const flowNodeId of flowNodeIds) {
    const ownerNodeId = flowNodeById.get(flowNodeId)?.ownerNodeId;
    if (ownerNodeId && nodesById.has(ownerNodeId)) topologyNodeIds.add(ownerNodeId);
  }

  addFsdModuleOwners(graph, topologyNodeIds);

  for (const edge of graph.edges) {
    if (!CONTEXT_EDGE_TYPES.has(edge.type)) continue;
    if (topologyNodeIds.has(edge.from) && topologyNodeIds.has(edge.to)) {
      topologyEdgeIds.add(edge.id);
    }
  }

  const sortedTopologyNodeIds = [...topologyNodeIds].sort();
  const sortedTopologyEdgeIds = [...topologyEdgeIds].sort();
  const sortedFlowIds = [...flowIds].sort();
  const sortedFlowNodeIds = [...flowNodeIds].sort();
  const sortedFlowEdgeIds = [...flowEdgeIds].sort();

  return {
    pageId: page.id,
    primaryComponentId: entry.componentIds[0],
    entryComponentIds: entry.componentIds,
    topologyNodeIds: sortedTopologyNodeIds,
    topologyEdgeIds: sortedTopologyEdgeIds,
    flowIds: sortedFlowIds,
    flowNodeIds: sortedFlowNodeIds,
    flowEdgeIds: sortedFlowEdgeIds,
    warnings,
    stats: {
      topologyNodesCount: sortedTopologyNodeIds.length,
      topologyEdgesCount: sortedTopologyEdgeIds.length,
      flowsCount: sortedFlowIds.length,
      flowNodesCount: sortedFlowNodeIds.length,
      flowEdgesCount: sortedFlowEdgeIds.length,
      gapsCount: sortedFlowNodeIds.filter((id) => flowNodeById.get(id)?.kind === "gap").length,
    },
  };
}

type PageEntry = {
  componentIds: string[];
  fileIds: string[];
  edgeIds: string[];
};

function resolvePageEntry(graph: ProjectMapGraph, page: ProjectMapNode): PageEntry {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const containsEdges = graph.edges.filter((edge) =>
    edge.from === page.id && edge.type === "contains" && nodesById.get(edge.to)?.type === "file"
  );
  const fileIds = new Set(containsEdges.map((edge) => edge.to));
  if (page.file) {
    for (const node of graph.nodes) {
      if (node.type === "file" && node.file === page.file) fileIds.add(node.id);
    }
  }

  const definedInEdges = graph.edges.filter((edge) =>
    edge.type === "definedIn" &&
    fileIds.has(edge.to) &&
    nodesById.get(edge.from)?.type === "component"
  );
  let components = definedInEdges.flatMap((edge) => nodesById.get(edge.from) ?? []);

  if (components.length === 0) {
    components = graph.nodes.filter((node) =>
      node.type === "component" &&
      node.fsd?.layer === "pages" &&
      (node.fsd?.slice === page.fsd?.slice || Boolean(page.fsd?.slice && node.id.includes(page.fsd.slice)))
    );
  }

  components = uniqueNodes(components).sort((left, right) => {
    const score = componentEntryScore(right, page) - componentEntryScore(left, page);
    return score || left.id.localeCompare(right.id);
  });

  return {
    componentIds: components.map((node) => node.id),
    fileIds: [...fileIds].sort(),
    edgeIds: [
      ...containsEdges.map((edge) => edge.id),
      ...definedInEdges.map((edge) => edge.id),
    ].sort(),
  };
}

function componentEntryScore(component: ProjectMapNode, page: ProjectMapNode): number {
  let score = 0;
  if (page.file && component.file === page.file) score += 8;
  if (component.meta?.exported === true) score += 4;
  if (component.name.endsWith("Page")) score += 2;

  const pageName = normalizeName(page.fsd?.slice ?? page.name).replace(/page$/, "");
  const componentName = normalizeName(component.name).replace(/page$/, "");
  if (pageName && pageName === componentName) score += 4;
  return score;
}

function addFsdModuleOwners(graph: ProjectMapGraph, nodeIds: Set<string>): void {
  const snapshot = [...nodeIds];
  for (const nodeId of snapshot) {
    const node = graph.nodes.find((entry) => entry.id === nodeId);
    const owner = node ? findFsdModuleOwner(graph, node) : undefined;
    if (owner) nodeIds.add(owner.id);
  }
}

function findFsdModuleOwner(graph: ProjectMapGraph, node: ProjectMapNode): ProjectMapNode | undefined {
  if (isFsdModuleNode(node)) return node;
  const layer = node.fsd?.layer;
  if (!layer) return undefined;

  const typeByLayer: Partial<Record<string, ProjectMapNode["type"]>> = {
    pages: "page",
    widgets: "widget",
    features: "feature",
    entities: "entity",
    shared: "shared",
  };
  const moduleType = typeByLayer[layer];
  if (!moduleType) return undefined;
  const identity = node.fsd?.slice ?? node.fsd?.segment ?? layer;

  return graph.nodes.find((candidate) =>
    candidate.type === moduleType &&
    (candidate.id === `${moduleType}:${identity}` || candidate.fsd?.slice === identity || candidate.name === identity)
  );
}

function isFsdModuleNode(node: ProjectMapNode): boolean {
  return node.type === "page" ||
    node.type === "widget" ||
    node.type === "feature" ||
    node.type === "entity" ||
    node.type === "shared";
}

function groupOutgoingEdges(edges: ProjectMapEdge[]): Map<string, ProjectMapEdge[]> {
  const grouped = new Map<string, ProjectMapEdge[]>();
  for (const edge of edges) {
    const current = grouped.get(edge.from) ?? [];
    current.push(edge);
    grouped.set(edge.from, current);
  }
  return grouped;
}

function uniqueNodes(nodes: ProjectMapNode[]): ProjectMapNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
