import type { Confidence } from "../graph/types.js";

export const FLOW_SCHEMA_VERSION = "1.4.0" as const;

export type FlowTransformationKind =
  | "direct"
  | "constant"
  | "property-read"
  | "find"
  | "filter"
  | "map"
  | "reduce"
  | "fallback"
  | "condition"
  | "object"
  | "array"
  | "call"
  | "expression";

export type FlowValueSemantics = {
  type?: string;
  transformation: {
    kind: FlowTransformationKind;
    inputPaths: string[];
    expression?: string;
    code?: string;
    operation?: string;
    file?: string;
    line?: number;
    endLine?: number;
    expressionLine?: number;
  };
};

export type FlowUiEffect = {
  kind: "conditional-render" | "rendered-value";
  targetName?: string;
};

export type FlowEvidence = {
  file: string;
  line?: number;
  column?: number;
  code?: string;
  /** First source line of a multi-line evidence fragment. */
  codeStartLine?: number;
};

export type FlowNodeKind =
  | "api"
  | "async-operation"
  | "state-field"
  | "selector-result"
  | "hook-input"
  | "hook-return"
  | "component-value"
  | "prop"
  | "ui-effect"
  | "boundary"
  | "gap";

export type FlowRelation =
  | "produces"
  | "writes"
  | "selects"
  | "derives"
  | "returns"
  | "binds"
  | "passes"
  | "controls";

export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  name: string;
  ownerNodeId?: string;
  occurrenceId?: string;
  path?: string;
  valueSemantics?: FlowValueSemantics;
  uiEffect?: FlowUiEffect;
  gap?: {
    reasonCode: string;
    message: string;
  };
  confidence: Confidence;
  evidence: FlowEvidence[];
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  relation: FlowRelation;
  confidence: Confidence;
  evidence: FlowEvidence[];
  stateWrite?: {
    statePath: string;
    lifecycle: string;
    valueOrigin: "payload" | "literal" | "reset" | "derived" | "unknown";
    payloadPath?: string;
  };
};

export type FlowCompleteness =
  | "complete"
  | "partial"
  | "source-only"
  | "consumer-only";

export type OriginStatus =
  | "proven"
  | "boundary"
  | "gap"
  | "unknown";

export type ContinuationStatus =
  | "proven"
  | "terminal-at-unit"
  | "gap"
  | "unknown";

export type FlowCoverage = {
  origin: OriginStatus;
  continuation: ContinuationStatus;
  reasonCodes: string[];
};

export type ValueFlow = {
  id: string;
  scopeNodeIds: string[];
  subjectNodeId: string;
  nodeIds: string[];
  edgeIds: string[];
  /** Legacy combined status kept during the PM-019 migration. */
  completeness: FlowCompleteness;
  /** Independent answers for “where from?” and “where next?”. */
  coverage: FlowCoverage;
};

export type JsxOccurrence = {
  id: string;
  parentId?: string;
  kind: "component" | "intrinsic" | "fragment";
  name: string;
  targetNodeId?: string;
  slotName?: string;
  returnIndex: number;
  evidence: FlowEvidence;
};

export type ComponentStructure = {
  componentNodeId: string;
  componentName: string;
  file: string;
  occurrences: JsxOccurrence[];
};

export type FlowIndex = {
  schemaVersion: typeof FLOW_SCHEMA_VERSION;
  runId: string;
  generatedAt: string;
  sourceFingerprint: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  flows: ValueFlow[];
  componentStructures: ComponentStructure[];
  stats: {
    flowsCount: number;
    completeFlowsCount: number;
    gapsCount: number;
    originResolvedFlowsCount: number;
    originGapFlowsCount: number;
    originUnknownFlowsCount: number;
    continuationResolvedFlowsCount: number;
  };
};

export type FlowBuildMetadata = Pick<
  FlowIndex,
  "runId" | "generatedAt" | "sourceFingerprint"
>;

export type PageScopeWarning = {
  code: "page-component-not-found";
  message: string;
};

export type PageScope = {
  pageId: string;
  primaryComponentId?: string;
  entryComponentIds: string[];
  topologyNodeIds: string[];
  topologyEdgeIds: string[];
  flowIds: string[];
  flowNodeIds: string[];
  flowEdgeIds: string[];
  warnings: PageScopeWarning[];
  stats: {
    topologyNodesCount: number;
    topologyEdgesCount: number;
    flowsCount: number;
    flowNodesCount: number;
    flowEdgesCount: number;
    gapsCount: number;
  };
};
