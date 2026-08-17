import { describe, expect, it } from "vitest";
import type {
  SymbolContractOriginEdge,
  SymbolContractStep,
} from "../src/flow/queries.js";
import {
  symbolOwnerPipelineNode,
  symbolOriginTopology,
  symbolPipelineNodes,
  symbolValuePipelineNode,
  uniquePipelineNodes,
} from "../src/ui/src/symbolPresentation.js";

describe("symbol pipeline presentation", () => {
  it("turns a Redux origin into typed, compact nodes without losing full names", () => {
    const steps: SymbolContractStep[] = [
      step("api", "apiFetcher.resourceApi.items"),
      {
        ...step("async-operation", "loadItems.fulfilled"),
        path: "catalog/loadItems.fulfilled",
      },
      {
        ...step("state-field", "state.catalog.items"),
        path: "state.catalog.items",
      },
      step("selector-result", "selectItems"),
    ];

    expect(steps.flatMap(symbolPipelineNodes)).toEqual([
      expect.objectContaining({
        type: "API",
        name: "resourceApi.items",
        fullName: "apiFetcher.resourceApi.items",
        source: { kind: "api-call", flowNodeId: "api:apiFetcher.resourceApi.items" },
      }),
      expect.objectContaining({
        type: "THUNK",
        name: "loadItems",
        fullName: "catalog/loadItems",
        source: { kind: "flow-context", flowNodeId: "async-operation:loadItems.fulfilled" },
      }),
      expect.objectContaining({ type: "ACTION", name: "loadItems.fulfilled", fullName: "catalog/loadItems.fulfilled" }),
      expect.objectContaining({ type: "STATE", name: "catalog.items", fullName: "state.catalog.items" }),
      expect.objectContaining({ type: "SELECTOR", name: "selectItems", fullName: "selectItems" }),
    ]);
  });

  it("adds the owner and distinguishes a plain value from a computation", () => {
    expect(symbolOwnerPipelineNode("hook:example", "hook", "useExampleForm")).toMatchObject({
      type: "HOOK",
      name: "useExampleForm",
      source: { kind: "graph-node-context", graphNodeId: "hook:example" },
    });
    expect(symbolValuePipelineNode({ id: "plain", name: "items", role: "pass-through" })).toMatchObject({
      type: "VALUE",
      name: "items",
    });
    expect(symbolValuePipelineNode({ id: "derived", name: "selectedItem", role: "derived" })).toMatchObject({
      type: "COMPUTED",
      name: "selectedItem",
    });
    expect(symbolValuePipelineNode({
      id: "derived",
      flowNodeId: "flow-node:selected-item",
      name: "selectedItem",
      role: "derived",
    })).toMatchObject({
      source: { kind: "transformation", flowNodeId: "flow-node:selected-item" },
    });
  });

  it("keeps an HTTP method even when the canonical path contains only the endpoint", () => {
    expect(symbolPipelineNodes({
      ...step("api", "GET /api/items"),
      path: "/api/items",
    })[0]).toMatchObject({
      type: "API",
      name: "GET /api/items",
      fullName: "GET /api/items",
    });
  });

  it("shows the prop name while retaining its qualified name for the tooltip", () => {
    expect(symbolPipelineNodes(step("prop", "ExampleForm.isLoading"))[0]).toMatchObject({
      type: "PROP",
      name: "isLoading",
      fullName: "ExampleForm.isLoading",
      source: { kind: "flow-context", flowNodeId: "prop:ExampleForm.isLoading" },
    });
  });

  it("distinguishes external boundaries and trace gaps from functions", () => {
    expect(symbolPipelineNodes(step("boundary", "external source"))[0]).toMatchObject({
      type: "BOUNDARY",
      source: { kind: "flow-context" },
    });
    expect(symbolPipelineNodes(step("gap", "source unresolved"))[0]).toMatchObject({
      type: "GAP",
      source: { kind: "flow-context" },
    });
  });

  it("removes only adjacent duplicate presentation nodes", () => {
    const hook = symbolOwnerPipelineNode("hook:example", "hook", "useExampleForm");
    expect(uniquePipelineNodes([hook, { ...hook, id: "duplicate" }, symbolValuePipelineNode({
      id: "value",
      name: "items",
      role: "pass-through",
    })])).toHaveLength(2);
  });

  it("keeps independent thunks and lifecycle actions as parallel branches", () => {
    const apiItems = step("api", "apiFetcher.resourceApi.items");
    const loadItems = {
      ...step("async-operation", "loadItems.fulfilled"),
      ownerNodeId: "thunk:loadItems",
      path: "catalog/loadItems.fulfilled",
    };
    const itemsState = step("state-field", "state.catalog.items");
    const itemsSelector = step("selector-result", "selectItems");
    const policies = step("api", "apiFetcher.resourceApi.policies");
    const preferences = step("api", "apiFetcher.resourceApi.preferences");
    const participants = step("api", "apiFetcher.resourceApi.participants");
    const metadataFulfilled = {
      ...step("async-operation", "loadCatalogMetadata.fulfilled"),
      ownerNodeId: "thunk:loadCatalogMetadata",
      path: "catalog/loadCatalogMetadata.fulfilled",
    };
    const metadataPending = {
      ...step("async-operation", "loadCatalogMetadata.pending"),
      ownerNodeId: "thunk:loadCatalogMetadata",
      path: "catalog/loadCatalogMetadata.pending",
    };
    const metadataState = step("state-field", "state.catalog.metadata");
    const metadataSelector = step("selector-result", "selectMetadata");
    const loadingState = step("state-field", "state.catalog.isMetadataLoading");
    const loadingSelector = step("selector-result", "selectIsMetadataLoading");
    const steps = [
      apiItems,
      loadItems,
      itemsState,
      itemsSelector,
      policies,
      preferences,
      participants,
      metadataFulfilled,
      metadataPending,
      metadataState,
      metadataSelector,
      loadingState,
      loadingSelector,
    ];
    const edges: SymbolContractOriginEdge[] = [
      edge(apiItems, loadItems, "produces"),
      edge(loadItems, itemsState, "writes"),
      edge(itemsState, itemsSelector, "selects"),
      edge(policies, metadataFulfilled, "produces"),
      edge(preferences, metadataFulfilled, "produces"),
      edge(participants, metadataFulfilled, "produces"),
      edge(metadataFulfilled, metadataState, "writes"),
      edge(metadataState, metadataSelector, "selects"),
      edge(metadataPending, loadingState, "writes"),
      edge(loadingState, loadingSelector, "selects"),
    ];

    const topology = symbolOriginTopology(steps, edges);
    expect(topology.operations.map((operation) => operation.thunk.name)).toEqual([
      "loadCatalogMetadata",
      "loadItems",
    ]);
    expect(topology.operations[0]).toMatchObject({
      apis: [
        expect.objectContaining({ name: "resourceApi.participants" }),
        expect.objectContaining({ name: "resourceApi.policies" }),
        expect.objectContaining({ name: "resourceApi.preferences" }),
      ],
    });
    expect(topology.operations[0]?.lifecycles.map((lifecycle) => lifecycle.action.name)).toEqual([
      "loadCatalogMetadata.pending",
      "loadCatalogMetadata.fulfilled",
    ]);
    expect(topology.operations[0]?.lifecycles[0]?.apis).toEqual([]);
    expect(topology.operations[0]?.lifecycles[1]?.apis.map((api) => api.name)).toEqual([
      "resourceApi.participants",
      "resourceApi.policies",
      "resourceApi.preferences",
    ]);
    expect(topology.operations[1]).toMatchObject({
      thunk: {
        source: {
          kind: "thunk-call",
          thunkNodeId: "thunk:loadItems",
          fallbackFlowNodeId: "async-operation:loadItems.fulfilled",
        },
      },
      apis: [expect.objectContaining({ name: "resourceApi.items" })],
      lifecycles: [{
        action: expect.objectContaining({ name: "loadItems.fulfilled" }),
        apis: [expect.objectContaining({ name: "resourceApi.items" })],
        stateBranches: [{
          state: expect.objectContaining({ name: "catalog.items" }),
          selectors: [expect.objectContaining({ name: "selectItems" })],
        }],
      }],
    });
    expect(topology.unassigned).toEqual([]);
  });

  it("keeps the data-producing lifecycle and hides a reset of the same domain state", () => {
    const policies = step("api", "apiFetcher.resourceApi.policies");
    const preferences = step("api", "apiFetcher.resourceApi.preferences");
    const participants = step("api", "apiFetcher.resourceApi.participants");
    const fulfilled = {
      ...step("async-operation", "loadCatalogMetadata.fulfilled"),
      ownerNodeId: "thunk:loadCatalogMetadata",
    };
    const pending = {
      ...step("async-operation", "loadCatalogMetadata.pending"),
      ownerNodeId: "thunk:loadCatalogMetadata",
    };
    const metadataState = step("state-field", "state.catalog.metadata");
    const selector = step("selector-result", "selectMetadata");
    const topology = symbolOriginTopology(
      [policies, preferences, participants, fulfilled, pending, metadataState, selector],
      [
        edge(policies, fulfilled, "produces"),
        edge(preferences, fulfilled, "produces"),
        edge(participants, fulfilled, "produces"),
        edge(fulfilled, metadataState, "writes", "payload"),
        edge(pending, metadataState, "writes", "reset"),
        edge(metadataState, selector, "selects"),
      ],
      { targetName: "selectedItem" }
    );

    expect(topology.operations[0]?.lifecycles).toHaveLength(1);
    expect(topology.operations[0]?.lifecycles[0]).toMatchObject({
      action: { name: "loadCatalogMetadata.fulfilled" },
      apis: [
        { name: "resourceApi.participants" },
        { name: "resourceApi.policies" },
        { name: "resourceApi.preferences" },
      ],
      stateBranches: [{
        state: { name: "catalog.metadata" },
        selectors: [{ name: "selectMetadata" }],
        valueOrigin: "payload",
      }],
    });
  });

  it("keeps every lifecycle transition for a loading value", () => {
    const fulfilled = {
      ...step("async-operation", "loadCatalogMetadata.fulfilled"),
      ownerNodeId: "thunk:loadCatalogMetadata",
    };
    const pending = {
      ...step("async-operation", "loadCatalogMetadata.pending"),
      ownerNodeId: "thunk:loadCatalogMetadata",
    };
    const loadingState = step("state-field", "state.catalog.isMetadataLoading");
    const selector = step("selector-result", "selectIsMetadataLoading");
    const topology = symbolOriginTopology(
      [fulfilled, pending, loadingState, selector],
      [
        edge(fulfilled, loadingState, "writes", "literal"),
        edge(pending, loadingState, "writes", "literal"),
        edge(loadingState, selector, "selects"),
      ],
      { targetName: "isMetadataLoading" }
    );

    expect(topology.operations[0]?.lifecycles.map((lifecycle) => lifecycle.action.name)).toEqual([
      "loadCatalogMetadata.pending",
      "loadCatalogMetadata.fulfilled",
    ]);
  });
});

function step(kind: SymbolContractStep["kind"], name: string): SymbolContractStep {
  return { id: `${kind}:${name}`, kind, name };
}

function edge(
  from: SymbolContractStep,
  to: SymbolContractStep,
  relation: SymbolContractOriginEdge["relation"],
  valueOrigin?: NonNullable<SymbolContractOriginEdge["stateWrite"]>["valueOrigin"]
): SymbolContractOriginEdge {
  return {
    id: `${from.id}->${to.id}`,
    from: from.id,
    to: to.id,
    relation,
    confidence: "high",
    ...(valueOrigin ? {
      stateWrite: {
        statePath: to.path ?? to.name,
        lifecycle: from.path ?? from.name,
        valueOrigin,
      },
    } : {}),
  };
}
