import type { FlowQueries, ValueFlowDetail } from "../../flow/queries.js";
import type { FlowEdge, FlowNode } from "../../flow/types.js";
import type { ProjectMapGraph, ProjectMapNode } from "../../graph/types.js";
import type { ViewGraph, ViewGraphEdge, ViewGraphNode } from "./viewTypes.js";

const COLUMN_GAP = 340;
const ROW_GAP = 154;
// Stage headers sit one row-height above the top-most card in each column.
const STAGE_HEADER_Y_OFFSET = 96;
const STAGE_HEADER_ID_PREFIX = "flow-stage-header:";

/**
 * The demoted page-wide "aggregate" canvas: every flow of the page drawn as one
 * left→right graph. Plan 17 §2.3 keeps this only as an aggregated overview, so
 * the default Flows presentation is the list, not this. Stage headers label the
 * columns so the canvas is readable rather than "N columns without any id".
 */
export function buildPageFlowQueryView(
  graph: ProjectMapGraph,
  queries: FlowQueries,
  pageId: string,
  inspectedOwnerId?: string,
  selectedFlowNodeId?: string
): ViewGraph {
  const summaries = queries.listPageFlows(pageId);
  let details = summaries.flatMap((summary) => queries.getValueFlow(summary.id) ?? []);
  if (selectedFlowNodeId) {
    details = details.filter((detail) => detail.nodes.some((node) => node.id === selectedFlowNodeId));
  } else if (inspectedOwnerId) {
    details = details.filter((detail) => detail.nodes.some((node) => node.ownerNodeId === inspectedOwnerId));
  }
  return withStageHeaders(viewFromDetails(graph, details));
}

/**
 * One flow's trace, restricted to exactly that flow's nodes and edges. This is
 * what a Flows-list row opens: source → consumer left to right, its own
 * convergence branches visible, no other page flow drawn (plan 17 §2.3).
 */
export function buildSingleFlowQueryView(
  graph: ProjectMapGraph,
  queries: FlowQueries,
  flowId: string
): ViewGraph {
  const detail = queries.getValueFlow(flowId);
  if (!detail) return { nodes: [], edges: [] };
  return withStageHeaders(viewFromDetails(graph, [detail]));
}

/**
 * Prepend a non-interactive header card per column, labelled with that column's
 * dominant flow stage (Network / Selector / Hook / UI receiver …), so a trace
 * canvas has visible column identification. Pure so the placement stays testable.
 */
export function withStageHeaders(view: ViewGraph): ViewGraph {
  const staged = view.nodes.filter((node) => node.kind === "semantic-card" && node.dataFlow?.stage);
  if (staged.length === 0) return view;

  const byColumn = new Map<number, ViewGraphNode[]>();
  for (const node of staged) {
    const column = Math.round(node.position.x / COLUMN_GAP);
    (byColumn.get(column) ?? byColumn.set(column, []).get(column)!).push(node);
  }

  const topY = Math.min(...staged.map((node) => node.position.y));
  const headers: ViewGraphNode[] = [...byColumn.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([column, columnNodes]): ViewGraphNode => ({
      id: `${STAGE_HEADER_ID_PREFIX}${column}`,
      kind: "stage-header",
      label: dominantStage(columnNodes),
      position: { x: column * COLUMN_GAP, y: topY - STAGE_HEADER_Y_OFFSET },
    }));

  return { nodes: [...headers, ...view.nodes], edges: view.edges };
}

function dominantStage(nodes: ViewGraphNode[]): string {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const stage = node.dataFlow?.stage;
    if (stage) counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  let best = nodes[0]?.dataFlow?.stage ?? "";
  let bestCount = 0;
  for (const [stage, count] of counts) {
    if (count > bestCount) {
      best = stage;
      bestCount = count;
    }
  }
  return best;
}

