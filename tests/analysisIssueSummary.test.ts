import { describe, expect, it } from "vitest";
import { buildAnalysisIssueSummary } from "../src/flow/buildAnalysisIssueSummary.js";
import type { AnalysisIssueFlowDetail } from "../src/flow/buildAnalysisIssueSummary.js";
import type { FlowEdge, FlowNode, ValueFlow } from "../src/flow/types.js";

describe("buildAnalysisIssueSummary", () => {
  it("groups gaps by proven position and reports affected values and owners", () => {
    const originGap = node("gap:selector", "gap", "Source missing", "selector-owner", {
      reasonCode: "selector-source-not-recorded",
      message: "No normalized selector source",
    });
    const selector = node("selector", "selector-result", "selectOrder", "selector-owner");
    const value = node("value", "component-value", "order.status", "component-owner");
    const continuationGap = node("gap:consumer", "gap", "Consumer missing", "component-owner", {
      reasonCode: "unsupported-consumer",
      message: "Consumer could not be normalized",
    });
    originGap.evidence = [{ file: "src/selectors.ts", line: 4, code: "selectOrder" }];

    const originFlow = detail(
      "flow:value",
      value,
      [originGap, selector, value],
      [edge("gap-selector", originGap.id, selector.id), edge("selector-value", selector.id, value.id)],
      [originGap]
    );
    const continuationFlow = detail(
      "flow:continuation",
      value,
      [value, continuationGap],
      [edge("value-gap", value.id, continuationGap.id)],
      [continuationGap]
    );

    const summary = buildAnalysisIssueSummary({
      pageId: "page:orders",
      topologyNodes: [
        { id: "selector-owner", name: "selectOrder", type: "selector" },
        { id: "component-owner", name: "OrderCard", type: "component" },
      ],
      flowDetails: [continuationFlow, originFlow],
    });

    expect(summary).toMatchObject({
      pageId: "page:orders",
      totalCount: 2,
      originCount: 1,
      continuationCount: 1,
      unknownCount: 0,
    });
    expect(summary.groups.map((group) => [group.reasonCode, group.position])).toEqual([
      ["selector-source-not-recorded", "origin"],
      ["unsupported-consumer", "continuation"],
    ]);
    expect(summary.issues[0]).toMatchObject({
      id: originGap.id,
      position: "origin",
      affectedValues: [{ flowId: "flow:value", name: "order.status" }],
      affectedOwners: [
        { id: "component-owner", name: "OrderCard" },
        { id: "selector-owner", name: "selectOrder" },
      ],
      evidence: [{ file: "src/selectors.ts", line: 4 }],
    });
  });
});

function node(
  id: string,
  kind: FlowNode["kind"],
  name: string,
  ownerNodeId: string,
  gap?: NonNullable<FlowNode["gap"]>
): FlowNode {
  return { id, kind, name, ownerNodeId, gap, confidence: "unknown", evidence: [] };
}

function edge(id: string, from: string, to: string): FlowEdge {
  return { id, from, to, relation: "produces", confidence: "unknown", evidence: [] };
}

function detail(
  id: string,
  subject: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  gaps: FlowNode[]
): AnalysisIssueFlowDetail {
  const flow: ValueFlow = {
    id,
    scopeNodeIds: [],
    subjectNodeId: subject.id,
    nodeIds: nodes.map((entry) => entry.id),
    edgeIds: edges.map((entry) => entry.id),
    completeness: "partial",
    coverage: { origin: "gap", continuation: "gap", reasonCodes: gaps.flatMap((gap) => gap.gap?.reasonCode ?? []) },
  };
  return { flow, subject, nodes, edges, gaps };
}
