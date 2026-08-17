import type { Confidence } from "../graph/types.js";
import type {
  FlowCoverage,
  FlowEdge,
  FlowEvidence,
  FlowNode,
  FlowNodeKind,
  FlowRelation,
  ValueFlow,
} from "./types.js";

export type ValueJourneyView = "steps" | "graph" | "evidence";

export type BuildValueJourneyInput = {
  flow: ValueFlow;
  subject: FlowNode;
  nodes: FlowNode[];
  edges: FlowEdge[];
  sources: FlowNode[];
  consumers: FlowNode[];
  gaps: FlowNode[];
};

export type ValueJourneyStep = {
  id: string;
  kind: FlowNodeKind;
  name: string;
  path?: string;
  ownerNodeId?: string;
  confidence: Confidence;
  incomingRelations: FlowRelation[];
  predecessorIds: string[];
  successorIds: string[];
  evidenceCount: number;
  gap?: { reasonCode: string; message: string };
};

export type ValueJourneyEvidence = FlowEvidence & {
  id: string;
  stepId: string;
  stepName: string;
  source: "node" | "relation";
  relation?: FlowRelation;
  confidence: Confidence;
};

/** Question-oriented projection for the Steps / Graph / Evidence trace screen. */
export type ValueJourney = {
  flowId: string;
  subject: { id: string; name: string; path?: string; kind: FlowNodeKind };
  coverage: FlowCoverage;
  steps: ValueJourneyStep[];
  evidence: ValueJourneyEvidence[];
  sourceNames: string[];
  consumerNames: string[];
  isBranched: boolean;
  recommendedView: Exclude<ValueJourneyView, "evidence">;
  stats: {
    stepsCount: number;
    evidenceCount: number;
    gapCount: number;
  };
};

const KIND_ORDER: Record<FlowNodeKind, number> = {
  boundary: 0,
  api: 1,
  "async-operation": 2,
  "state-field": 3,
  "selector-result": 4,
  "hook-input": 5,
  "hook-return": 6,
  "component-value": 7,
  prop: 8,
  "ui-effect": 9,
  gap: 10,
};

export function buildValueJourney(detail: BuildValueJourneyInput): ValueJourney {
  const nodeById = new Map(detail.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, typeof detail.edges>();
  const outgoing = new Map<string, typeof detail.edges>();

  for (const edge of detail.edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  const orderedNodes = topologicalNodes(detail.nodes, incoming, outgoing);
  const steps = orderedNodes.map((node): ValueJourneyStep => {
    const incomingEdges = incoming.get(node.id) ?? [];
    const outgoingEdges = outgoing.get(node.id) ?? [];
    return {
      id: node.id,
      kind: node.kind,
      name: node.name,
      path: node.path,
      ownerNodeId: node.ownerNodeId,
      confidence: node.confidence,
      incomingRelations: [...new Set(incomingEdges.map((edge) => edge.relation))],
      predecessorIds: incomingEdges.map((edge) => edge.from),
      successorIds: outgoingEdges.map((edge) => edge.to),
      evidenceCount: mergeEvidence(
        node.evidence,
        incomingEdges.flatMap((edge) => edge.evidence)
      ).length,
      gap: node.gap,
    };
  });
  const evidence = orderedNodes.flatMap((node) => {
    const nodeEntries = node.evidence.map((entry, index): ValueJourneyEvidence => ({
      ...entry,
      id: `${node.id}:node:${index}`,
      stepId: node.id,
      stepName: node.name,
      source: "node",
      confidence: node.confidence,
    }));
    const relationEntries = (incoming.get(node.id) ?? []).flatMap((edge) =>
      edge.evidence.map((entry, index): ValueJourneyEvidence => ({
        ...entry,
        id: `${edge.id}:relation:${index}`,
        stepId: node.id,
        stepName: node.name,
        source: "relation",
        relation: edge.relation,
        confidence: edge.confidence,
      }))
    );
    return deduplicateJourneyEvidence([...nodeEntries, ...relationEntries]);
  });
  const isBranched = detail.nodes.some((node) =>
    (incoming.get(node.id)?.length ?? 0) > 1 || (outgoing.get(node.id)?.length ?? 0) > 1
  );

  return {
    flowId: detail.flow.id,
    subject: {
      id: detail.subject.id,
      name: detail.subject.name,
      path: detail.subject.path,
      kind: detail.subject.kind,
    },
    coverage: detail.flow.coverage,
    steps,
    evidence,
    sourceNames: detail.sources.map((node) => node.name),
    consumerNames: detail.consumers.map((node) => node.name),
    isBranched,
    recommendedView: isBranched ? "graph" : "steps",
    stats: {
      stepsCount: steps.length,
      evidenceCount: evidence.length,
      gapCount: detail.gaps.length,
    },
  };
}

function topologicalNodes(
  nodes: FlowNode[],
  incoming: Map<string, Array<{ from: string }>>,
  outgoing: Map<string, Array<{ to: string }>>
): FlowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, incoming.get(node.id)?.length ?? 0]));
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).sort(compareNodes);
  const ordered: FlowNode[] = [];

  while (ready.length > 0) {
    const current = ready.shift()!;
    ordered.push(current);
    for (const edge of outgoing.get(current.id) ?? []) {
      const nextDegree = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, nextDegree);
      const next = byId.get(edge.to);
      if (next && nextDegree === 0) {
        ready.push(next);
        ready.sort(compareNodes);
      }
    }
  }

  if (ordered.length === nodes.length) return ordered;
  const visited = new Set(ordered.map((node) => node.id));
  return [...ordered, ...nodes.filter((node) => !visited.has(node.id)).sort(compareNodes)];
}

function compareNodes(left: FlowNode, right: FlowNode) {
  return KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function mergeEvidence(...groups: FlowEvidence[][]): FlowEvidence[] {
  const result = new Map<string, FlowEvidence>();
  for (const evidence of groups.flat()) {
    result.set(evidenceKey(evidence), evidence);
  }
  return [...result.values()];
}

function deduplicateJourneyEvidence(entries: ValueJourneyEvidence[]) {
  const result = new Map<string, ValueJourneyEvidence>();
  for (const entry of entries) {
    const key = evidenceKey(entry);
    if (!result.has(key)) result.set(key, entry);
  }
  return [...result.values()];
}

function evidenceKey(evidence: FlowEvidence) {
  return `${evidence.file}\0${evidence.line ?? ""}\0${evidence.column ?? ""}\0${evidence.code ?? ""}`;
}
