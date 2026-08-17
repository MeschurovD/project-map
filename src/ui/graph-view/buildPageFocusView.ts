import type { ProjectMapEdge, ProjectMapNode } from "../../graph/types.js";
import type { ProjectFact } from "../../scanner/facts.js";
import type { FlowQueries } from "../../flow/queries.js";
import {
  isIgnoredJsxNode,
  isReduxNode,
} from "./collectReachableNodes.js";
import { buildPageFlowQueryView, buildSingleFlowQueryView } from "./buildFlowQueryView.js";
import { collectDirectPageComposition, findPageComponent } from "./collectDirectPageComposition.js";
import { collectNodeInternals, type NodeInternals } from "./collectNodeInternals.js";
import {
  compactCountBadges,
  isPageFocusEvidenceEdge,
  semanticEdgesBetween,
  semanticNode,
  viewEdge,
} from "./pageFocusCards.js";
import {
  type FocusGroupLayer,
  type GraphViewState,
  type ProjectGraph,
  type ViewGraph,
  type ViewGraphEdge,
  type ViewGraphNode,
} from "./viewTypes.js";

const PAGE_COMPOSITION_GROUPS: FocusGroupLayer[] = [
  "widgets",
  "features",
  "entities",
  "selectors",
  "hooks",
];

const PAGE_X = 0;
const GROUP_X = 320;
const ITEM_X = 650;
const INTERNAL_GROUP_X = 980;
const INTERNAL_ITEM_X = 1300;
const GROUP_START_Y = -280;
// Row steps leave room for the tallest cards (badges + enrichment summary), so
// neighbouring cards don't touch or overlap.
const COMPOSITION_ITEM_Y_STEP = 150;
const COMPOSITION_GROUP_MIN_STEP = 210;
const INTERNAL_ITEM_Y_STEP = 144;
const INTERNAL_GROUP_X_OFFSET = INTERNAL_GROUP_X - ITEM_X;
const INTERNAL_ITEM_X_OFFSET = INTERNAL_ITEM_X - ITEM_X;

export function buildPageFocusView(
  graph: ProjectGraph,
  selectedPageId: string,
  state: GraphViewState,
  _facts: ProjectFact[] = [],
  flowQueries?: FlowQueries
): ViewGraph {
  const page = graph.nodes.find((node) => node.id === selectedPageId);
  if (!page) {
    return { nodes: [], edges: [] };
  }

  const inspectedNode = state.inspectedNodeId
    ? graph.nodes.find((node) => node.id === state.inspectedNodeId)
    : null;

  if (state.pageFocusTab === "data-flow") {
    if (!flowQueries) return { nodes: [], edges: [] };
    // A single flow's trace takes priority over the aggregate/list toggle.
    if (state.selectedFlowId) {
      return buildSingleFlowQueryView(graph, flowQueries, state.selectedFlowId);
    }
    // The demoted page-wide canvas of every flow, reached via the aggregate toggle.
    if (state.flowsView === "aggregate") {
      return buildPageFlowQueryView(graph, flowQueries, page.id, inspectedNode?.id);
    }
    // Default: the Flows list renders outside the canvas (App), so no view graph.
    return { nodes: [], edges: [] };
  }

  if (state.pageFocusTab === "actions" || state.pageFocusTab === "impact") {
    return { nodes: [], edges: [] };
  }

  const composition = collectDirectPageComposition(graph, selectedPageId);
  const pageComponent = findPageComponent(graph, page);
  const groups: Record<FocusGroupLayer, ProjectMapNode[]> = {
    widgets: composition.widgets,
    features: composition.features,
    entities: composition.entities,
    shared: [],
    selectors: state.showRedux ? composition.selectors : [],
    hooks: state.showHooks ? composition.hooks : [],
    external: [],
    transitive: [],
  };
  const nodes: ViewGraphNode[] = [
    {
      id: page.id,
      kind: "page-card",
      sourceNode: page,
      label: page.name,
      file: page.file,
      nodeType: page.type,
      fsdLayer: page.fsd?.layer,
      fsdSlice: page.fsd?.slice,
      summaryBadges: compactCountBadges([
        ["widgets", composition.widgets.length],
        ["features", composition.features.length],
        ["entities", composition.entities.length],
        ["selectors", composition.selectors.length],
        ["hooks", composition.hooks.length],
      ]),
      position: { x: PAGE_X, y: 0 },
    },
  ];
  const edges: ViewGraphEdge[] = [];
  const compositionNodeIds: string[] = [];

  let groupY = GROUP_START_Y;
  for (const layer of PAGE_COMPOSITION_GROUPS) {
    const groupId = groupNodeId(selectedPageId, layer);
    const children = groups[layer];
    if (children.length === 0) continue;

    const groupPosition = { x: GROUP_X, y: groupY };
    nodes.push({
      id: groupId,
      kind: "group-card",
      label: labelForGroup(layer),
      position: groupPosition,
      count: children.length,
      badgeLabel: `${badgeLabelForGroup(layer)} ${children.length}`,
      groupLayer: layer,
    });
    edges.push(viewEdge(page.id, groupId, layer));

    children.forEach((child, index) => {
      const reasonEdges = pageComponent ? semanticEdgesBetween(graph, pageComponent.id, child.id) : [];
      nodes.push(semanticNode(graph, child, state, {
        x: ITEM_X,
        y: groupPosition.y + index * COMPOSITION_ITEM_Y_STEP,
      }, child.id, reasonEdges));
      compositionNodeIds.push(child.id);
      edges.push(viewEdge(groupId, child.id, child.type, reasonEdges[0]));
    });

    groupY += Math.max(COMPOSITION_GROUP_MIN_STEP, children.length * COMPOSITION_ITEM_Y_STEP + 64);
  }

  if (inspectedNode) {
    let inspectedViewNodeId = inspectedNode.id;

    if (!nodes.some((node) => node.id === inspectedNode.id)) {
      const inspectionPath = findInspectionPath(graph, compositionNodeIds, inspectedNode.id, state);

      if (inspectionPath) {
        inspectedViewNodeId = appendInspectionPath(graph, nodes, edges, inspectionPath, state);
      } else {
        const reasonEdges = pageComponent ? semanticEdgesBetween(graph, pageComponent.id, inspectedNode.id) : [];
        nodes.push(semanticNode(graph, inspectedNode, state, {
          x: ITEM_X,
          y: groupY + 20,
        }, inspectedNode.id, reasonEdges));
        edges.push(viewEdge(page.id, inspectedNode.id, "inspect", reasonEdges[0]));
      }
    }
    appendInternals(graph, nodes, edges, inspectedNode, state, inspectedViewNodeId);
  }

  return {
    nodes,
    edges,
  };
}

