import type {
  MergedEnrichmentAnnotation,
  MergedEnrichmentEdge,
  MergedNodeEnrichment,
} from "../../modules/enrichmentTypes.js";
import type { FlowIndex, FlowRelation } from "../../flow/types.js";
import type { Confidence } from "../../graph/types.js";
import type { ViewGraph, ViewGraphEdge } from "./viewTypes.js";

export type EnrichmentIndex = Map<string, MergedNodeEnrichment[]>;
export type EnrichmentAnnotationIndex = Map<string, MergedEnrichmentAnnotation[]>;

export type EnrichmentOverlay = {
  byNodeId: EnrichmentIndex;
  edges: MergedEnrichmentEdge[];
  /** Sidebar toggle: render overlay edges on top of the view. */
  showEdges: boolean;
};

export function indexEnrichmentByNodeId(entries: MergedNodeEnrichment[]): EnrichmentIndex {
  const index: EnrichmentIndex = new Map();
  for (const entry of entries) {
    const existing = index.get(entry.nodeId);
    if (existing) {
      existing.push(entry);
    } else {
      index.set(entry.nodeId, [entry]);
    }
  }
  return index;
}

export function indexEnrichmentAnnotations(
  entries: MergedEnrichmentAnnotation[],
  flowIndex?: FlowIndex
): EnrichmentAnnotationIndex {
  const index: EnrichmentAnnotationIndex = new Map();
  for (const entry of entries) {
    for (const target of entry.targets) {
      const key = `${target.type}:${target.id}`;
      const existing = index.get(key);
      if (existing) existing.push(entry);
      else index.set(key, [entry]);
    }
  }
  if (flowIndex) indexPropagatedAnnotations(index, entries, flowIndex);
  return index;
}

const IDENTITY_RELATIONS = new Set<FlowRelation>(["binds", "passes", "returns"]);
const CONTEXT_RELATIONS = new Set<FlowRelation>(["derives", "controls"]);
const MAX_IDENTITY_DISTANCE = 8;

type PropagationCandidate = NonNullable<MergedEnrichmentAnnotation["association"]> & {
  targetId: string;
};

function indexPropagatedAnnotations(
  index: EnrichmentAnnotationIndex,
  entries: MergedEnrichmentAnnotation[],
  flowIndex: FlowIndex
) {
  const nodeById = new Map(flowIndex.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Array<{
    nodeId: string;
    relation: FlowRelation;
    confidence: Confidence;
  }>>();
  for (const edge of flowIndex.edges) {
    addAdjacent(adjacency, edge.from, edge.to, edge.relation, edge.confidence);
    addAdjacent(adjacency, edge.to, edge.from, edge.relation, edge.confidence);
  }

  for (const entry of entries) {
    if (!entry.propagation) continue;
    const directIds = new Set(entry.targets
      .filter((target) => target.type === "flow-node")
      .map((target) => target.id));
    if (directIds.size === 0) continue;

    const candidates = new Map<string, PropagationCandidate>();
    for (const sourceId of directIds) {
      if (!nodeById.has(sourceId)) continue;
      const inherited = identityMatches(sourceId, adjacency);
      for (const match of inherited) {
        if (directIds.has(match.targetId)) continue;
        keepBestCandidate(candidates, {
          ...match,
          kind: "inherited",
          sourceTargetId: sourceId,
          sourceLabel: flowNodeLabel(nodeById.get(sourceId)),
        });
      }
      if (entry.propagation !== "context") continue;
      const identityScope = [{
        targetId: sourceId,
        relations: [] as string[],
        confidence: "high" as Confidence,
      }, ...inherited];
      for (const current of identityScope) {
        for (const edge of adjacency.get(current.targetId) ?? []) {
          if (!CONTEXT_RELATIONS.has(edge.relation) || directIds.has(edge.nodeId)) continue;
          keepBestCandidate(candidates, {
            targetId: edge.nodeId,
            kind: "related",
            sourceTargetId: sourceId,
            sourceLabel: flowNodeLabel(nodeById.get(sourceId)),
            relations: [...current.relations, edge.relation],
            confidence: lowerConfidence(current.confidence, edge.confidence),
          });
        }
      }
    }

    for (const candidate of candidates.values()) {
      const key = `flow-node:${candidate.targetId}`;
      const projected: MergedEnrichmentAnnotation = {
        ...entry,
        association: {
          kind: candidate.kind,
          sourceTargetId: candidate.sourceTargetId,
          sourceLabel: candidate.sourceLabel,
          relations: candidate.relations,
          confidence: candidate.confidence,
        },
      };
      const existing = index.get(key);
      if (existing) existing.push(projected);
      else index.set(key, [projected]);
    }
  }
}

function identityMatches(
  sourceId: string,
  adjacency: Map<string, Array<{
    nodeId: string;
    relation: FlowRelation;
    confidence: Confidence;
  }>>
) {
  const matches: Array<{
    targetId: string;
    relations: string[];
    confidence: Confidence;
  }> = [];
  const queue = [{
    targetId: sourceId,
    relations: [] as string[],
    confidence: "high" as Confidence,
  }];
  const visited = new Set([sourceId]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.relations.length >= MAX_IDENTITY_DISTANCE) continue;
    for (const edge of adjacency.get(current.targetId) ?? []) {
      if (!IDENTITY_RELATIONS.has(edge.relation) || visited.has(edge.nodeId)) continue;
      visited.add(edge.nodeId);
      const next = {
        targetId: edge.nodeId,
        relations: [...current.relations, edge.relation],
        confidence: lowerConfidence(current.confidence, edge.confidence),
      };
      matches.push(next);
      queue.push(next);
    }
  }
  return matches;
}

