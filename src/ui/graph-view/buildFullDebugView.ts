import type { ProjectMapNode } from "../../graph/types.js";
import {
  DEBUG_EDGE_TYPES,
  type GraphViewState,
  type ProjectGraph,
  type ViewGraph,
  type ViewGraphNode,
} from "./viewTypes.js";

const LAYER_X: Record<string, number> = {
  app: 0,
  pages: 270,
  widgets: 540,
  features: 810,
  entities: 1080,
  shared: 1350,
  unknown: 1620,
};

export function buildFullDebugView(graph: ProjectGraph, state: GraphViewState): ViewGraph {
  const visibleNodes = graph.nodes.filter((node) => isVisibleNode(node, state));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => {
    if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) return false;
    if (DEBUG_EDGE_TYPES.has(edge.type) && !state.showImports) return false;
    return state.visibleEdgeTypes.has(edge.type);
  });

  return {
    nodes: layoutNodes(visibleNodes),
    edges: visibleEdges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      sourceEdge: edge,
      label: edge.type,
    })),
  };
}

function layoutNodes(nodes: ProjectMapNode[]): ViewGraphNode[] {
  const counters = new Map<string, number>();

  return nodes.map((node) => {
    const layer = node.fsd?.layer ?? (node.type === "project" ? "app" : "unknown");
    const bucket = layer in LAYER_X ? layer : "unknown";
    const nextIndex = counters.get(bucket) ?? 0;
    counters.set(bucket, nextIndex + 1);

    return {
      id: node.id,
      kind: "semantic-card",
      sourceNode: node,
      label: node.name,
      file: node.file,
      nodeType: node.type,
      fsdLayer: node.fsd?.layer,
      fsdSlice: node.fsd?.slice,
      position: {
        x: LAYER_X[bucket] ?? LAYER_X.unknown,
        y: nextIndex * 96,
      },
    };
  });
}

function isVisibleNode(node: ProjectMapNode, state: GraphViewState) {
  if (!state.visibleLayers.has(node.fsd?.layer ?? (node.type === "project" ? "app" : "unknown"))) return false;
  if (node.type === "file" && !state.showFiles) return false;
  if ((node.type === "unknown" || node.id.includes(":unknown:") || node.meta?.unresolved === true) && !state.showUnknown) {
    return false;
  }
  return true;
}
