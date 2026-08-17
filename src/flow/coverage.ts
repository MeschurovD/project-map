import type {
  FlowCompleteness,
  OriginStatus,
  ValueFlow,
} from "./types.js";

export type CoverageTransitionMatrix = Record<
  FlowCompleteness,
  Record<OriginStatus, number>
>;

/**
 * Audit helper for the PM-019 migration. It proves that every legacy flow is
 * still represented and makes any coverage increase explainable by category.
 */
export function buildCoverageTransitionMatrix(flows: ValueFlow[]): CoverageTransitionMatrix {
  const matrix = emptyMatrix();
  for (const flow of flows) {
    matrix[flow.completeness][flow.coverage.origin] += 1;
  }
  return matrix;
}

function emptyMatrix(): CoverageTransitionMatrix {
  return {
    complete: originCounts(),
    partial: originCounts(),
    "source-only": originCounts(),
    "consumer-only": originCounts(),
  };
}

function originCounts(): Record<OriginStatus, number> {
  return {
    proven: 0,
    boundary: 0,
    gap: 0,
    unknown: 0,
  };
}
