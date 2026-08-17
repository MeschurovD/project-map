import { describe, expect, it } from "vitest";
import type { FlowQueries, ValueFlowDetail } from "../src/flow/queries.js";
import type { FlowEdge, FlowNode } from "../src/flow/types.js";
import type { ProjectMapGraph } from "../src/graph/types.js";
import { buildSingleFlowQueryView } from "../src/ui/graph-view/buildFlowQueryView.js";

describe("async lifecycle trace presentation", () => {
  it("keeps fulfilled on the primary path and collapses reset writes", () => {
    const nodes: FlowNode[] = [
      flowNode("api", "api", "GET /items"),
      flowNode("fulfilled", "async-operation", "fetchItems.fulfilled"),
      flowNode("pending", "async-operation", "fetchItems.pending"),
      flowNode("state", "state-field", "state.items.current"),
      flowNode("selector", "selector-result", "selectItems"),
      flowNode("value", "component-value", "items"),
    ];
    const edges: FlowEdge[] = [
      flowEdge("api-fulfilled", "api", "fulfilled", "produces"),
      {
        ...flowEdge("fulfilled-state", "fulfilled", "state", "writes"),
        stateWrite: {
          statePath: "state.items.current",
          lifecycle: "fulfilled",
          valueOrigin: "payload",
        },
      },
      {
        ...flowEdge("pending-state", "pending", "state", "writes"),
        stateWrite: {
          statePath: "state.items.current",
          lifecycle: "pending",
          valueOrigin: "reset",
        },
      },
      flowEdge("state-selector", "state", "selector", "selects"),
      flowEdge("selector-value", "selector", "value", "binds"),
    ];
    const detail: ValueFlowDetail = {
      flow: {
        id: "flow:value",
        scopeNodeIds: [],
        subjectNodeId: "value",
        nodeIds: nodes.map((node) => node.id),
        edgeIds: edges.map((edge) => edge.id),
        completeness: "source-only",
        coverage: { origin: "proven", continuation: "terminal-at-unit", reasonCodes: [] },
      },
      subject: nodes.at(-1)!,
      nodes,
      edges,
      sources: [nodes[0]!, nodes[2]!],
      consumers: [],
      gaps: [],
    };
    const queries = {
      getValueFlow: () => detail,
    } as unknown as FlowQueries;

    const view = buildSingleFlowQueryView(graph(), queries, detail.flow.id);
    const stateCard = view.nodes.find((node) => node.id === "state");

    expect(view.nodes.some((node) => node.id === "fulfilled")).toBe(true);
    expect(view.nodes.some((node) => node.id === "pending")).toBe(false);
    expect(stateCard?.dataFlow?.secondaryWrites).toEqual(["fetchItems.pending · reset"]);
  });

  it("keeps a lifecycle operation when it is still the primary writer of another field", () => {
    const nodes: FlowNode[] = [
      flowNode("fulfilled", "async-operation", "fetchItems.fulfilled"),
      flowNode("pending", "async-operation", "fetchItems.pending"),
      flowNode("current", "state-field", "state.items.current"),
      flowNode("status", "state-field", "state.items.status"),
      flowNode("value", "component-value", "items"),
    ];
    const edges: FlowEdge[] = [
      {
        ...flowEdge("fulfilled-current", "fulfilled", "current", "writes"),
        stateWrite: {
          statePath: "state.items.current",
          lifecycle: "fulfilled",
          valueOrigin: "payload",
        },
      },
      {
        ...flowEdge("pending-current", "pending", "current", "writes"),
        stateWrite: {
          statePath: "state.items.current",
          lifecycle: "pending",
          valueOrigin: "reset",
        },
      },
      {
        ...flowEdge("pending-status", "pending", "status", "writes"),
        stateWrite: {
          statePath: "state.items.status",
          lifecycle: "pending",
          valueOrigin: "literal",
        },
      },
      flowEdge("current-value", "current", "value", "binds"),
    ];
    const detail: ValueFlowDetail = {
      flow: {
        id: "flow:value",
        scopeNodeIds: [],
        subjectNodeId: "value",
        nodeIds: nodes.map((node) => node.id),
        edgeIds: edges.map((edge) => edge.id),
        completeness: "source-only",
        coverage: { origin: "proven", continuation: "terminal-at-unit", reasonCodes: [] },
      },
      subject: nodes.at(-1)!,
      nodes,
      edges,
      sources: [],
      consumers: [],
      gaps: [],
    };
    const queries = {
      getValueFlow: () => detail,
    } as unknown as FlowQueries;

    const view = buildSingleFlowQueryView(graph(), queries, detail.flow.id);

    expect(view.nodes.some((node) => node.id === "pending")).toBe(true);
    expect(view.edges.some((edge) => edge.id === "pending-current")).toBe(false);
    expect(view.edges.some((edge) => edge.id === "pending-status")).toBe(true);
    expect(view.nodes.find((node) => node.id === "current")?.dataFlow?.secondaryWrites)
      .toEqual(["fetchItems.pending · reset"]);
  });
});

function flowNode(id: string, kind: FlowNode["kind"], name: string): FlowNode {
  return { id, kind, name, confidence: "high", evidence: [] };
}

function flowEdge(
  id: string,
  from: string,
  to: string,
  relation: FlowEdge["relation"]
): FlowEdge {
  return { id, from, to, relation, confidence: "high", evidence: [] };
}

function graph(): ProjectMapGraph {
  return {
    schemaVersion: "1.1.0",
    project: { name: "fixture", root: "/fixture", sourceRoot: "src" },
    nodes: [],
    edges: [],
    stats: { nodesCount: 0, edgesCount: 0 },
  };
}
