import type { ProjectMapNode } from "../../graph/types.js";
import {
  IGNORED_JSX_NAMES,
  INFRASTRUCTURE_SHARED_MODULES,
  REDUX_HOOK_NAMES,
  type ProjectGraph,
} from "./viewTypes.js";

export type DirectPageComposition = {
  widgets: ProjectMapNode[];
  features: ProjectMapNode[];
  entities: ProjectMapNode[];
  shared: ProjectMapNode[];
  external: ProjectMapNode[];
  selectors: ProjectMapNode[];
  hooks: ProjectMapNode[];
};

export function collectDirectPageComposition(
  graph: ProjectGraph,
  pageId: string
): DirectPageComposition {
  const page = graph.nodes.find((node) => node.id === pageId);
  const pageComponent = page ? findPageComponent(graph, page) : null;
  const composition = createEmptyComposition();
  if (!pageComponent) return composition;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const edge of graph.edges) {
    if (edge.from !== pageComponent.id) continue;

    const target = nodesById.get(edge.to);
    if (!target) continue;

    if (edge.type === "renders") {
      addRenderedNode(composition, target);
      continue;
    }

    if (edge.type === "usesSelector") {
      addUnique(composition.selectors, target);
      continue;
    }

    if (edge.type === "usesHook") {
      if (!REDUX_HOOK_NAMES.has(target.name)) {
        addUnique(composition.hooks, target);
      }
      continue;
    }

    if (edge.type === "callsApi" || edge.type === "dispatchesAction") {
      addUnique(composition.selectors, target);
    }
  }

  sortComposition(composition);
  return composition;
}

export function findPageComponent(
  graph: ProjectGraph,
  page: ProjectMapNode
): ProjectMapNode | null {
  if (page.file) {
    const byFile = graph.nodes.find((node) => node.type === "component" && node.file === page.file);
    if (byFile) return byFile;
  }

  const pageSlice = page.fsd?.slice;
  const componentCandidates = graph.nodes.filter((node) =>
    node.type === "component" &&
    node.fsd?.layer === "pages" &&
    (node.fsd?.slice === pageSlice || node.id.includes(`${pageSlice ?? ""}`))
  );

  return componentCandidates[0] ?? null;
}

function addRenderedNode(composition: DirectPageComposition, node: ProjectMapNode) {
  if (IGNORED_JSX_NAMES.has(node.name)) return;

  if (
    node.type === "unknown" ||
    node.type === "external-package" ||
    node.id.includes(":unknown:") ||
    node.meta?.unresolved === true
  ) {
    addUnique(composition.external, node);
    return;
  }

  switch (node.fsd?.layer) {
    case "widgets":
      addUnique(composition.widgets, node);
      break;
    case "features":
      addUnique(composition.features, node);
      break;
    case "entities":
      addUnique(composition.entities, node);
      break;
    case "shared":
      if (!INFRASTRUCTURE_SHARED_MODULES.has(node.id)) {
        addUnique(composition.shared, node);
      }
      break;
    default:
      addUnique(composition.external, node);
      break;
  }
}

function createEmptyComposition(): DirectPageComposition {
  return {
    widgets: [],
    features: [],
    entities: [],
    shared: [],
    external: [],
    selectors: [],
    hooks: [],
  };
}

function addUnique(nodes: ProjectMapNode[], node: ProjectMapNode) {
  if (!nodes.some((candidate) => candidate.id === node.id)) {
    nodes.push(node);
  }
}

function sortComposition(composition: DirectPageComposition) {
  for (const nodes of Object.values(composition)) {
    nodes.sort((left, right) => left.name.localeCompare(right.name));
  }
}
