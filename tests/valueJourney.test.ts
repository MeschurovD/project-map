import { describe, expect, it } from "vitest";
import { buildValueJourney } from "../src/flow/buildValueJourney.js";
import type { ValueFlowDetail } from "../src/flow/queries.js";
import type { FlowEdge, FlowNode } from "../src/flow/types.js";

describe("buildValueJourney", () => {
  it("recommends the graph when one value fans out to multiple consumers", () => {
    const source = node("source", "state-field", "state.order.status");
    const selector = node("selector", "selector-result", "selectStatus");
    const label = node("label", "prop", "StatusLabel.value");
    const button = node("button", "ui-effect", "SubmitButton.disabled");
    const edges = [
      edge("source-selector", source.id, selector.id, "selects"),
      edge("selector-label", selector.id, label.id, "passes"),
      edge("selector-button", selector.id, button.id, "controls"),
    ];
    const detail: ValueFlowDetail = {
      flow: {
        id: "flow:status",
        scopeNodeIds: [],
        subjectNodeId: selector.id,
        nodeIds: [source.id, selector.id, label.id, button.id],
        edgeIds: edges.map((entry) => entry.id),
        completeness: "complete",
        coverage: { origin: "proven", continuation: "proven", reasonCodes: [] },
      },
      subject: selector,
      nodes: [button, selector, label, source],
      edges,
      sources: [source],
      consumers: [label, button],
      gaps: [],
    };

    const journey = buildValueJourney(detail);

    expect(journey).toMatchObject({
      isBranched: true,
      recommendedView: "graph",
      sourceNames: ["state.order.status"],
      consumerNames: ["StatusLabel.value", "SubmitButton.disabled"],
    });
    expect(journey.steps.map((step) => step.id)).toEqual(["source", "selector", "label", "button"]);
    expect(journey.steps.find((step) => step.id === "selector")).toMatchObject({
      predecessorIds: ["source"],
      successorIds: ["label", "button"],
    });
  });
});

function node(id: string, kind: FlowNode["kind"], name: string): FlowNode {
  return { id, kind, name, confidence: "high", evidence: [] };
}

function edge(id: string, from: string, to: string, relation: FlowEdge["relation"]): FlowEdge {
  return { id, from, to, relation, confidence: "high", evidence: [] };
}
