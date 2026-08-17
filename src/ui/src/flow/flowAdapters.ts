import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { EdgeType } from "../../../graph/types.js";
import type { ViewGraph, ViewGraphEdge, ViewGraphNode } from "../../graph-view/viewTypes.js";
import { FolderCardNode, GroupCardNode, PageCardNode, SemanticNodeCard, StageHeaderNode, type CardNodeData } from "../nodes/CardNodes.js";


export const FSD_LAYERS = ["app", "pages", "widgets", "features", "entities", "shared", "unknown"];

export const NODE_TYPES = {
  pageCard: PageCardNode,
  folderCard: FolderCardNode,
  groupCard: GroupCardNode,
  semanticCard: SemanticNodeCard,
  stageHeader: StageHeaderNode,
};

export function toFlowNode(viewNode: ViewGraphNode): Node<CardNodeData> {
  const type = viewNode.kind === "page-card"
    ? "pageCard"
    : viewNode.kind === "folder-card"
      ? "folderCard"
      : viewNode.kind === "group-card"
        ? "groupCard"
        : viewNode.kind === "stage-header"
          ? "stageHeader"
          : "semanticCard";

  return {
    id: viewNode.id,
    type,
    position: viewNode.position,
    data: {
      viewNode,
    },
  };
}

export function toFlowEdge(edge: ViewGraphEdge, options: { showLabel?: boolean } = {}): Edge {
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    // Labels are noise at rest; show them only on hover/selection (see buildFlowGraph).
    label: options.showLabel ? edge.label ?? edge.type : undefined,
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
    style: {
      stroke: edgeColor(edge.type),
      strokeWidth: (edge.sourceEdge?.confidence ?? edge.flowEdge?.confidence) === "high" ? 2 : 1.5,
      // Module overlay edges are always dashed so they read as a layer on
      // top of the scan, not as scan results.
      strokeDasharray: edge.type === "enrichment"
        ? "4 3"
        : (edge.sourceEdge?.confidence ?? edge.flowEdge?.confidence) === "low"
          ? "5 5"
          : undefined,
    },
    labelStyle: {
      fill: "#4b4f55",
      fontWeight: 650,
      fontSize: 11,
    },
  };
}

/**
 * Assemble the React Flow graph. Edge labels appear only for edges touching the
 * selected node (labels at rest are noise). Focus+context dimming on hover is
 * NOT done here — it is applied imperatively via CSS classes on the DOM (see
 * applyHoverFocus) so hovering never rebuilds this array and the canvas can't
 * flicker. Pure, so it stays unit-testable without a canvas.
 */
export function buildFlowGraph(
  viewGraph: ViewGraph,
  options: { selectedNodeId?: string | null } = {}
): { nodes: Node<CardNodeData>[]; edges: Edge[] } {
  const selectedNodeId = options.selectedNodeId ?? null;

  return {
    nodes: viewGraph.nodes.map(toFlowNode),
    edges: viewGraph.edges.map((viewEdge) => {
      const showLabel = selectedNodeId !== null && (viewEdge.from === selectedNodeId || viewEdge.to === selectedNodeId);
      return toFlowEdge(viewEdge, { showLabel });
    }),
  };
}

/**
 * Focus+context dimming applied straight to the rendered DOM: light up the
 * hovered node and its whole path — every ancestor (following incoming edges up
 * to the page/widget) and every descendant (outgoing edges down) — plus the
 * edges along it, and dim the rest via a container class. Imperative on purpose:
 * it touches no React state, so a hover never re-renders or rebuilds the graph
 * (the source of the earlier flicker).
 */
export function applyHoverFocus(root: HTMLElement | null, viewGraph: ViewGraph, nodeId: string | null): void {
  if (!root) return;
  const canvas = root.querySelector<HTMLElement>(".react-flow");
  if (!canvas) return;

  if (!nodeId) {
    canvas.classList.remove("flow-dim");
    canvas.querySelectorAll(".flow-lit").forEach((el) => el.classList.remove("flow-lit"));
    canvas.querySelectorAll(".flow-lit-edge").forEach((el) => el.classList.remove("flow-lit-edge"));
    return;
  }

  const { nodes: litNodes, edges: litEdges } = collectFocusPath(viewGraph, nodeId);

  canvas.classList.add("flow-dim");
  canvas.querySelectorAll<HTMLElement>(".react-flow__node").forEach((el) => {
    el.classList.toggle("flow-lit", litNodes.has(el.dataset.id ?? ""));
  });
  canvas.querySelectorAll<HTMLElement>(".react-flow__edge").forEach((el) => {
    el.classList.toggle("flow-lit-edge", litEdges.has(el.dataset.id ?? ""));
  });
}

/**
 * The node's full lineage: itself, all ancestors reachable by walking incoming
 * edges, all descendants by walking outgoing edges, and every edge on those
 * paths. So hovering a leaf lights the whole chain up to its widget/feature.
 */
export function collectFocusPath(viewGraph: ViewGraph, nodeId: string): { nodes: Set<string>; edges: Set<string> } {
  const incoming = new Map<string, ViewGraph["edges"]>();
  const outgoing = new Map<string, ViewGraph["edges"]>();
  for (const edge of viewGraph.edges) {
    (outgoing.get(edge.from) ?? outgoing.set(edge.from, []).get(edge.from)!).push(edge);
    (incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to)!).push(edge);
  }

  const nodes = new Set<string>([nodeId]);
  const edges = new Set<string>();

  const walk = (adjacency: Map<string, ViewGraph["edges"]>, nextOf: (edge: ViewGraph["edges"][number]) => string) => {
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of adjacency.get(current) ?? []) {
        edges.add(edge.id);
        const next = nextOf(edge);
        if (nodes.has(next)) continue;
        nodes.add(next);
        queue.push(next);
      }
    }
  };

  walk(incoming, (edge) => edge.from); // ancestors
  walk(outgoing, (edge) => edge.to); // descendants
  return { nodes, edges };
}

function edgeColor(type: EdgeType | "view" | "enrichment") {
  if (type === "enrichment") return "#7d5fa8";
  if (type === "renders") return "#3d6fb6";
  if (type === "usesHook") return "#8a5f3f";
  if (type === "usesSelector" || type === "readsSlice") return "#5f6f36";
  if (type === "dispatchesAction") return "#b25757";
  if (type === "callsApi") return "#2d7668";
  if (type === "dependsOn" || type === "imports") return "#5f6771";
  if (type === "view") return "#9a8f80";
  return "#777";
}

export function isDataFlowTargetViewNode(viewNode: ViewGraphNode) {
  return viewNode.id.startsWith("value-flow:target:");
}

export function dataFlowTargetIdFromViewNode(viewNode: ViewGraphNode) {
  return viewNode.id.slice("value-flow:".length);
}

export function toggleSet<T>(set: Set<T>, value: T) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
