import type { EdgeType, ProjectMapNode } from "../../graph/types.js";
import { collectReachableSemanticNodes } from "./collectReachableNodes.js";
import { semanticNode, viewEdge } from "./pageFocusCards.js";
import type { GraphViewState, ProjectGraph, ViewGraph, ViewGraphEdge, ViewGraphNode } from "./viewTypes.js";

// Page-level data-flow view: how values move through the page, left to right by
// role — UI consumers → hooks → selectors → slice state → thunks/actions → API.
// Built straight from the graph's semantic edges (which already chain
// component→hook→selector→slice←thunk), so the columns mean "stage in the data
// flow", not "FSD layer". Composition ("what's on the page") stays in the
// dossier and the structure tree; this answers "where does the data come from".

const COLUMN_X = [0, 360, 720, 1080, 1440, 1800];
const ITEM_Y_STEP = 138;

// Which flow stage (column) a node sits in.
const COLUMN_BY_TYPE: Partial<Record<ProjectMapNode["type"], number>> = {
  page: 0,
  component: 0,
  widget: 0,
  feature: 0,
  entity: 0,
  hook: 1,
  selector: 2,
  "slice-model": 3,
  action: 4,
  thunk: 4,
  api: 5,
};

// Edges that represent data flow (kept) vs composition/structure (dropped here).
const FLOW_EDGE_TYPES = new Set<EdgeType>([
  "usesHook",
  "usesSelector",
  "readsSlice",
  "writesSlice",
  "callsApi",
  "dispatchesAction",
]);

export function buildPageDataFlowView(graph: ProjectGraph, page: ProjectMapNode, state: GraphViewState): ViewGraph {
  const reachable = collectReachableSemanticNodes(graph, page.id, {
    showFiles: false,
    showHooks: state.showHooks,
    showRedux: state.showRedux,
    showUnknown: state.showUnknown,
    maxDepth: 6,
  });

  // Keep the page plus any reachable node that has a place in the flow columns.
  const flowNodes = [page, ...reachable].filter((node, index, all) =>
    COLUMN_BY_TYPE[node.type] !== undefined &&
    all.findIndex((candidate) => candidate.id === node.id) === index
  );
  const shownIds = new Set(flowNodes.map((node) => node.id));

  const rowsPerColumn = new Map<number, number>();
  const nodes: ViewGraphNode[] = flowNodes.map((node) => {
    const column = COLUMN_BY_TYPE[node.type] ?? 0;
    const row = rowsPerColumn.get(column) ?? 0;
    rowsPerColumn.set(column, row + 1);
    const card = node.id === page.id
      ? pageCard(page)
      : semanticNode(graph, node, state, { x: 0, y: 0 });
    return { ...card, position: { x: COLUMN_X[column] ?? 0, y: row * ITEM_Y_STEP } };
  });

  const edges: ViewGraphEdge[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (!FLOW_EDGE_TYPES.has(edge.type)) continue;
    if (!shownIds.has(edge.from) || !shownIds.has(edge.to)) continue;
    const key = `${edge.from}->${edge.to}:${edge.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(viewEdge(edge.from, edge.to, edge.type, edge));
  }

  return { nodes, edges };
}

function pageCard(page: ProjectMapNode): Omit<ViewGraphNode, "position"> {
  return {
    id: page.id,
    kind: "page-card",
    sourceNode: page,
    label: page.name,
    file: page.file,
    nodeType: page.type,
    fsdLayer: page.fsd?.layer,
    fsdSlice: page.fsd?.slice,
  };
}
