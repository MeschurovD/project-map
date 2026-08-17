import { describe, expect, it } from "vitest";
import { FLOW_SCHEMA_VERSION, type FlowIndex } from "../src/flow/types.js";
import type { PageOverview } from "../src/flow/queries.js";
import type { ProjectMapGraph } from "../src/graph/types.js";
import type { MergedEnrichmentAnnotation } from "../src/modules/enrichmentTypes.js";
import { buildPageBusinessContext } from "../src/ui/graph-view/buildPageBusinessContext.js";

const PAGE = { id: "page:orders", type: "page" as const, name: "orders", file: "src/pages/orders.tsx" };
const COMPONENT = { id: "component:checkout", type: "component" as const, name: "Checkout", file: "src/Checkout.tsx" };
const OTHER = { id: "component:other", type: "component" as const, name: "Other", file: "src/Other.tsx" };
const VALUE = "component-value:component:checkout#canSubmit";
const OTHER_VALUE = "component-value:component:other#hidden";

describe("buildPageBusinessContext", () => {
  it("groups only docs annotations whose canonical targets belong to the page", () => {
    const context = buildPageBusinessContext({
      graph: graph(),
      overview: overview(),
      flowIndex: flowIndex(),
      annotations: [
        annotation("rule", "business-rule", [
          { type: "node", id: COMPONENT.id },
          { type: "flow-node", id: VALUE },
        ]),
        annotation("scenario", "user-flow", [{ type: "node", id: PAGE.id }]),
        annotation("warning", "gotcha", [{ type: "flow-node", id: VALUE }]),
        annotation("other", "business-rule", [{ type: "flow-node", id: OTHER_VALUE }]),
        { ...annotation("e2e", "business-rule", [{ type: "node", id: COMPONENT.id }]), moduleId: "e2e" },
      ],
    });

    expect(context.totalCount).toBe(3);
    expect(context.rules.map((entry) => entry.annotation.id)).toEqual(["rule"]);
    expect(context.scenarios.map((entry) => entry.annotation.id)).toEqual(["scenario"]);
    expect(context.cautions.map((entry) => entry.annotation.id)).toEqual(["warning"]);
    expect(context.rules[0]?.targets.map((target) => target.label)).toEqual([
      "Checkout",
      "canSubmit",
    ]);
  });
});

function graph(): ProjectMapGraph {
  return {
    schemaVersion: "1.1.0",
    project: { name: "test", root: "/project", sourceRoot: "src" },
    nodes: [PAGE, COMPONENT, OTHER],
    edges: [],
    stats: { nodesCount: 3, edgesCount: 0 },
  };
}

function overview(): PageOverview {
  return {
    pageId: PAGE.id,
    primaryComponentId: COMPONENT.id,
    warnings: [],
    topologyNodes: [PAGE, COMPONENT],
    topologyEdges: [],
    flows: [{
      id: "flow:submit",
      subjectNodeId: VALUE,
      subjectName: "canSubmit",
      subjectKind: "component-value",
      completeness: "complete",
      coverage: { origin: "proven", continuation: "proven", reasonCodes: [] },
      nodeCount: 1,
      edgeCount: 0,
      gapCount: 0,
      sourceNodeIds: [VALUE],
      consumerNodeIds: [],
    }],
    stats: {
      topologyNodesCount: 2,
      topologyEdgesCount: 0,
      flowsCount: 1,
      completeFlowsCount: 1,
      partialFlowsCount: 0,
      gapsCount: 0,
      originResolvedFlowsCount: 1,
      originGapFlowsCount: 0,
      originUnknownFlowsCount: 0,
      continuationResolvedFlowsCount: 1,
    },
  };
}

function flowIndex(): FlowIndex {
  const nodes: FlowIndex["nodes"] = [
    { id: VALUE, kind: "component-value", name: "canSubmit", ownerNodeId: COMPONENT.id, confidence: "high", evidence: [] },
    { id: OTHER_VALUE, kind: "component-value", name: "hidden", ownerNodeId: OTHER.id, confidence: "high", evidence: [] },
  ];
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    runId: "run",
    generatedAt: "2026-08-09T00:00:00.000Z",
    sourceFingerprint: "test",
    nodes,
    edges: [],
    flows: [
      { id: "flow:submit", scopeNodeIds: [COMPONENT.id], subjectNodeId: VALUE, nodeIds: [VALUE], edgeIds: [], completeness: "complete", coverage: { origin: "proven", continuation: "proven", reasonCodes: [] } },
      { id: "flow:other", scopeNodeIds: [OTHER.id], subjectNodeId: OTHER_VALUE, nodeIds: [OTHER_VALUE], edgeIds: [], completeness: "complete", coverage: { origin: "proven", continuation: "proven", reasonCodes: [] } },
    ],
    componentStructures: [],
    stats: { flowsCount: 2, completeFlowsCount: 2, gapsCount: 0, originResolvedFlowsCount: 2, originGapFlowsCount: 0, originUnknownFlowsCount: 0, continuationResolvedFlowsCount: 2 },
  };
}

function annotation(
  id: string,
  kind: string,
  targets: MergedEnrichmentAnnotation["targets"]
): MergedEnrichmentAnnotation {
  return { moduleId: "docs", id, ownerNodeId: COMPONENT.id, kind, targets, markdown: id };
}
