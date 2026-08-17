import type { Confidence } from "../graph/types.js";
import type { AnalysisIssueSummary } from "./buildAnalysisIssueSummary.js";
import type {
  ContinuationStatus,
  FlowEdge,
  FlowNode,
  OriginStatus,
  ValueFlow,
} from "./types.js";

export type PageQualityStatus = "complete" | "bounded" | "uncertain" | "partial" | "limited" | "empty";

export type PageQualityDistribution<T extends string> = Record<T, number>;

export type PageQualityEvidenceCoverage = {
  nodesCount: number;
  nodesWithEvidenceCount: number;
  edgesCount: number;
  edgesWithEvidenceCount: number;
};

/** A transparent page-level answer about what the analyzer can and cannot prove. */
export type PageQualitySummary = {
  pageId: string;
  status: PageQualityStatus;
  values: {
    totalCount: number;
    completeCount: number;
    partialCount: number;
  };
  origin: {
    resolvedCount: number;
    resolvedPct: number;
    statuses: PageQualityDistribution<OriginStatus>;
  };
  continuation: {
    resolvedCount: number;
    resolvedPct: number;
    statuses: PageQualityDistribution<ContinuationStatus>;
  };
  confidence: PageQualityDistribution<Confidence> & { totalCount: number };
  evidence: PageQualityEvidenceCoverage;
  issues: AnalysisIssueSummary;
};

export type PageQualityFlowDetail = {
  flow: ValueFlow;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type BuildPageQualitySummaryInput = {
  pageId: string;
  flowDetails: PageQualityFlowDetail[];
  issues: AnalysisIssueSummary;
};

export function buildPageQualitySummary(input: BuildPageQualitySummaryInput): PageQualitySummary {
  const flows = uniqueById(input.flowDetails.map((detail) => detail.flow));
  const nodes = uniqueById(input.flowDetails.flatMap((detail) => detail.nodes));
  const edges = uniqueById(input.flowDetails.flatMap((detail) => detail.edges));
  const originStatuses = distribution<OriginStatus>(["proven", "boundary", "gap", "unknown"]);
  const continuationStatuses = distribution<ContinuationStatus>([
    "proven",
    "terminal-at-unit",
    "gap",
    "unknown",
  ]);
  const confidence = distribution<Confidence>(["high", "medium", "low", "unknown"]);

  for (const flow of flows) {
    originStatuses[flow.coverage.origin] += 1;
    continuationStatuses[flow.coverage.continuation] += 1;
  }
  for (const edge of edges) confidence[edge.confidence] += 1;

  const totalCount = flows.length;
  const originResolvedCount = originStatuses.proven + originStatuses.boundary;
  // A value ending in the current unit is a known terminal, not an analysis gap.
  const continuationResolvedCount = continuationStatuses.proven + continuationStatuses["terminal-at-unit"];
  const status = qualityStatus({
    totalCount,
    originResolvedCount,
    originBoundaryCount: originStatuses.boundary,
    continuationResolvedCount,
    issueCount: input.issues.totalCount,
    uncertainEdgeCount: confidence.low + confidence.unknown,
  });

  return {
    pageId: input.pageId,
    status,
    values: {
      totalCount,
      completeCount: flows.filter((flow) => flow.completeness === "complete").length,
      partialCount: flows.filter((flow) => flow.completeness !== "complete").length,
    },
    origin: {
      resolvedCount: originResolvedCount,
      resolvedPct: percent(originResolvedCount, totalCount),
      statuses: originStatuses,
    },
    continuation: {
      resolvedCount: continuationResolvedCount,
      resolvedPct: percent(continuationResolvedCount, totalCount),
      statuses: continuationStatuses,
    },
    confidence: { ...confidence, totalCount: edges.length },
    evidence: {
      nodesCount: nodes.length,
      nodesWithEvidenceCount: nodes.filter((node) => node.evidence.length > 0).length,
      edgesCount: edges.length,
      edgesWithEvidenceCount: edges.filter((edge) => edge.evidence.length > 0).length,
    },
    issues: input.issues,
  };
}

function qualityStatus(input: {
  totalCount: number;
  originResolvedCount: number;
  originBoundaryCount: number;
  continuationResolvedCount: number;
  issueCount: number;
  uncertainEdgeCount: number;
}): PageQualityStatus {
  if (input.totalCount === 0) return "empty";
  const allPathsResolved =
    input.originResolvedCount === input.totalCount &&
    input.continuationResolvedCount === input.totalCount &&
    input.issueCount === 0;
  if (allPathsResolved && input.uncertainEdgeCount > 0) return "uncertain";
  if (allPathsResolved && input.originBoundaryCount > 0) return "bounded";
  if (allPathsResolved) return "complete";
  if (input.originResolvedCount === 0 || input.continuationResolvedCount === 0) return "limited";
  return "partial";
}

function distribution<T extends string>(keys: T[]): PageQualityDistribution<T> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as PageQualityDistribution<T>;
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}