export function groupNodeId(pageId: string, layer: FocusGroupLayer) {
  return `group:${pageId}:${layer}`;
}

type InspectGroup = {
  id: string;
  label: string;
  edgeLabel: string;
  getChildren: (internals: NodeInternals) => ProjectMapNode[];
  isEnabled: (state: GraphViewState) => boolean;
};

const INTERNAL_GROUPS: InspectGroup[] = [
  {
    id: "renders",
    label: "UI children",
    edgeLabel: "renders",
    getChildren: (internals) => internals.renderedComponents,
    isEnabled: () => true,
  },
  {
    id: "hooks",
    label: "Hook",
    edgeLabel: "uses hook",
    getChildren: (internals) => internals.hooks,
    isEnabled: (state) => state.showHooks,
  },
  {
    id: "selectors",
    label: "Selectors",
    edgeLabel: "uses selector",
    getChildren: (internals) => internals.selectors,
    isEnabled: (state) => state.showRedux,
  },
  {
    id: "actions",
    label: "Actions",
    edgeLabel: "dispatches",
    getChildren: (internals) => internals.actions,
    isEnabled: () => true,
  },
  {
    id: "api",
    label: "API calls",
    edgeLabel: "calls api",
    getChildren: (internals) => internals.apiCalls,
    isEnabled: () => true,
  },
  {
    id: "dependencies",
    label: "Dependencies",
    edgeLabel: "depends on",
    getChildren: (internals) => internals.fsdDependencies,
    isEnabled: () => true,
  },
];

