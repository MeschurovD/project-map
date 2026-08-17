import type { ProjectMapGraph, ProjectMapNode } from "../../graph/types.js";

export function getGraphNode(graph: ProjectMapGraph, nodeId: string): ProjectMapNode {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  if (!node) throw Object.assign(new Error(`Node not found: ${nodeId}`), { statusCode: 404 });
  return node;
}
