import { describe, expect, it } from "vitest";
import { buildPageActionSummary } from "../src/flow/buildPageActionSummary.js";
import type { FlowEdge, FlowNode, ValueFlow } from "../src/flow/types.js";

describe("buildPageActionSummary", () => {
  it("projects a proven thunk chain and keeps topology-only actions honest", () => {
    const api = flowNode("api", "api", "POST /orders");
    const fulfilled = flowNode("fulfilled", "async-operation", "saveOrder.fulfilled", "thunk:save");
    const state = flowNode("state", "state-field", "state.orders.current", "slice:orders");
    const selector = flowNode("selector", "selector-result", "selectOrder", "selector:order");
    const prop = flowNode("prop", "prop", "OrderCard.value", "component:card");
    const edges: FlowEdge[] = [
      flowEdge("api-operation", api.id, fulfilled.id, "produces"),
      {
        ...flowEdge("operation-state", fulfilled.id, state.id, "writes"),
        stateWrite: {
          statePath: "state.orders.current",
          lifecycle: "fulfilled",
          valueOrigin: "payload",
        },
      },
      flowEdge("state-selector", state.id, selector.id, "selects"),
      flowEdge("selector-prop", selector.id, prop.id, "passes"),
    ];
    const flow: ValueFlow = {
      id: "flow:order",
      scopeNodeIds: [],
      subjectNodeId: selector.id,
      nodeIds: [api.id, fulfilled.id, state.id, selector.id, prop.id],
      edgeIds: edges.map((edge) => edge.id),
      completeness: "complete",
      coverage: { origin: "proven", continuation: "proven", reasonCodes: [] },
    };

    const summary = buildPageActionSummary({
      pageId: "page:orders",
      topologyNodes: [
        { id: "hook:form", type: "hook", name: "useOrderForm" },
        { id: "thunk:save", type: "thunk", name: "saveOrder" },
        { id: "action:reset", type: "action", name: "orders.reset" },
        { id: "slice:orders", type: "slice-model", name: "orders" },
      ],
      topologyEdges: [
        graphEdge("dispatch-save", "hook:form", "thunk:save", "dispatchesAction"),
        graphEdge("save-slice", "thunk:save", "slice:orders", "writesSlice"),
        graphEdge("dispatch-reset", "hook:form", "action:reset", "dispatchesAction"),
      ],
      flowDetails: [{ flow, subject: selector, nodes: [api, fulfilled, state, selector, prop], edges, gaps: [] }],
    });

    expect(summary.stats).toEqual({
      operationsCount: 2,
      initiatorsCount: 1,
      apiCallsCount: 1,
      exactStateChangesCount: 1,
      uiOutcomesCount: 1,
      issuesCount: 0,
    });
    const save = summary.operations.find((operation) => operation.operation.name === "saveOrder");
    expect(save).toMatchObject({
      detailLevel: "value-proven",
      initiators: [{ id: "hook:form", name: "useOrderForm" }],
      apiCalls: [{ name: "POST /orders" }],
      stateChanges: [{ name: "state.orders.current", exact: true, lifecycle: "fulfilled", valueOrigin: "payload" }],
      uiOutcomes: [{ name: "OrderCard.value" }],
      affectedValues: [{ flowId: "flow:order", name: "selectOrder" }],
    });
    expect(summary.operations.find((operation) => operation.operation.name === "orders.reset")).toMatchObject({
      detailLevel: "topology-only",
      stateChanges: [],
      uiOutcomes: [],
    });
  });

  it("shows proven project-wide initiators omitted from the page topology", () => {
    const summary = buildPageActionSummary({
      pageId: "page:orders",
      topologyNodes: [{ id: "thunk:save", type: "thunk", name: "saveOrder" }],
      topologyEdges: [],
      projectNodes: [
        { id: "thunk:save", type: "thunk", name: "saveOrder" },
        { id: "hook:background", type: "hook", name: "useBackgroundSave" },
      ],
      projectEdges: [graphEdge("dispatch-save", "hook:background", "thunk:save", "dispatchesAction")],
      flowDetails: [],
    });

    expect(summary.operations[0]?.initiators).toEqual([
      expect.objectContaining({ name: "useBackgroundSave", context: "project" }),
    ]);
  });

  it("explains exact state changes made by synchronous slice actions", () => {
    const summary = buildPageActionSummary({
      pageId: "page:workspace",
      topologyNodes: [
        {
          id: "action:workspace.resetError",
          type: "action",
          name: "workspace.resetError",
          file: "src/slice.ts",
          meta: {
            sliceName: "workspace",
            writes: [{
              statePath: "error",
              valueOrigin: "literal",
              location: { line: 8, column: 5 },
              code: "state.error = false",
            }],
          },
        },
        { id: "slice-model:workspace", type: "slice-model", name: "workspace" },
      ],
      topologyEdges: [graphEdge(
        "action-slice",
        "action:workspace.resetError",
        "slice-model:workspace",
        "writesSlice"
      )],
      flowDetails: [],
    });

    expect(summary.operations[0]).toMatchObject({
      detailLevel: "value-proven",
      stateChanges: [{
        name: "state.workspace.error",
        exact: true,
        valueOrigin: "literal",
      }],
    });
  });
});

function flowNode(id: string, kind: FlowNode["kind"], name: string, ownerNodeId?: string): FlowNode {
  return { id, kind, name, ownerNodeId, confidence: "high", evidence: [{ file: "src/action.ts", line: 1 }] };
}

function flowEdge(id: string, from: string, to: string, relation: FlowEdge["relation"]): FlowEdge {
  return { id, from, to, relation, confidence: "high", evidence: [{ file: "src/action.ts", line: 2 }] };
}

function graphEdge(
  id: string,
  from: string,
  to: string,
  type: "dispatchesAction" | "writesSlice"
) {
  return { id, from, to, type, confidence: "high" as const, evidence: [{ file: "src/action.ts", line: 3, column: 1 }] };
}