function appendInternals(
  graph: ProjectGraph,
  nodes: ViewGraphNode[],
  edges: ViewGraphEdge[],
  inspectedNode: ProjectMapNode,
  state: GraphViewState,
  sourceViewNodeId = inspectedNode.id
) {
  const sourceViewNode = nodes.find((node) => node.id === sourceViewNodeId);
  const childViewNodeIds = new Map<string, string>();
  if (!sourceViewNode) return childViewNodeIds;

  const internals = collectNodeInternals(graph, inspectedNode.id, {
    showFiles: state.showFiles,
    showImports: state.showImports,
    showUnknown: state.showUnknown,
  });

  let row = 0;
  for (const group of INTERNAL_GROUPS) {
    if (!group.isEnabled(state)) continue;

    const children = group.getChildren(internals)
      .filter((node) => isVisibleChild(node, state));
    if (children.length === 0) continue;

    const groupViewNodeId = internalGroupNodeId(inspectedNode.id, group.id);
    if (!nodes.some((node) => node.id === groupViewNodeId)) {
      nodes.push({
        id: groupViewNodeId,
        kind: "group-card",
        label: group.label,
        position: {
          x: sourceViewNode.position.x + INTERNAL_GROUP_X_OFFSET,
          y: sourceViewNode.position.y + row * INTERNAL_ITEM_Y_STEP,
        },
        count: children.length,
        badgeLabel: `${group.label} ${children.length}`,
      });
    }
    if (!edges.some((edge) => edge.from === sourceViewNode.id && edge.to === groupViewNodeId)) {
      edges.push(viewEdge(sourceViewNode.id, groupViewNodeId, group.label));
    }
    row += 1;

    children.forEach((child) => {
      const viewNodeId = internalNodeId(inspectedNode.id, group.id, child.id);
      const reasonEdges = semanticEdgesBetween(graph, inspectedNode.id, child.id);
      if (!nodes.some((node) => node.id === viewNodeId)) {
        nodes.push(semanticNode(graph, child, state, {
          x: sourceViewNode.position.x + INTERNAL_ITEM_X_OFFSET,
          y: sourceViewNode.position.y + row * INTERNAL_ITEM_Y_STEP,
        }, viewNodeId, reasonEdges));
      }
      if (!edges.some((edge) => edge.from === groupViewNodeId && edge.to === viewNodeId)) {
        edges.push(viewEdge(groupViewNodeId, viewNodeId, group.edgeLabel, reasonEdges[0]));
      }
      childViewNodeIds.set(child.id, viewNodeId);
      row += 1;
    });
  }

  return childViewNodeIds;
}

type InspectionPathStep = {
  node: ProjectMapNode;
  edge?: ProjectMapEdge;
};

function findInspectionPath(
  graph: ProjectGraph,
  startIds: string[],
  targetId: string,
  state: GraphViewState
): InspectionPathStep[] | null {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, ProjectMapEdge[]>();

  for (const edge of graph.edges) {
    if (!isPageFocusEvidenceEdge(edge)) continue;
    const edges = outgoing.get(edge.from) ?? [];
    edges.push(edge);
    outgoing.set(edge.from, edges);
  }

  const queue: InspectionPathStep[][] = [];
  const visited = new Set<string>();

  for (const startId of startIds) {
    const start = nodesById.get(startId);
    if (!start) continue;
    queue.push([{ node: start }]);
    visited.add(startId);
  }

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1]!.node;
    if (current.id === targetId) return path;
    if (path.length >= 6) continue;

    for (const edge of outgoing.get(current.id) ?? []) {
      if (visited.has(edge.to)) continue;
      const next = nodesById.get(edge.to);
      if (!next || !isVisibleChild(next, state)) continue;

      const nextPath = [...path, { node: next, edge }];
      if (next.id === targetId) return nextPath;

      visited.add(next.id);
      queue.push(nextPath);
    }
  }

  return null;
}

function appendInspectionPath(
  graph: ProjectGraph,
  nodes: ViewGraphNode[],
  edges: ViewGraphEdge[],
  path: InspectionPathStep[],
  state: GraphViewState
) {
  let parentViewNodeId = nodes.find((node) => node.sourceNode?.id === path[0]?.node.id)?.id;
  if (!parentViewNodeId) return path[path.length - 1]?.node.id ?? "";

  for (let index = 0; index < path.length - 1; index += 1) {
    const current = path[index]!.node;
    const next = path[index + 1]!.node;
    const childViewNodeIds = appendInternals(graph, nodes, edges, current, state, parentViewNodeId);
    parentViewNodeId = childViewNodeIds.get(next.id);

    if (!parentViewNodeId) {
      return path[path.length - 1]?.node.id ?? "";
    }
  }

  return parentViewNodeId;
}

function internalGroupNodeId(sourceNodeId: string, groupId: string) {
  return `internal-group:${sourceNodeId}:${groupId}`;
}

function internalNodeId(sourceNodeId: string, groupId: string, targetNodeId: string) {
  return `internal:${sourceNodeId}:${groupId}:${targetNodeId}`;
}

function isVisibleChild(node: ProjectMapNode, state: GraphViewState) {
  if (isIgnoredJsxNode(node)) return false;
  if (node.type === "file" && !state.showFiles) return false;
  if ((node.type === "unknown" || node.id.includes(":unknown:") || node.meta?.unresolved === true) && !state.showUnknown) {
    return false;
  }
  if (node.type === "hook" && !state.showHooks) return false;
  if (isReduxNode(node) && !state.showRedux) return false;
  return state.visibleLayers.has(node.fsd?.layer ?? "unknown");
}

function labelForGroup(layer: FocusGroupLayer) {
  if (layer === "selectors") return "Redux selectors";
  if (layer === "external") return "External UI";
  if (layer === "transitive") return "Transitive dependencies";
  return layer[0]!.toUpperCase() + layer.slice(1);
}

function badgeLabelForGroup(layer: FocusGroupLayer) {
  if (layer === "selectors") return "selectors";
  return layer;
}
