import { describe, expect, it } from "vitest";
import { DEFAULT_VISIBLE_EDGE_TYPES, type GraphViewState } from "../src/ui/graph-view/viewTypes.js";
import {
  openFlowAggregate,
  openFlowList,
  openFlowTrace,
  openImpact,
  openOverview,
  openPageActions,
  openPageFlows,
  openPageImpact,
  openPageOverview,
  openPageQuality,
  openPageStructure,
  openUnit,
} from "../src/ui/src/productNavigation.js";

function state(overrides: Partial<GraphViewState> = {}): GraphViewState {
  return {
    mode: "pages-overview",
    pageFocusTab: "data-flow",
    pagesView: "table",
    expandedNodeIds: new Set(),
    visibleEdgeTypes: new Set(DEFAULT_VISIBLE_EDGE_TYPES),
    visibleLayers: new Set(),
    showHooks: true,
    showRedux: true,
    showFiles: false,
    showImports: false,
    showUnknown: false,
    showEnrichmentEdges: true,
    ...overrides,
  };
}

describe("productNavigation", () => {
  it("opens the page structure first, then a unit without losing page context", () => {
    const page = openPageStructure(state(), "page:orders");
    expect(page).toMatchObject({
      mode: "page-focus",
      selectedPageId: "page:orders",
      pageFocusTab: "structure",
    });

    const unit = openUnit(page, "component:OrderCard");
    expect(unit).toMatchObject({
      selectedPageId: "page:orders",
      selectedUnitId: "component:OrderCard",
      pageFocusTab: "structure",
    });

    expect(openFlowTrace(unit, "flow:status")).toMatchObject({
      selectedUnitId: "component:OrderCard",
      selectedFlowId: "flow:status",
      pageFocusTab: "data-flow",
    });
  });

  it("opens page flows directly from the page overview, on the list by default", () => {
    const next = openPageFlows(state(), "page:orders");

    expect(next.mode).toBe("page-focus");
    expect(next.selectedPageId).toBe("page:orders");
    expect(next.pageFocusTab).toBe("data-flow");
    // Default Flows presentation is the list, not the page-wide canvas.
    expect(next.flowsView).toBe("list");
    expect(next.selectedFlowId).toBeUndefined();
  });

  it("opens page actions as a dedicated semantic destination", () => {
    const next = openPageActions(state(), "page:orders");

    expect(next).toMatchObject({
      mode: "page-focus",
      selectedPageId: "page:orders",
      pageFocusTab: "actions",
      selectedFlowId: undefined,
    });
  });

  it("opens page impact as a dedicated semantic destination", () => {
    const next = openPageImpact(state(), "page:orders");

    expect(next).toMatchObject({
      mode: "page-focus",
      selectedPageId: "page:orders",
      pageFocusTab: "impact",
      selectedFlowId: undefined,
    });
  });

  it("opens page quality as a dedicated semantic destination", () => {
    const next = openPageQuality(state(), "page:orders");

    expect(next).toMatchObject({
      mode: "page-focus",
      selectedPageId: "page:orders",
      pageFocusTab: "quality",
      selectedFlowId: undefined,
    });
  });

  it("opens one flow's trace, returns to the list, and toggles the aggregate canvas", () => {
    const flows = openPageFlows(state(), "page:orders");

    const trace = openFlowTrace(flows, "flow:order-status");
    expect(trace).toMatchObject({ pageFocusTab: "data-flow", selectedFlowId: "flow:order-status" });
    expect(trace.traceView).toBeUndefined();

    // Back from a trace clears the selected flow and shows the list again.
    const back = openFlowList(trace);
    expect(back.selectedFlowId).toBeUndefined();
    expect(back.flowsView).toBe("list");
    expect(back.traceView).toBeUndefined();

    // The demoted page-wide canvas is an explicit, separate destination.
    const aggregate = openFlowAggregate(back);
    expect(aggregate).toMatchObject({ flowsView: "aggregate", selectedFlowId: undefined });
  });

  it("keeps summary and overview as deliberate product destinations", () => {
    const current = state({ mode: "page-focus", selectedPageId: "page:orders", pageFocusTab: "data-flow" });

    expect(openPageOverview(current).pageFocusTab).toBe("dossier");
    expect(openOverview(current)).toMatchObject({ mode: "pages-overview", pagesView: "table" });
  });

  it("opens impact for graph and canonical flow targets without losing page context", () => {
    const next = openImpact(state({ selectedPageId: "page:orders" }), "flow-node:order-status");

    expect(next).toMatchObject({
      mode: "impact",
      selectedPageId: "page:orders",
      impactNodeId: "flow-node:order-status",
    });
  });
});
