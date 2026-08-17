import type { EdgeType, ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../../graph/types.js";
import type { EnrichmentBadge } from "../../modules/enrichmentTypes.js";
import type { FlowEdge, FlowEvidence } from "../../flow/types.js";
import type { ValueJourneyView } from "../../flow/buildValueJourney.js";

export type ProjectGraph = ProjectMapGraph;

export type ViewMode =
  | "pages-overview"
  | "business-logic"
  | "page-focus"
  | "component-focus"
  | "redux-focus"
  | "impact"
  | "full-debug";

export type PageFocusTab = "structure" | "actions" | "impact" | "quality" | "data-flow" | "debug" | "dossier";

/** Pages-overview presentation: cards on the canvas or a sortable dashboard. */
export type PagesView = "cards" | "table";

/**
 * Flows-tab presentation. "list" (default) shows the page's flows as a table;
 * "aggregate" is the demoted page-wide canvas of every flow (plan 17 §2.3 keeps
 * this only as an aggregated overview). A single flow's trace is opened via
 * `selectedFlowId`, independent of this toggle.
 */
export type FlowsView = "list" | "aggregate";

export type GraphViewState = {
  mode: ViewMode;
  /** Selected docs annotation in the project-wide business logic catalog. */
  selectedBusinessAnnotationId?: string;
  selectedPageId?: string;
  /** Component or hook opened from the page composition tree. */
  selectedUnitId?: string;
  inspectedNodeId?: string;
  /** Target of the impact view: "what depends on this node, up to pages". */
  impactNodeId?: string;
  pageFocusTab: PageFocusTab;
  pagesView: PagesView;
  /** Flows tab: list (default) or the demoted aggregate page-wide canvas. */
  flowsView?: FlowsView;
  /** Flows tab: the single flow whose left→right trace is open on the canvas. */
  selectedFlowId?: string;
  /** Selected representation of one value journey; omitted means its recommended view. */
  traceView?: ValueJourneyView;
  expandedNodeIds: Set<string>;
  visibleEdgeTypes: Set<EdgeType>;
  visibleLayers: Set<string>;
  showHooks: boolean;
  showRedux: boolean;
  showFiles: boolean;
  showImports: boolean;
  showUnknown: boolean;
  /** Render module overlay edges (e.g. coveredByTest) on top of the view. */
  showEnrichmentEdges: boolean;
};

export type PageStats = {
  widgets: number;
  features: number;
  entities: number;
  shared: number;
  hooks: number;
  redux: number;
};

export type ViewNodeKind = "page-card" | "folder-card" | "group-card" | "semantic-card" | "stage-header";

export type ViewGraphNode = {
  id: string;
  kind: ViewNodeKind;
  sourceNode?: ProjectMapNode;
  reasonEdges?: ProjectMapEdge[];
  label: string;
  file?: string;
  nodeType?: string;
  fsdLayer?: string;
  fsdSlice?: string | null;
  subtitle?: string;
  summaryBadges?: string[];
  /** Module overlay (GET /api/enrichment), applied after the view is built. */
  enrichmentBadges?: EnrichmentBadge[];
  enrichmentSummary?: string;
  dataFlow?: {
    stage: string;
    inputs?: string[];
    values?: string[];
    outputs?: string[];
    evidence?: FlowEvidence[];
    note?: string;
    /** Lifecycle writes hidden from the primary data path but available on demand. */
    secondaryWrites?: string[];
  };
  position: {
    x: number;
    y: number;
  };
  stats?: PageStats;
  count?: number;
  badgeLabel?: string;
  groupLayer?: FocusGroupLayer;
};

export type ViewGraphEdge = {
  id: string;
  from: string;
  to: string;
  /** "view" = structural edge of the view itself; "enrichment" = module overlay edge. */
  type: EdgeType | "view" | "enrichment";
  sourceEdge?: ProjectMapEdge;
  flowEdge?: FlowEdge;
  label?: string;
};

export type ViewGraph = {
  nodes: ViewGraphNode[];
  edges: ViewGraphEdge[];
};

export const SEMANTIC_EDGE_TYPES = new Set<EdgeType>([
  "renders",
  "usesHook",
  "usesSelector",
  "dispatchesAction",
  "readsSlice",
  "writesSlice",
  "callsApi",
  "dependsOn",
]);

export const DEBUG_EDGE_TYPES = new Set<EdgeType>([
  "imports",
  "definedIn",
  "contains",
]);

export const DEFAULT_VISIBLE_EDGE_TYPES = new Set<EdgeType>(SEMANTIC_EDGE_TYPES);

export const IGNORED_JSX_NAMES = new Set([
  "Fragment",
  "React.Fragment",
  "StrictMode",
  "Suspense",
]);

export const INFRASTRUCTURE_SHARED_MODULES = new Set([
  "shared:redux",
  "shared:hooks",
  "shared:types",
  "shared:constants",
]);

export const REDUX_HOOK_NAMES = new Set([
  "useSelector",
  "useAppSelector",
  "useDispatch",
  "useAppDispatch",
]);

export const FSD_FOCUS_GROUP_LAYERS = ["widgets", "features", "entities", "shared"] as const;

export const FOCUS_GROUP_LAYERS = [
  "widgets",
  "features",
  "entities",
  "shared",
  "selectors",
  "hooks",
  "external",
  "transitive",
] as const;

export type FocusGroupLayer = (typeof FOCUS_GROUP_LAYERS)[number];
export type FsdFocusGroupLayer = (typeof FSD_FOCUS_GROUP_LAYERS)[number];
