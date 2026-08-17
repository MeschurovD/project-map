import type { ProjectMapNode } from "../../graph/types.js";
import { collectReachableSemanticNodes, isReduxNode } from "./collectReachableNodes.js";
import {
  type GraphViewState,
  type PageStats,
  type ProjectGraph,
  type ViewGraph,
  type ViewGraphEdge,
  type ViewGraphNode,
} from "./viewTypes.js";

export function buildPagesOverviewView(graph: ProjectGraph, state: GraphViewState): ViewGraph {
  const pages = getPageNodes(graph).filter((page) => isVisibleByLayer(page, state));
  const groups = groupPagesByFolder(pages);
  const nodes: ViewGraphNode[] = [];
  const edges: ViewGraphEdge[] = [];
  let row = 0;

  for (const group of groups) {
    if (group.folder) {
      const folderId = pageFolderNodeId(group.folder);
      nodes.push({
        id: folderId,
        kind: "folder-card",
        label: group.folder,
        position: { x: 0, y: row * 170 },
        count: group.pages.length,
      });

      group.pages.forEach((page, index) => {
        nodes.push(pageOverviewNode(graph, page, state, {
          x: 340,
          y: (row + index) * 170,
        }));
        edges.push(viewEdge(folderId, page.id, "page"));
      });
      row += Math.max(group.pages.length, 1);
      continue;
    }

    for (const page of group.pages) {
      nodes.push(pageOverviewNode(graph, page, state, { x: 0, y: row * 170 }));
      row += 1;
    }
  }

  return { nodes, edges };
}

export function getPageNodes(graph: ProjectGraph): ProjectMapNode[] {
  const explicitPages = graph.nodes.filter((node) => node.type === "page");
  const pageNodes = explicitPages.length > 0
    ? explicitPages
    : graph.nodes.filter((node) => node.fsd?.layer === "pages" && node.type !== "file");

  return pageNodes
    .filter((node, index, all) => all.findIndex((candidate) => pageKey(candidate) === pageKey(node)) === index)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function collectPageStats(
  graph: ProjectGraph,
  pageId: string,
  state: Pick<GraphViewState, "showFiles" | "showHooks" | "showRedux" | "showUnknown">
): PageStats {
  const reachable = collectReachableSemanticNodes(graph, pageId, {
    ...state,
    maxDepth: 4,
  });
  const unique = new Map(reachable.map((node) => [node.id, node]));

  return {
    widgets: countByLayer(unique, "widgets"),
    features: countByLayer(unique, "features"),
    entities: countByLayer(unique, "entities"),
    shared: countByLayer(unique, "shared"),
    hooks: Array.from(unique.values()).filter((node) => node.type === "hook").length,
    redux: Array.from(unique.values()).filter(isReduxNode).length,
  };
}

function countByLayer(nodes: Map<string, ProjectMapNode>, layer: string) {
  return Array.from(nodes.values()).filter((node) =>
    node.fsd?.layer === layer && isProductLayerItem(node)
  ).length;
}

function isProductLayerItem(node: ProjectMapNode) {
  if (node.type === "file" || node.type === "hook" || isReduxNode(node)) return false;
  if (node.type === "unknown" || node.id.includes(":unknown:") || node.meta?.unresolved === true) return false;
  return true;
}

function pageOverviewNode(
  graph: ProjectGraph,
  page: ProjectMapNode,
  state: GraphViewState,
  position: { x: number; y: number }
): ViewGraphNode {
  return {
    id: page.id,
    kind: "page-card",
    sourceNode: page,
    label: page.name,
    file: page.file,
    nodeType: page.type,
    fsdLayer: page.fsd?.layer,
    fsdSlice: page.fsd?.slice,
    position,
    stats: collectPageStats(graph, page.id, state),
  };
}

function pageKey(node: ProjectMapNode) {
  return node.fsd?.slice ?? node.id;
}

function isVisibleByLayer(node: ProjectMapNode, state: GraphViewState) {
  return state.visibleLayers.has(node.fsd?.layer ?? "unknown");
}

function groupPagesByFolder(pages: ProjectMapNode[]) {
  const grouped = new Map<string, ProjectMapNode[]>();
  const ungrouped: ProjectMapNode[] = [];

  for (const page of pages) {
    const folder = getPagesFolder(page);
    if (!folder) {
      ungrouped.push(page);
      continue;
    }

    const folderPages = grouped.get(folder) ?? [];
    folderPages.push(page);
    grouped.set(folder, folderPages);
  }

  return [
    ...Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([folder, folderPages]) => ({
        folder,
        pages: folderPages.sort((left, right) => left.name.localeCompare(right.name)),
      })),
    {
      folder: null,
      pages: ungrouped.sort((left, right) => left.name.localeCompare(right.name)),
    },
  ].filter((group) => group.pages.length > 0);
}

function getPagesFolder(page: ProjectMapNode) {
  const parts = (page.file ?? "").split("/").filter(Boolean);
  const pagesIndex = parts.indexOf("pages");
  if (pagesIndex < 0) return null;

  const pathAfterPages = parts.slice(pagesIndex + 1);
  const directoryParts = pathAfterPages.slice(0, -1);
  const pageDirectories = directoryParts.filter((part) => !PAGE_INTERNAL_SEGMENTS.has(part));
  return pageDirectories.length > 1 ? pageDirectories[0] ?? null : null;
}

function pageFolderNodeId(folder: string) {
  return `folder:pages:${folder}`;
}

function viewEdge(from: string, to: string, label: string) {
  return {
    id: `view:${from}:${to}`,
    from,
    to,
    type: "view" as const,
    label,
  };
}

const PAGE_INTERNAL_SEGMENTS = new Set([
  "ui",
  "model",
  "api",
  "lib",
  "config",
  "types",
  "consts",
  "constants",
  "hooks",
  "services",
  "store",
]);
