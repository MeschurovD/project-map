import type { ProjectMapNode } from "../../../../graph/types.js";
import type { GenerationJob, GenerationJobStatus } from "../../../../generation/jobs/types.js";
import type { EnrichmentTarget, EnrichmentValueCategory } from "../../../enrichmentTypes.js";

export type DocsFileMeta = {
  path: string;
  updatedAt: string;
  sizeBytes: number;
  /** v1 fixed sections, v2 target blocks, or old free-form Markdown. */
  format: "structured" | "structured-v2" | "legacy";
  reviewed: boolean;
  staleReasons?: string[];
};

export type DocsStatus =
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
    } & DocsFileMeta)
  | ({
      nodeId: string;
      /** The file exists but its sourceHash no longer matches the source file. */
      status: "stale";
    } & DocsFileMeta);

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

export type DocsContext = {
  node: Pick<ProjectMapNode, "id" | "name" | "type" | "file">;
  docsPath: string | null;
  suggestedContext: DocsContextItem[];
  graphSummary: string;
  valueFlowSummary: string;
  values: DocsContextValue[];
};

export type DocsPromptMode = "create" | "regenerate" | "migrate";

export type DocsGenerationScope =
  | { type: "document" }
  | { type: "annotation"; annotationIds: string[] }
  | {
      type: "target";
      target: EnrichmentTarget;
      createIfMissing?: boolean;
      /** Append value-meaning even when other kinds already target the value. */
      ensureValueMeaning?: boolean;
      /** Allow target generation to add proven rule/caution blocks. */
      includeBusinessLogic?: boolean;
    };

export type DocsJobStatus = GenerationJobStatus;

export type DocsJobMetadata = {
  nodeId: string;
  docsPath: string;
};

export type DocsJob = GenerationJob<DocsJobMetadata>;
