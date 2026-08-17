import type { ProjectMapEdge, ProjectMapNode } from "../../graph/types.js";
import type { FlowQueries } from "../../flow/queries.js";
import { isIgnoredJsxNode } from "./collectReachableNodes.js";
import {
  SEMANTIC_EDGE_TYPES,
  type ProjectGraph,
  type ViewGraph,
  type ViewGraphEdge,
  type ViewGraphNode,
} from "./viewTypes.js";
import { buildImpactQueryView } from "./buildFlowQueryView.js";

export type ImpactSubgraph = {
  target: ProjectMapNode;
  /** Nodes that depend on the target (directly or transitively), with BFS distance. */
  affected: Array<{ node: ProjectMapNode; depth: number }>;
  /** The semantic edges that connect the affected nodes to the target. */
  edges: ProjectMapEdge[];
  /** Page module nodes whose pages are affected by a change of the target. */
  pages: ProjectMapNode[];
};

const MAX_DEPTH = 8;

// Reverse reachability: walk incoming semantic edges from the target up to
// page-level nodes ("what breaks if I change this?"). Pages are roots, so the
// walk never continues past them.
export function collectImpactSubgraph(graph: ProjectGraph, targetId: string): ImpactSubgraph | null {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const target = nodesById.get(targetId);
  if (!target) return null;

  const incoming = new Map<string, ProjectMapEdge[]>();
  for (const edge of graph.edges) {
    if (!SEMANTIC_EDGE_TYPES.has(edge.type)) continue;
    const list = incoming.get(edge.to) ?? [];
    list.push(edge);
    incoming.set(edge.to, list);
  }

  const depths = new Map<string, number>([[targetId, 0]]);
  const affected: Array<{ node: ProjectMapNode; depth: number }> = [];
  const edges: ProjectMapEdge[] = [];
  const queue: string[] = [targetId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const depth = depths.get(currentId) ?? 0;
    if (depth >= MAX_DEPTH) continue;

    for (const edge of incoming.get(currentId) ?? []) {
      const dependent = nodesById.get(edge.from);
      if (!dependent || isIgnoredJsxNode(dependent)) continue;

      edges.push(edge);
      if (depths.has(edge.from)) continue;

      depths.set(edge.from, depth + 1);
      affected.push({ node: dependent, depth: depth + 1 });
      if (!isPageLevel(dependent)) queue.push(edge.from);
    }
  }

  return {
    target,
    affected,
    edges,
    pages: resolveAffectedPages(graph, affected.map((entry) => entry.node)),
  };
}

export type ImpactSummary = {
  target: ProjectMapNode;
  pages: ProjectMapNode[];
  groups: Array<{ kind: ProjectMapNode["type"]; nodes: ProjectMapNode[] }>;
};

const IMPACT_GROUP_ORDER: ProjectMapNode["type"][] = [
  "widget", "feature", "entity", "component", "hook", "selector", "slice-model", "action", "api",
];

// Flat, grouped view of the blast radius for the side list: affected pages, then
// affected nodes bucketed by kind. Pure so it can be unit-tested.
export function summarizeImpactSubgraph(impact: ImpactSubgraph): ImpactSummary {
  const byType = new Map<ProjectMapNode["type"], ProjectMapNode[]>();
  const seen = new Set<string>();
  for (const { node } of impact.affected) {
    if (isPageLevel(node) || seen.has(node.id)) continue;
    seen.add(node.id);
    const list = byType.get(node.type) ?? [];
    list.push(node);
    byType.set(node.type, list);
  }

  const groups = IMPACT_GROUP_ORDER
    .filter((kind) => byType.has(kind))
    .map((kind) => ({ kind, nodes: byType.get(kind)!.sort((a, b) => a.name.localeCompare(b.name)) }));

  return { target: impact.target, pages: impact.pages, groups };
}

export function buildImpactView(graph: ProjectGraph, targetId: string, flowQueries?: FlowQueries): ViewGraph {
  if (flowQueries) return buildImpactQueryView(graph, flowQueries, targetId);
  const impact = collectImpactSubgraph(graph, targetId);
  if (!impact) return { nodes: [], edges: [] };

  const nodes: ViewGraphNode[] = [];
  const edges: ViewGraphEdge[] = [];
  const maxDepth = impact.affected.reduce((max, entry) => Math.max(max, entry.depth), 0);
  const rowsPerColumn = new Map<number, number>();

  const place = (column: number) => {
    const row = rowsPerColumn.get(column) ?? 0;
    rowsPerColumn.set(column, row + 1);
    return { x: column * 360, y: row * 130 };
  };

  nodes.push({
    ...semanticCard(impact.target),
    position: place(0),
    badgeLabel: "target",
    subtitle: `target · ${impact.pages.length} pages affected`,
  });

  for (const entry of impact.affected) {
    nodes.push({
      ...semanticCard(entry.node),
      position: place(entry.depth),
    });
  }

  for (const edge of impact.edges) {
    edges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      sourceEdge: edge,
      label: edge.type,
    });
  }

  // Page modules in the rightmost column, linked from their page components.
  const affectedIds = new Set(impact.affected.map((entry) => entry.node.id));
  for (const page of impact.pages) {
    if (affectedIds.has(page.id)) continue;
    nodes.push({
      ...semanticCard(page),
      position: place(maxDepth + 1),
    });
    for (const entry of impact.affected) {
      if (isPageLevel(entry.node) && pageSliceOf(entry.node) === pageSliceOf(page)) {
        edges.push({
          id: `view:impact:${entry.node.id}:${page.id}`,
          from: entry.node.id,
          to: page.id,
          type: "view",
          label: "page",
        });
      }
    }
  }

  return { nodes, edges };
}

function semanticCard(node: ProjectMapNode): Omit<ViewGraphNode, "position"> {
  return {
    id: node.id,
    kind: "semantic-card",
    sourceNode: node,
    label: node.name,
    file: node.file,
    nodeType: node.type,
    fsdLayer: node.fsd?.layer,
    fsdSlice: node.fsd?.slice,
  };
}

function isPageLevel(node: ProjectMapNode) {
  return node.type === "page" || node.fsd?.layer === "pages";
}

function pageSliceOf(node: ProjectMapNode) {
  return node.fsd?.slice ?? node.name;
}

// Affected page-layer nodes are usually components; surface the page module
// nodes themselves so the blast radius reads as a list of pages.
function resolveAffectedPages(graph: ProjectGraph, affected: ProjectMapNode[]) {
  const pageModules = graph.nodes.filter((node) => node.type === "page");
  const pages = new Map<string, ProjectMapNode>();

  for (const node of affected) {
    if (!isPageLevel(node)) continue;
    const pageModule = node.type === "page"
      ? node
      : pageModules.find((candidate) => pageSliceOf(candidate) === pageSliceOf(node));
    const resolved = pageModule ?? node;
    pages.set(resolved.id, resolved);
  }

  return Array.from(pages.values()).sort((left, right) => left.name.localeCompare(right.name));
}
