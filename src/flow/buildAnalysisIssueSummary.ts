import type { ProjectMapNode } from "../graph/types.js";
import type { FlowEdge, FlowEvidence, FlowNode, ValueFlow } from "./types.js";

export type AnalysisIssuePosition = "origin" | "continuation" | "both" | "unknown";

export type AnalysisIssueValue = {
  flowId: string;
  nodeId: string;
  name: string;
  path?: string;
  ownerNodeId?: string;
};

export type AnalysisIssueOwner = {
  id: string;
  name: string;
  type: ProjectMapNode["type"];
};

export type AnalysisIssue = {
  id: string;
  reasonCode: string;
  message: string;
  position: AnalysisIssuePosition;
  affectedValues: AnalysisIssueValue[];
  affectedOwners: AnalysisIssueOwner[];
  evidence: FlowEvidence[];
};

export type AnalysisIssueGroup = {
  reasonCode: string;
  count: number;
  position: AnalysisIssuePosition;
  affectedValuesCount: number;
  issues: AnalysisIssue[];
};

/** Page-level answer to “why is this analysis incomplete?”. */
export type AnalysisIssueSummary = {
  pageId: string;
  totalCount: number;
  originCount: number;
  continuationCount: number;
  unknownCount: number;
  groups: AnalysisIssueGroup[];
  issues: AnalysisIssue[];
};

export type AnalysisIssueFlowDetail = {
  flow: ValueFlow;
  subject: FlowNode;
  nodes: FlowNode[];
  edges: FlowEdge[];
  gaps: FlowNode[];
};

export type BuildAnalysisIssueSummaryInput = {
  pageId: string;
  topologyNodes: ProjectMapNode[];
  flowDetails: AnalysisIssueFlowDetail[];
};

export function buildAnalysisIssueSummary(input: BuildAnalysisIssueSummaryInput): AnalysisIssueSummary {
  const ownerById = new Map(input.topologyNodes.map((node) => [node.id, node]));
  const flowDetailsByGapId = new Map<string, AnalysisIssueFlowDetail[]>();
  const gapsById = new Map<string, FlowNode>();

  for (const detail of input.flowDetails) {
    for (const gap of detail.gaps) {
      gapsById.set(gap.id, gap);
      flowDetailsByGapId.set(gap.id, [...(flowDetailsByGapId.get(gap.id) ?? []), detail]);
    }
  }

  const issues = [...gapsById.values()].map((gap): AnalysisIssue => {
    const details = flowDetailsByGapId.get(gap.id) ?? [];
    const positions = details.map((detail) => positionInFlow(gap.id, detail));
    const affectedValues = uniqueValues(details.map((detail) => ({
      flowId: detail.flow.id,
      nodeId: detail.subject.id,
      name: detail.subject.name,
      path: detail.subject.path,
      ownerNodeId: detail.subject.ownerNodeId,
    })));
    const ownerIds = new Set([
      ...affectedValues.flatMap((value) => value.ownerNodeId ?? []),
      ...(gap.ownerNodeId ? [gap.ownerNodeId] : []),
    ]);

    return {
      id: gap.id,
      reasonCode: gap.gap?.reasonCode ?? "unknown",
      message: gap.gap?.message ?? gap.name,
      position: mergePositions(positions),
      affectedValues,
      affectedOwners: [...ownerIds]
        .flatMap((id) => ownerById.get(id) ?? [])
        .map((node) => ({ id: node.id, name: node.name, type: node.type }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      evidence: mergeEvidence(gap.evidence),
    };
  }).sort(compareIssues);

  const groupsByReason = new Map<string, AnalysisIssue[]>();
  for (const issue of issues) {
    groupsByReason.set(issue.reasonCode, [...(groupsByReason.get(issue.reasonCode) ?? []), issue]);
  }
  const groups = [...groupsByReason.entries()].map(([reasonCode, grouped]): AnalysisIssueGroup => ({
    reasonCode,
    count: grouped.length,
    position: mergePositions(grouped.map((issue) => issue.position)),
    affectedValuesCount: new Set(grouped.flatMap((issue) => issue.affectedValues.map((value) => value.flowId))).size,
    issues: grouped,
  })).sort((left, right) =>
    positionOrder(left.position) - positionOrder(right.position) ||
    right.affectedValuesCount - left.affectedValuesCount ||
    right.count - left.count ||
    left.reasonCode.localeCompare(right.reasonCode)
  );

  return {
    pageId: input.pageId,
    totalCount: issues.length,
    originCount: issues.filter((issue) => issue.position === "origin" || issue.position === "both").length,
    continuationCount: issues.filter((issue) => issue.position === "continuation" || issue.position === "both").length,
    unknownCount: issues.filter((issue) => issue.position === "unknown").length,
    groups,
    issues,
  };
}

function positionInFlow(gapId: string, detail: AnalysisIssueFlowDetail): AnalysisIssuePosition {
  const origin = hasPath(gapId, detail.subject.id, detail.edges);
  const continuation = hasPath(detail.subject.id, gapId, detail.edges);
  if (origin && continuation) return "both";
  if (origin) return "origin";
  if (continuation) return "continuation";
  return "unknown";
}

function hasPath(from: string, to: string, edges: FlowEdge[]) {
  if (from === to) return true;
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const visited = new Set<string>();
  const queue = [...(outgoing.get(from) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

function mergePositions(positions: AnalysisIssuePosition[]): AnalysisIssuePosition {
  const origin = positions.some((position) => position === "origin" || position === "both");
  const continuation = positions.some((position) => position === "continuation" || position === "both");
  if (origin && continuation) return "both";
  if (origin) return "origin";
  if (continuation) return "continuation";
  return "unknown";
}

function uniqueValues(values: AnalysisIssueValue[]) {
  return [...new Map(values.map((value) => [value.flowId, value])).values()]
    .sort((left, right) => (left.path ?? left.name).localeCompare(right.path ?? right.name));
}

function mergeEvidence(evidence: FlowEvidence[]) {
  return [...new Map(evidence.map((entry) => [
    `${entry.file}\0${entry.line ?? ""}\0${entry.column ?? ""}\0${entry.code ?? ""}`,
    entry,
  ])).values()];
}

function compareIssues(left: AnalysisIssue, right: AnalysisIssue) {
  return positionOrder(left.position) - positionOrder(right.position) ||
    right.affectedValues.length - left.affectedValues.length ||
    left.reasonCode.localeCompare(right.reasonCode) ||
    left.id.localeCompare(right.id);
}

function positionOrder(position: AnalysisIssuePosition) {
  return { origin: 0, both: 1, continuation: 2, unknown: 3 }[position];
}