export function buildImpactQueryView(
  graph: ProjectMapGraph,
  queries: FlowQueries,
  targetId: string
): ViewGraph {
  const impact = queries.getImpact(targetId);
  if (!impact) return { nodes: [], edges: [] };

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const possibleNodeIds = new Set(impact.possibleNodeIds);
  const possibleEdgeIds = new Set(impact.possibleEdgeIds);
  // Possible impact stays on the canvas but is marked, never silently merged.
  const base = viewFromFlowParts(
    graph,
    [...impact.nodes, ...impact.possibleNodes],
    [...impact.edges, ...impact.possibleEdges]
  );
  for (const node of base.nodes) {
    if (!possibleNodeIds.has(node.id)) continue;
    node.badgeLabel = "possible";
    node.dataFlow = { ...node.dataFlow, stage: `Possibly affected · ${node.dataFlow?.stage ?? ""}`.trim() };
  }
  for (const edge of base.edges) {
    if (possibleEdgeIds.has(edge.id)) edge.label = `${edge.label ?? ""} (possible)`.trim();
  }

  const maxColumn = base.nodes.reduce((max, node) => Math.max(max, Math.round(node.position.x / COLUMN_GAP)), 0);
  const possibleLeaves = leafNodeIds(impact.possibleNodeIds, [...impact.edges, ...impact.possibleEdges]);
  let pageRow = 0;
  for (const pageId of impact.affectedPageIds) {
    const page = nodesById.get(pageId);
    if (!page) continue;
    base.nodes.push(graphNodeCard(page, { x: (maxColumn + 1) * COLUMN_GAP, y: pageRow * ROW_GAP }, "Affected page"));
    pageRow += 1;
    for (const terminalId of impact.terminalNodeIds) {
      base.edges.push({
        id: `flow-impact:${terminalId}:${page.id}`,
        from: terminalId,
        to: page.id,
        type: "view",
        label: "affects page",
      });
    }
  }
  for (const pageId of impact.possibleAffectedPageIds) {
    const page = nodesById.get(pageId);
    if (!page) continue;
    base.nodes.push(graphNodeCard(page, { x: (maxColumn + 1) * COLUMN_GAP, y: pageRow * ROW_GAP }, "Possibly affected page"));
    pageRow += 1;
    for (const leafId of possibleLeaves) {
      base.edges.push({
        id: `flow-impact-possible:${leafId}:${page.id}`,
        from: leafId,
        to: page.id,
        type: "view",
        label: "possibly affects page",
      });
    }
  }
  return base;
}

function leafNodeIds(nodeIds: string[], edges: FlowEdge[]): string[] {
  const withOutgoing = new Set(edges.map((edge) => edge.from));
  return nodeIds.filter((id) => !withOutgoing.has(id));
}

function viewFromDetails(graph: ProjectMapGraph, details: ValueFlowDetail[]): ViewGraph {
  const nodes = uniqueById(details.flatMap((detail) => detail.nodes));
  const edges = uniqueById(details.flatMap((detail) => detail.edges));
  return viewFromFlowParts(graph, nodes, edges);
}

function viewFromFlowParts(graph: ProjectMapGraph, nodes: FlowNode[], edges: FlowEdge[]): ViewGraph {
  const lifecycle = collapseSecondaryLifecycleWrites(nodes, edges);
  nodes = lifecycle.nodes;
  edges = lifecycle.edges;
  const graphNodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = groupEdges(edges, "to");
  const outgoing = groupEdges(edges, "from");
  const columnById = flowColumns(nodes, edges);
  const rows = new Map<number, number>();

  const viewNodes = [...nodes].sort((left, right) =>
    (columnById.get(left.id) ?? 0) - (columnById.get(right.id) ?? 0) || left.id.localeCompare(right.id)
  ).map((node): ViewGraphNode => {
    const column = columnById.get(node.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    const sourceNode = node.ownerNodeId ? graphNodesById.get(node.ownerNodeId) : undefined;
    const inputEdges = incoming.get(node.id) ?? [];
    const inputs = node.kind === "prop"
      ? inputEdges.map((edge) => `${lastPathPart(node.path ?? node.name)}: ${flowNodeName(nodes, edge.from)}`)
      : inputEdges.map((edge) => edgeLabel(edge, nodes, "from"));
    return {
      id: node.id,
      kind: "semantic-card",
      sourceNode,
      label: node.name,
      file: node.evidence[0]?.file ?? sourceNode?.file,
      nodeType: viewNodeType(node),
      fsdLayer: sourceNode?.fsd?.layer,
      fsdSlice: sourceNode?.fsd?.slice,
      subtitle: node.path && node.path !== node.name ? node.path : undefined,
      dataFlow: {
        stage: stageLabel(node),
        inputs,
        values: node.path ? [node.path] : undefined,
        outputs: (outgoing.get(node.id) ?? []).map((edge) => edgeLabel(edge, nodes, "to")),
        evidence: node.evidence,
        note: node.gap?.message,
        secondaryWrites: lifecycle.secondaryWritesByTarget.get(node.id),
      },
      position: { x: column * COLUMN_GAP, y: row * ROW_GAP },
    };
  });

  const viewEdges: ViewGraphEdge[] = edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: "view",
    label: edge.relation,
    flowEdge: edge,
  }));
  return { nodes: viewNodes, edges: viewEdges };
}

