import type { ProjectMapEdge, ProjectMapNode } from "../../graph/types.js";
import { collectNodeInternals } from "./collectNodeInternals.js";
import type { GraphViewState, ProjectGraph, ViewGraphEdge, ViewGraphNode } from "./viewTypes.js";

// Card/edge builders shared by the page-focus layouts (tree and columns), so
// both produce identical semantic cards, evidence edges and summary badges.

export function semanticNode(
  graph: ProjectGraph,
  node: ProjectMapNode,
  state: GraphViewState,
  position: { x: number; y: number },
  id = node.id,
  reasonEdges: ProjectMapEdge[] = []
): ViewGraphNode {
  return {
    id,
    kind: "semantic-card",
    sourceNode: node,
    reasonEdges,
    label: node.name,
    file: node.file,
    nodeType: node.type,
    fsdLayer: node.fsd?.layer,
    fsdSlice: node.fsd?.slice,
    subtitle: nodeSubtitle(node),
    summaryBadges: nodeSummaryBadges(graph, node, state),
    position,
  };
}

export function viewEdge(from: string, to: string, label: string, sourceEdge?: ProjectMapEdge): ViewGraphEdge {
  return {
    id: `view:${from}:${label}:${to}`,
    from,
    to,
    type: "view",
    sourceEdge,
    label,
  };
}

export function semanticEdgesBetween(graph: ProjectGraph, from: string, to: string) {
  return graph.edges.filter((edge) =>
    edge.from === from &&
    edge.to === to &&
    isPageFocusEvidenceEdge(edge)
  );
}

export function isPageFocusEvidenceEdge(edge: ProjectMapEdge) {
  return edge.type === "renders" ||
    edge.type === "usesHook" ||
    edge.type === "usesSelector" ||
    edge.type === "dispatchesAction" ||
    edge.type === "readsSlice" ||
    edge.type === "callsApi" ||
    edge.type === "dependsOn";
}

export function compactCountBadges(entries: Array<[string, number]>) {
  return entries
    .filter(([, value]) => value > 0)
    .map(([label, value]) => `${label} ${value}`);
}

function nodeSummaryBadges(graph: ProjectGraph, node: ProjectMapNode, state: GraphViewState) {
  if (node.type === "selector" || node.type === "action" || node.type === "api" || node.type === "slice-model") {
    return [];
  }

  const internals = collectNodeInternals(graph, node.id, {
    showFiles: state.showFiles,
    showImports: state.showImports,
    showUnknown: state.showUnknown,
  });
  const reduxCount = internals.selectors.length + internals.actions.length + internals.apiCalls.length;

  return compactCountBadges([
    ["renders", internals.renderedComponents.length],
    ["hooks", internals.hooks.length],
    ["redux", reduxCount],
    ["deps", internals.fsdDependencies.length],
  ]);
}

function nodeSubtitle(node: ProjectMapNode) {
  if (node.file) return node.file;
  const fsdPath = [
    node.fsd?.layer,
    node.fsd?.slice,
    node.fsd?.segment,
  ].filter(Boolean).join("/");
  return fsdPath || undefined;
}