function keepBestCandidate(
  candidates: Map<string, PropagationCandidate>,
  candidate: PropagationCandidate
) {
  const current = candidates.get(candidate.targetId);
  if (!current || candidateRank(candidate) < candidateRank(current)) {
    candidates.set(candidate.targetId, candidate);
  }
}

function candidateRank(candidate: PropagationCandidate) {
  return (candidate.kind === "inherited" ? 0 : 100) + candidate.relations.length;
}

function addAdjacent(
  adjacency: Map<string, Array<{
    nodeId: string;
    relation: FlowRelation;
    confidence: Confidence;
  }>>,
  from: string,
  to: string,
  relation: FlowRelation,
  confidence: Confidence
) {
  const entries = adjacency.get(from);
  const next = { nodeId: to, relation, confidence };
  if (entries) entries.push(next);
  else adjacency.set(from, [next]);
}

function flowNodeLabel(node: FlowIndex["nodes"][number] | undefined) {
  return node?.name ?? node?.path;
}

function lowerConfidence(left: Confidence, right: Confidence): Confidence {
  const rank: Record<Confidence, number> = {
    high: 0,
    medium: 1,
    low: 2,
    unknown: 3,
  };
  return rank[left] >= rank[right] ? left : right;
}

// Overlays module enrichment onto an already built view: badges and summaries
// are attached to view nodes that represent a canonical graph node, overlay
// edges are drawn between such nodes. Applied as a post-pass so every view
// mode gets it without builder changes.
export function applyEnrichment(view: ViewGraph, overlay: EnrichmentOverlay): ViewGraph {
  const wantsEdges = overlay.showEdges && overlay.edges.length > 0;
  if (overlay.byNodeId.size === 0 && !wantsEdges) return view;

  const nodes = view.nodes.map((node) => {
    const sourceId = node.sourceNode?.id;
    const entries = sourceId ? overlay.byNodeId.get(sourceId) : undefined;
    if (!entries || entries.length === 0) return node;

    const badges = entries.flatMap((entry) => entry.badges ?? []);
    const summary = entries.map((entry) => entry.summary).find(Boolean);

    return {
      ...node,
      enrichmentBadges: badges.length > 0 ? badges : undefined,
      enrichmentSummary: summary,
    };
  });

  return {
    nodes,
    edges: wantsEdges ? [...view.edges, ...overlayEdges(view, overlay.edges)] : view.edges,
  };
}

// An overlay edge is drawn only when both canonical endpoints are visible in
// the current view; hidden endpoints (e.g. file nodes with files toggled off)
// silently hide the edge with them.
function overlayEdges(view: ViewGraph, edges: MergedEnrichmentEdge[]): ViewGraphEdge[] {
  const viewIdBySourceId = new Map<string, string>();
  for (const node of view.nodes) {
    if (node.sourceNode && !viewIdBySourceId.has(node.sourceNode.id)) {
      viewIdBySourceId.set(node.sourceNode.id, node.id);
    }
  }

  const result: ViewGraphEdge[] = [];
  for (const edge of edges) {
    const from = viewIdBySourceId.get(edge.from);
    const to = viewIdBySourceId.get(edge.to);
    if (!from || !to) continue;
    result.push({
      id: `enrichment:${edge.moduleId}:${edge.id}`,
      from,
      to,
      type: "enrichment",
      label: edge.label ?? edge.type,
    });
  }
  return result;
}
