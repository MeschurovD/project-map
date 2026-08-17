import type { ProjectMapNode } from "../../graph/types.js";
import {
  IGNORED_JSX_NAMES,
  SEMANTIC_EDGE_TYPES,
  type GraphViewState,
  type ProjectGraph,
} from "./viewTypes.js";

export type CollectReachableOptions = Partial<Pick<
  GraphViewState,
  "showFiles" | "showHooks" | "showRedux" | "showUnknown"
>> & {
  maxDepth?: number;
};

export function collectReachableSemanticNodes(
  graph: ProjectGraph,
  startId: string,
  options: CollectReachableOptions = {}
): ProjectMapNode[] {
  const maxDepth = options.maxDepth ?? 4;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (!SEMANTIC_EDGE_TYPES.has(edge.type)) continue;
    const targets = outgoing.get(edge.from) ?? [];
    targets.push(edge.to);
    outgoing.set(edge.from, targets);
  }

  const visited = new Set<string>([startId]);
  const reachable: ProjectMapNode[] = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    for (const nextId of outgoing.get(current.id) ?? []) {
      if (visited.has(nextId)) continue;
      visited.add(nextId);

      const node = nodesById.get(nextId);
      if (!node) continue;

      if (isTraversable(node, options)) {
        reachable.push(node);
      }

      if (shouldContinueTraversal(node, options)) {
        queue.push({ id: nextId, depth: current.depth + 1 });
      }
    }
  }

  return reachable;
}

function isTraversable(node: ProjectMapNode, options: CollectReachableOptions) {
  if (isIgnoredJsxNode(node)) return false;
  if (node.type === "file" && options.showFiles !== true) return false;
  if (node.type === "unknown" && options.showUnknown !== true) return false;
  if (node.meta?.unresolved === true && options.showUnknown !== true) return false;
  if (node.id.includes(":unknown:") && options.showUnknown !== true) return false;
  if (node.type === "hook" && options.showHooks === false) return false;
  if (isReduxNode(node) && options.showRedux === false) return false;
  return true;
}

function shouldContinueTraversal(node: ProjectMapNode, options: CollectReachableOptions) {
  if (node.type === "file" && options.showFiles !== true) return false;
  if ((node.type === "unknown" || node.id.includes(":unknown:")) && options.showUnknown !== true) return false;
  return !isIgnoredJsxNode(node);
}

export function isIgnoredJsxNode(node: ProjectMapNode) {
  return IGNORED_JSX_NAMES.has(node.name);
}

export function isReduxNode(node: ProjectMapNode) {
  return node.type === "selector" ||
    node.type === "action" ||
    node.type === "thunk" ||
    node.type === "slice-model" ||
    node.type === "api";
}
