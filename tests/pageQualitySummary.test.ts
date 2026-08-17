import { describe, expect, it } from "vitest";
import { buildPageQualitySummary } from "../src/flow/buildPageQualitySummary.js";
import type { AnalysisIssueSummary } from "../src/flow/buildAnalysisIssueSummary.js";
import type { FlowEdge, FlowNode, ValueFlow } from "../src/flow/types.js";

describe("buildPageQualitySummary", () => {
  it("keeps trace completeness, confidence, evidence, and issues as separate facts", () => {
    const source = node("source", true);
    const value = node("value", false);
    const consumer = node("consumer", true);
    const uncertain = edge("uncertain", source.id, value.id, "low", false);
    const proven = edge("proven", value.id, consumer.id, "high", true);
    const first = flow("first", value.id, "proven", "proven", "partial");
    const second = flow("second", consumer.id, "boundary", "terminal-at-unit", "complete");

    const summary = buildPageQualitySummary({
      pageId: "page:catalog",
      flowDetails: [
        { flow: first, nodes: [source, value, consumer], edges: [uncertain, proven] },
        { flow: second, nodes: [consumer], edges: [proven] },
      ],
      issues: issueSummary(1),
    });

    expect(summary).toMatchObject({
      status: "partial",
      values: { totalCount: 2, completeCount: 1, partialCount: 1 },
      origin: { resolvedCount: 2, resolvedPct: 100, statuses: { proven: 1, boundary: 1 } },
      continuation: {
        resolvedCount: 2,
        resolvedPct: 100,
        statuses: { proven: 1, "terminal-at-unit": 1 },
      },
      confidence: { totalCount: 2, high: 1, low: 1 },
      evidence: {
        nodesCount: 3,
        nodesWithEvidenceCount: 2,
        edgesCount: 2,
        edgesWithEvidenceCount: 1,
      },
      issues: { totalCount: 1 },
    });
  });

  it("reports complete only when all paths are resolved and no uncertain links or issues remain", () => {
    const value = node("value", true);
    const complete = buildPageQualitySummary({
      pageId: "page:complete",
      flowDetails: [{
        flow: flow("complete", value.id, "proven", "terminal-at-unit", "complete"),
        nodes: [value],
        edges: [],
      }],
      issues: issueSummary(0),
    });
    const empty = buildPageQualitySummary({
      pageId: "page:empty",
      flowDetails: [],
      issues: issueSummary(0),
    });

    expect(complete.status).toBe("complete");
    expect(empty.status).toBe("empty");
  });

  it("does not call a fully resolved trace partial when only link confidence is uncertain", () => {
    const source = node("source", true);
    const value = node("value", true);
    const summary = buildPageQualitySummary({
      pageId: "page:uncertain",
      flowDetails: [{
        flow: flow("uncertain", value.id, "proven", "proven", "complete"),
        nodes: [source, value],
        edges: [edge("uncertain", source.id, value.id, "low", true)],
      }],
      issues: issueSummary(0),
    });

    expect(summary.status).toBe("uncertain");
  });

  it("distinguishes a resolved boundary from a fully proven origin", () => {
    const value = node("value", true);
    const summary = buildPageQualitySummary({
      pageId: "page:bounded",
      flowDetails: [{
        flow: flow("bounded", value.id, "boundary", "terminal-at-unit", "complete"),
        nodes: [value],
        edges: [],
      }],
      issues: issueSummary(0),
    });

    expect(summary).toMatchObject({
      status: "bounded",
      origin: { resolvedPct: 100, statuses: { proven: 0, boundary: 1 } },
    });
  });
});

function node(id: string, evidenced: boolean): FlowNode {
  return {
    id,
    kind: "component-value",
    name: id,
    confidence: "high",
    evidence: evidenced ? [{ file: "src/page.tsx", line: 1 }] : [],
  };
}

function edge(
  id: string,
  from: string,
  to: string,
  confidence: FlowEdge["confidence"],
  evidenced: boolean
): FlowEdge {
  return {
    id,
    from,
    to,
    relation: "passes",
    confidence,
    evidence: evidenced ? [{ file: "src/page.tsx", line: 2 }] : [],
  };
}

function flow(
  id: string,
  subjectNodeId: string,
  origin: ValueFlow["coverage"]["origin"],
  continuation: ValueFlow["coverage"]["continuation"],
  completeness: ValueFlow["completeness"]
): ValueFlow {
  return {
    id,
    scopeNodeIds: [],
    subjectNodeId,
    nodeIds: [],
    edgeIds: [],
    completeness,
    coverage: { origin, continuation, reasonCodes: [] },
  };
}

function issueSummary(totalCount: number): AnalysisIssueSummary {
  return {
    pageId: "page:catalog",
    totalCount,
    originCount: totalCount,
    continuationCount: 0,
    unknownCount: 0,
    groups: [],
    issues: [],
  };
}
