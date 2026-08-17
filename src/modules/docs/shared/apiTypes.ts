import type { GenerationJobResponse } from "../../../generation/jobs/apiTypes.js";
import type { EnrichmentTarget } from "../../enrichmentTypes.js";
import type { EnrichmentValueCategory } from "../../enrichmentTypes.js";
import type { DocsV2Source } from "../server/services/docsV2FileFormat.js";

export type DocsFileMetaResponse = {
  path: string;
  updatedAt: string;
  sizeBytes: number;
  format: "structured" | "structured-v2" | "legacy";
  reviewed: boolean;
  staleReasons?: string[];
};

export type DocsStatusResponse =
  | {
      nodeId: string;
      status: "unsupported";
      reason: string;
    }
  | {
      nodeId: string;
      status: "missing";
      expectedPath: string;
    }
  | ({
      nodeId: string;
      status: "exists";
    } & DocsFileMetaResponse)
  | ({
      nodeId: string;
      /** Docs exist but were generated from an older version of the source. */
      status: "stale";
    } & DocsFileMetaResponse);

export type DocsReadResponse =
  | {
      nodeId: string;
      status: "missing";
      expectedPath: string;
    }
  | {
      nodeId: string;
      status: "unsupported";
      reason: string;
    }
  | {
      nodeId: string;
      status: "exists";
      path: string;
      content: string;
    };

export type DocsContextItem = {
  id: string;
  label: string;
  type: "source-file" | "related-node" | "graph-summary";
  file?: string;
  nodeId?: string;
  selected: boolean;
  reason: string;
};

export type DocsContextValue = {
  id: string;
  label: string;
  kind: string;
  confidence: "high" | "medium" | "low" | "unknown";
  documented: boolean;
  hasSummary: boolean;
  businessRuleCount: number;
  suggestedCategory: EnrichmentValueCategory;
  annotationKinds: string[];
};

export type DocsContextResponse = {
  node: {
    id: string;
    name: string;
    type: string;
    file?: string;
  };
  docsPath: string | null;
  suggestedContext: DocsContextItem[];
  graphSummary: string;
  valueFlowSummary: string;
  values: DocsContextValue[];
};

export type DocsPromptResponse = {
  nodeId: string;
  docsPath: string;
  prompt: string;
  includedFiles: string[];
  scope: DocsGenerationScope;
  sourceManifest: DocsV2Source[];
};

export type DocsJobResponse = GenerationJobResponse<{
  nodeId: string;
  docsPath: string;
}>;

export type DocsMode = "create" | "regenerate" | "migrate";

export type DocsGenerationScope =
  | { type: "document" }
  | { type: "annotation"; annotationIds: string[] }
  | {
      type: "target";
      target: EnrichmentTarget;
      /** Append one value-meaning block when the target has no annotations. */
      createIfMissing?: boolean;
      /** Append value-meaning when only rules/contracts target the value. */
      ensureValueMeaning?: boolean;
      /** Allow target generation to add proven rule/caution blocks. */
      includeBusinessLogic?: boolean;
    };

export type DocsStaleListResponse = {
  nodes: Array<{ nodeId: string; nodeName: string; docsPath: string }>;
};

export type DocsAuditIssue = {
  code: string;
  message: string;
  annotationId?: string;
};

export type DocsCoverageNode = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  expectedPath: string;
  documentPath?: string;
  documentFormat?: "structured" | "structured-v2" | "legacy";
  documented: boolean;
  fresh: boolean;
  reviewed: boolean;
  issues: DocsAuditIssue[];
};

export type DocsAuditDocument = {
  path: string;
  format: "structured" | "structured-v2" | "legacy";
  ownerNodeId?: string;
  ownerNodeName?: string;
  stale: boolean;
  reviewed: boolean;
  invalid: boolean;
  orphaned: boolean;
  issues: DocsAuditIssue[];
};

export type DocsCoverageResponse = {
  summary: {
    totalNodes: number;
    documentedNodes: number;
    freshNodes: number;
    reviewedNodes: number;
    missingNodes: number;
    invalidDocuments: number;
    orphanedDocuments: number;
  };
  nodes: DocsCoverageNode[];
  documents: DocsAuditDocument[];
};
