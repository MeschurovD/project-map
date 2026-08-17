import type { ProjectMapEdge, ProjectMapNode } from "../../graph/types.js";
import { isIgnoredJsxNode } from "./collectReachableNodes.js";
import type { ProjectGraph } from "./viewTypes.js";

export type NodeInternals = {
  renderedComponents: ProjectMapNode[];
  hooks: ProjectMapNode[];
  selectors: ProjectMapNode[];
  actions: ProjectMapNode[];
  apiCalls: ProjectMapNode[];
  fsdDependencies: ProjectMapNode[];
  usedBy: ProjectMapNode[];
};

export type CollectNodeInternalsOptions = {
  showUnknown: boolean;
  showFiles: boolean;
  showImports: boolean;
};

export function collectNodeInternals(
  graph: ProjectGraph,
  nodeId: string,
  options: CollectNodeInternalsOptions
): NodeInternals {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const internals: NodeInternals = {
    renderedComponents: [],
    hooks: [],
    selectors: [],
    actions: [],
    apiCalls: [],
    fsdDependencies: [],
    usedBy: [],
  };

  const outgoing = graph.edges.filter((edge) => edge.from === nodeId);
  for (const edge of outgoing) {
    const target = nodesById.get(edge.to);
    if (!target || !isVisibleNode(target, options)) continue;

    if (edge.type === "renders") addUnique(internals.renderedComponents, target);
    if (edge.type === "usesHook") addUnique(internals.hooks, target);
    if (edge.type === "usesSelector" || edge.type === "readsSlice") addUnique(internals.selectors, target);
    if (edge.type === "dispatchesAction") addUnique(internals.actions, target);
    if (edge.type === "callsApi") addUnique(internals.apiCalls, target);
    if (edge.type === "dependsOn") addUnique(internals.fsdDependencies, target);
  }

  const incoming = graph.edges.filter((edge) => edge.to === nodeId);
  for (const edge of incoming) {
    if (!isUsedByEdge(edge, options)) continue;

    const source = nodesById.get(edge.from);
    if (!source || !isVisibleNode(source, options)) continue;
    addUnique(internals.usedBy, source);
  }

  sortInternals(internals);
  return internals;
}

function isVisibleNode(node: ProjectMapNode, options: CollectNodeInternalsOptions) {
  if (isIgnoredJsxNode(node)) return false;
  if (node.type === "file" && !options.showFiles) return false;
  if ((node.type === "unknown" || node.id.includes(":unknown:") || node.meta?.unresolved === true) && !options.showUnknown) {
    return false;
  }
  return true;
}

function isUsedByEdge(edge: ProjectMapEdge, options: CollectNodeInternalsOptions) {
  if (edge.type === "imports") return options.showImports;
  return edge.type !== "contains" &&
    edge.type !== "definedIn" &&
    edge.type !== "belongsToLayer" &&
    edge.type !== "belongsToSlice";
}

function addUnique(nodes: ProjectMapNode[], node: ProjectMapNode) {
  if (!nodes.some((candidate) => candidate.id === node.id)) {
    nodes.push(node);
  }
}

function sortInternals(internals: NodeInternals) {
  for (const nodes of Object.values(internals)) {
    nodes.sort((left, right) => left.name.localeCompare(right.name));
  }
}
