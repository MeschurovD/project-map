import type { ValueJourneyView } from "../../flow/buildValueJourney.js";
import type { FlowsView, PageFocusTab, PagesView, ViewMode } from "../graph-view/viewTypes.js";

// The shareable subset of explorer state, kept in the URL hash so any view
// can be linked to (code review, tickets) and survives a page reload.
export type UrlState = {
  mode?: ViewMode;
  selectedBusinessAnnotationId?: string;
  selectedPageId?: string;
  selectedUnitId?: string;
  inspectedNodeId?: string;
  impactNodeId?: string;
  pageFocusTab?: PageFocusTab;
  pagesView?: PagesView;
  flowsView?: FlowsView;
  selectedFlowId?: string;
  traceView?: ValueJourneyView;
  selectedNodeId?: string;
  query?: string;
};

const VIEW_MODES: ViewMode[] = ["pages-overview", "business-logic", "page-focus", "component-focus", "redux-focus", "impact", "full-debug"];
const PAGE_FOCUS_TABS: PageFocusTab[] = ["structure", "actions", "impact", "quality", "data-flow", "debug", "dossier"];
const PAGES_VIEWS: PagesView[] = ["cards", "table"];
const FLOWS_VIEWS: FlowsView[] = ["list", "aggregate"];
const TRACE_VIEWS: ValueJourneyView[] = ["steps", "graph", "evidence"];

const DEFAULT_MODE: ViewMode = "pages-overview";
const DEFAULT_TAB: PageFocusTab = "structure";
const DEFAULT_PAGES_VIEW: PagesView = "table";
const DEFAULT_FLOWS_VIEW: FlowsView = "list";

export function parseUrlState(hash: string): UrlState {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const mode = params.get("mode");
  const tab = params.get("tab");
  const pagesView = params.get("pages");
  const flowsView = params.get("flows");
  const traceView = params.get("trace");

  return {
    ...(isViewMode(mode) ? { mode } : {}),
    ...(params.get("business") ? { selectedBusinessAnnotationId: params.get("business") ?? undefined } : {}),
    ...(params.get("page") ? { selectedPageId: params.get("page") ?? undefined } : {}),
    ...(params.get("unit") ? { selectedUnitId: params.get("unit") ?? undefined } : {}),
    ...(params.get("inspect") ? { inspectedNodeId: params.get("inspect") ?? undefined } : {}),
    ...(params.get("impact") ? { impactNodeId: params.get("impact") ?? undefined } : {}),
    ...(isPageFocusTab(tab) ? { pageFocusTab: tab } : {}),
    ...(isPagesView(pagesView) ? { pagesView } : {}),
    ...(isFlowsView(flowsView) ? { flowsView } : {}),
    ...(params.get("flow") ? { selectedFlowId: params.get("flow") ?? undefined } : {}),
    ...(isTraceView(traceView) ? { traceView } : {}),
    ...(params.get("select") ? { selectedNodeId: params.get("select") ?? undefined } : {}),
    ...(params.get("q") ? { query: params.get("q") ?? undefined } : {}),
  };
}

// Returns "#key=value&…" or "" when everything is at its default.
export function serializeUrlState(state: UrlState): string {
  const params = new URLSearchParams();

  if (state.mode && state.mode !== DEFAULT_MODE) params.set("mode", state.mode);
  if (state.selectedBusinessAnnotationId) params.set("business", state.selectedBusinessAnnotationId);
  if (state.selectedPageId) params.set("page", state.selectedPageId);
  if (state.selectedUnitId) params.set("unit", state.selectedUnitId);
  if (state.pageFocusTab && state.pageFocusTab !== DEFAULT_TAB) params.set("tab", state.pageFocusTab);
  if (state.pagesView && state.pagesView !== DEFAULT_PAGES_VIEW) params.set("pages", state.pagesView);
  if (state.flowsView && state.flowsView !== DEFAULT_FLOWS_VIEW) params.set("flows", state.flowsView);
  if (state.selectedFlowId) params.set("flow", state.selectedFlowId);
  if (state.traceView) params.set("trace", state.traceView);
  if (state.inspectedNodeId) params.set("inspect", state.inspectedNodeId);
  if (state.impactNodeId) params.set("impact", state.impactNodeId);
  if (state.selectedNodeId) params.set("select", state.selectedNodeId);
  if (state.query) params.set("q", state.query);

  const serialized = params.toString();
  return serialized ? `#${serialized}` : "";
}

function isViewMode(value: string | null): value is ViewMode {
  return value !== null && (VIEW_MODES as string[]).includes(value);
}

function isPageFocusTab(value: string | null): value is PageFocusTab {
  return value !== null && (PAGE_FOCUS_TABS as string[]).includes(value);
}

function isPagesView(value: string | null): value is PagesView {
  return value !== null && (PAGES_VIEWS as string[]).includes(value);
}

function isFlowsView(value: string | null): value is FlowsView {
  return value !== null && (FLOWS_VIEWS as string[]).includes(value);
}

function isTraceView(value: string | null): value is ValueJourneyView {
  return value !== null && (TRACE_VIEWS as string[]).includes(value);
}