function collapseSecondaryLifecycleWrites(nodes: FlowNode[], edges: FlowEdge[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const writesByTarget = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    if (edge.relation !== "writes" || !edge.stateWrite) continue;
    const current = writesByTarget.get(edge.to) ?? [];
    current.push(edge);
    writesByTarget.set(edge.to, current);
  }

  const secondaryEdgeIds = new Set<string>();
  const secondaryOperationIds = new Set<string>();
  const secondaryWritesByTarget = new Map<string, string[]>();
  for (const [targetId, writes] of writesByTarget) {
    const primary = writes.filter((edge) =>
      edge.stateWrite?.lifecycle === "fulfilled" &&
      (edge.stateWrite.valueOrigin === "payload" || edge.stateWrite.valueOrigin === "derived")
    );
    if (primary.length === 0) continue;

    const secondary = writes.filter((edge) => !primary.includes(edge));
    if (secondary.length === 0) continue;
    secondaryWritesByTarget.set(targetId, secondary.map((edge) => {
      const operation = nodesById.get(edge.from);
      const write = edge.stateWrite!;
      return `${operation?.name ?? write.lifecycle} · ${write.valueOrigin}`;
    }));
    for (const edge of secondary) {
      secondaryEdgeIds.add(edge.id);
      secondaryOperationIds.add(edge.from);
    }
  }

  if (secondaryEdgeIds.size === 0) return { nodes, edges, secondaryWritesByTarget };
  const visibleEdges = edges.filter((edge) => !secondaryEdgeIds.has(edge.id));
  const connectedNodeIds = new Set(visibleEdges.flatMap((edge) => [edge.from, edge.to]));
  const hiddenOperationIds = new Set(
    [...secondaryOperationIds].filter((operationId) => !connectedNodeIds.has(operationId))
  );

  return {
    nodes: nodes.filter((node) => !hiddenOperationIds.has(node.id)),
    edges: visibleEdges,
    secondaryWritesByTarget,
  };
}

function flowColumns(nodes: FlowNode[], edges: FlowEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  const columns = new Map<string, number>();
  const queue = nodes.filter((node) => incomingCount.get(node.id) === 0).map((node) => node.id).sort();
  for (const id of queue) columns.set(id, 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of outgoing.get(current) ?? []) {
      columns.set(edge.to, Math.max(columns.get(edge.to) ?? 0, (columns.get(current) ?? 0) + 1));
      const nextCount = (incomingCount.get(edge.to) ?? 1) - 1;
      incomingCount.set(edge.to, nextCount);
      if (nextCount === 0) queue.push(edge.to);
    }
  }

  for (const node of nodes) columns.set(node.id, columns.get(node.id) ?? fallbackColumn(node));
  return columns;
}

function fallbackColumn(node: FlowNode): number {
  const order: Record<FlowNode["kind"], number> = {
    boundary: 0,
    api: 0,
    "async-operation": 1,
    "state-field": 2,
    "selector-result": 3,
    "hook-input": 4,
    "hook-return": 5,
    "component-value": 6,
    prop: 7,
    "ui-effect": 7,
    gap: 0,
  };
  return order[node.kind];
}

function viewNodeType(node: FlowNode): string {
  const map: Record<FlowNode["kind"], string> = {
    boundary: "boundary",
    api: "api",
    "async-operation": "thunk",
    "state-field": "slice-model",
    "selector-result": "selector",
    "hook-input": "hook",
    "hook-return": "hook",
    "component-value": "component",
    prop: "prop",
    "ui-effect": "ui-effect",
    gap: "unknown",
  };
  return map[node.kind];
}

function stageLabel(node: FlowNode): string {
  const map: Record<FlowNode["kind"], string> = {
    boundary: "Boundary",
    api: "Network",
    "async-operation": "Async operation",
    "state-field": "Store field",
    "selector-result": "Selector",
    "hook-input": "Hook input",
    "hook-return": "Hook return",
    "component-value": "Component value",
    prop: "UI receiver",
    "ui-effect": "UI effect",
    gap: "Trace gap",
  };
  return map[node.kind];
}

function edgeLabel(edge: FlowEdge, nodes: FlowNode[], endpoint: "from" | "to"): string {
  const node = nodes.find((entry) => entry.id === edge[endpoint]);
  return node ? `${edge.relation}: ${node.name}` : edge.relation;
}

function flowNodeName(nodes: FlowNode[], id: string): string {
  return nodes.find((node) => node.id === id)?.name ?? id;
}

function lastPathPart(path: string): string {
  return path.split(".").filter(Boolean).at(-1) ?? path;
}

function groupEdges(edges: FlowEdge[], endpoint: "from" | "to"): Map<string, FlowEdge[]> {
  const grouped = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const list = grouped.get(edge[endpoint]) ?? [];
    list.push(edge);
    grouped.set(edge[endpoint], list);
  }
  return grouped;
}

function graphNodeCard(node: ProjectMapNode, position: { x: number; y: number }, stage: string): ViewGraphNode {
  return {
    id: node.id,
    kind: node.type === "page" ? "page-card" : "semantic-card",
    sourceNode: node,
    label: node.name,
    file: node.file,
    nodeType: node.type,
    fsdLayer: node.fsd?.layer,
    fsdSlice: node.fsd?.slice,
    dataFlow: { stage },
    position,
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
