import type { GraphViewState } from "../graph-view/viewTypes.js";

export function openOverview(current: GraphViewState): GraphViewState {
  return {
    ...current,
    mode: "pages-overview",
    pagesView: "table",
    selectedPageId: undefined,
    selectedUnitId: undefined,
    inspectedNodeId: undefined,
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "list",
  };
}

export function openBusinessLogic(
  current: GraphViewState,
  annotationId = current.selectedBusinessAnnotationId
): GraphViewState {
  return {
    ...current,
    mode: "business-logic",
    selectedBusinessAnnotationId: annotationId,
    inspectedNodeId: undefined,
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "list",
  };
}

export function openPageStructure(current: GraphViewState, pageId = current.selectedPageId): GraphViewState {
  if (!pageId) return current;
  return {
    ...current,
    mode: "page-focus",
    selectedPageId: pageId,
    selectedUnitId: undefined,
    pageFocusTab: "structure",
    inspectedNodeId: undefined,
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "list",
  };
}

export function openUnit(
  current: GraphViewState,
  unitId: string,
  pageId = current.selectedPageId
): GraphViewState {
  if (!pageId) return current;
  return {
    ...current,
    mode: "page-focus",
    selectedPageId: pageId,
    selectedUnitId: unitId,
    pageFocusTab: "structure",
    inspectedNodeId: undefined,
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "list",
  };
}

export function openPageFlows(current: GraphViewState, pageId = current.selectedPageId): GraphViewState {
  if (!pageId) return current;
  return {
    ...current,
    mode: "page-focus",
    selectedPageId: pageId,
    selectedUnitId: undefined,
    pageFocusTab: "data-flow",
    inspectedNodeId: undefined,
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "list",
  };
}

export function openPageActions(current: GraphViewState, pageId = current.selectedPageId): GraphViewState {
  if (!pageId) return current;
  return {
    ...current,
    mode: "page-focus",
    selectedPageId: pageId,
    selectedUnitId: undefined,
    pageFocusTab: "actions",
    inspectedNodeId: undefined,
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "list",
  };
}

export function openPageImpact(current: GraphViewState, pageId = current.selectedPageId): GraphViewState {
  if (!pageId) return current;
  return {
    ...current,
    mode: "page-focus",
    selectedPageId: pageId,
    selectedUnitId: undefined,
    pageFocusTab: "impact",
    inspectedNodeId: undefined,
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "list",
  };
}

export function openPageQuality(current: GraphViewState, pageId = current.selectedPageId): GraphViewState {
  if (!pageId) return current;
  return {
    ...current,
    mode: "page-focus",
    selectedPageId: pageId,
    selectedUnitId: undefined,
    pageFocusTab: "quality",
    inspectedNodeId: undefined,
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "list",
  };
}

export function openPageOverview(current: GraphViewState): GraphViewState {
  if (!current.selectedPageId) return current;
  return {
    ...current,
    mode: "page-focus",
    selectedUnitId: undefined,
    pageFocusTab: "dossier",
    inspectedNodeId: undefined,
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "list",
  };
}

// Open one flow's left→right trace from the Flows list.
export function openFlowTrace(
  current: GraphViewState,
  flowId: string,
  unitId = current.selectedUnitId
): GraphViewState {
  return {
    ...current,
    mode: "page-focus",
    pageFocusTab: "data-flow",
    selectedUnitId: unitId,
    selectedFlowId: flowId,
    traceView: undefined,
    flowsView: "list",
  };
}

// Back from a trace (or the aggregate canvas) to the Flows list.
export function openFlowList(current: GraphViewState): GraphViewState {
  return {
    ...current,
    mode: "page-focus",
    pageFocusTab: "data-flow",
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "list",
  };
}

// The demoted page-wide canvas of every flow (aggregated overview, plan §2.3).
export function openFlowAggregate(current: GraphViewState): GraphViewState {
  return {
    ...current,
    mode: "page-focus",
    pageFocusTab: "data-flow",
    selectedFlowId: undefined,
    traceView: undefined,
    flowsView: "aggregate",
  };
}

export function openImpact(current: GraphViewState, targetId: string): GraphViewState {
  return { ...current, mode: "impact", impactNodeId: targetId };
}
