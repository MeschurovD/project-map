// Enrichment is a layer on top of the canonical graph, never a mutation of
// graph.json: the core stays the source of truth, the overlay is optional and
// survives a rescan. Types-only file so both the Node server and the browser
// bundle can import it.

export type EnrichmentBadgeTone = "info" | "ok" | "warn";

export type EnrichmentBadge = {
  id: string;
  label: string;
  tone?: EnrichmentBadgeTone;
};

export type EnrichmentSection = {
  id: string;
  title: string;
  markdown: string;
};

export type EnrichmentTarget =
  | { type: "node"; id: string }
  | { type: "flow-node"; id: string }
  | { type: "occurrence"; id: string };

export type EnrichmentValueCategory =
  | "domain-data"
  | "decision"
  | "ui-state"
  | "user-input"
  | "handler"
  | "technical";

export type EnrichmentAnnotation = {
  id: string;
  /** Canonical graph node that owns the source document. */
  ownerNodeId: string;
  /** Module-defined semantic kind, e.g. summary or business-rule. */
  kind: string;
  targets: EnrichmentTarget[];
  /** Compact plain-text projection; value-meaning uses it in collapsed UI. */
  summary?: string;
  /** Semantic role of a documented value, independent from its flow kind. */
  valueCategory?: EnrichmentValueCategory;
  markdown: string;
  confidence?: "high" | "medium" | "low";
  review?: "generated" | "reviewed";
  stale?: boolean;
  documentId?: string;
  /** Optional UI projection policy declared by the producing module. */
  propagation?: "identity" | "context";
  /** Present only on a computed client-side match; absent means direct target. */
  association?: {
    kind: "inherited" | "related";
    sourceTargetId: string;
    sourceLabel?: string;
    relations: string[];
    confidence?: "high" | "medium" | "low" | "unknown";
  };
};

export type NodeEnrichment = {
  /** Id of a canonical graph node; entries with unknown ids are dropped. */
  nodeId: string;
  badges?: EnrichmentBadge[];
  /** Short text for the node card. */
  summary?: string;
  /** Extra panels for NodeDetails. */
  sections?: EnrichmentSection[];
};

export type EnrichmentEdge = {
  id: string;
  /** Both endpoints must be canonical graph node ids; broken refs are dropped. */
  from: string;
  to: string;
  type: string;
  label?: string;
};

/** What a single module returns from buildEnrichment. */
export type GraphEnrichment = {
  nodes?: NodeEnrichment[];
  edges?: EnrichmentEdge[];
  annotations?: EnrichmentAnnotation[];
};

export type MergedNodeEnrichment = NodeEnrichment & { moduleId: string };
export type MergedEnrichmentEdge = EnrichmentEdge & { moduleId: string };
export type MergedEnrichmentAnnotation = EnrichmentAnnotation & { moduleId: string };

export const ENRICHMENT_SCHEMA_VERSION = "1.1.0";

/** Combined result of all modules, served by GET /api/enrichment. */
export type MergedEnrichment = {
  schemaVersion: typeof ENRICHMENT_SCHEMA_VERSION;
  nodes: MergedNodeEnrichment[];
  edges: MergedEnrichmentEdge[];
  annotations: MergedEnrichmentAnnotation[];
  /** Dropped refs and failed modules; surfaced instead of breaking the map. */
  warnings: string[];
};
