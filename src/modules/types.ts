import type { ComponentType } from "react";
import type { Connect } from "vite";
import type { ResolvedProjectMapConfig } from "../config/types.js";
import type { FlowIndex } from "../flow/types.js";
import type { ProjectMapGraph, ProjectMapNode } from "../graph/types.js";
import type {
  GraphEnrichment,
  MergedEnrichmentAnnotation,
  MergedNodeEnrichment,
} from "./enrichmentTypes.js";

export type {
  EnrichmentBadge,
  EnrichmentBadgeTone,
  EnrichmentEdge,
  EnrichmentAnnotation,
  EnrichmentSection,
  EnrichmentTarget,
  GraphEnrichment,
  MergedEnrichment,
  MergedEnrichmentAnnotation,
  MergedEnrichmentEdge,
  MergedNodeEnrichment,
  NodeEnrichment,
} from "./enrichmentTypes.js";

export type ServerModuleContext = {
  config: ResolvedProjectMapConfig;
  projectRoot: string;
};

export type EnrichmentContext = ServerModuleContext & {
  graph: ProjectMapGraph;
  /** Optional for modules that address canonical values or JSX occurrences. */
  flowIndex?: FlowIndex;
};

export type ProjectMapServerModule = {
  id: string;
  registerRoutes: (context: ServerModuleContext) => Connect.NextHandleFunction[];
  /** Optional overlay on top of the canonical graph; see enrichmentTypes.ts. */
  buildEnrichment?: (context: EnrichmentContext) => Promise<GraphEnrichment>;
};

export type NodeDetailsPanelContext = {
  node: ProjectMapNode;
  graph: ProjectMapGraph;
};

export type NodeDetailsPanelRegistration = {
  id: string;
  order: number;
  supportsNode?: (context: NodeDetailsPanelContext) => boolean;
  Component: ComponentType<NodeDetailsPanelContext>;
};

export type NodeActionContext = NodeDetailsPanelContext & {
  /** Module overlays already loaded for this canonical node. */
  enrichment: MergedNodeEnrichment[];
  /** Typed annotations whose target is this canonical node. */
  annotations: MergedEnrichmentAnnotation[];
};

export type NodeActionRegistration = {
  id: string;
  order: number;
  supportsNode?: (context: NodeActionContext) => boolean;
  /** Compact action rendered next to a node in primary product screens. */
  Component: ComponentType<NodeActionContext>;
};

export type ValueActionContext = {
  ownerNode: ProjectMapNode;
  graph: ProjectMapGraph;
  flowNodeId: string;
  valueLabel: string;
  /** Presentation hint for semantic details; actions may ignore it. */
  displayMode?: "compact" | "expanded";
  /** Typed annotations whose target is this canonical flow node. */
  annotations: MergedEnrichmentAnnotation[];
};

export type ValueActionRegistration = {
  id: string;
  order: number;
  supportsValue?: (context: ValueActionContext) => boolean;
  /** Compact action rendered next to a canonical value in Unit Screen. */
  Component: ComponentType<ValueActionContext>;
};

export type ValueDetailsRegistration = {
  id: string;
  order: number;
  supportsValue?: (context: ValueActionContext) => boolean;
  /** Inline semantic context rendered next to a canonical value. */
  Component: ComponentType<ValueActionContext>;
};

export type GlobalWidgetRegistration = {
  id: string;
  /** App-wide UI (e.g. a floating queue button); rendered once, outside any node selection. */
  Component: ComponentType;
};

export type SidebarWidgetRegistration = {
  id: string;
  order: number;
  /** Compact row in the sidebar (e.g. an e2e coverage summary). */
  Component: ComponentType;
};

export type ProjectMapUiModule = {
  id: string;
  nodeDetailsPanels?: NodeDetailsPanelRegistration[];
  nodeActions?: NodeActionRegistration[];
  valueDetails?: ValueDetailsRegistration[];
  valueActions?: ValueActionRegistration[];
  globalWidgets?: GlobalWidgetRegistration[];
  sidebarWidgets?: SidebarWidgetRegistration[];
};

// A module's server and UI halves are intentionally not combined into one
// object: they are registered through separate registries (registry.ts /
// uiRegistry.ts) so the Node and browser bundles stay isolated.
