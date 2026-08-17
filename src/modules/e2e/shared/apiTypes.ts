import type { GenerationJobResponse } from "../../../generation/jobs/apiTypes.js";

export type E2eGenerationTarget = "page-object" | "po-spec";

export type E2eFileStatus = {
  target: E2eGenerationTarget;
  status: "missing" | "exists";
  expectedPath: string;
  path?: string;
  updatedAt?: string;
  sizeBytes?: number;
};

export type E2eStatusResponse =
  | {
      nodeId: string;
      status: "unsupported";
      reason: string;
    }
  | {
      nodeId: string;
      status: "component";
      component: {
        id: string;
        name: string;
        file: string;
      };
      pageObject: E2eFileStatus;
      poSpec: E2eFileStatus;
      businessFlow: {
        status: "experimental";
        reason: string;
      };
    }
  | {
      nodeId: string;
      status: "page";
      page: {
        id: string;
        name: string;
        file: string;
      };
      dependentPageObjects: E2ePageObjectDependency[];
      coverage: {
        existing: number;
        total: number;
      };
      businessFlow: {
        status: "experimental";
        reason: string;
      };
    };

export type E2ePageObjectDependency = {
  nodeId: string;
  name: string;
  file: string;
  pageObjectPath: string;
  status: "missing" | "exists";
};

export type E2eReadResponse =
  | {
      nodeId: string;
      target: E2eGenerationTarget;
      status: "missing";
      expectedPath: string;
    }
  | {
      nodeId: string;
      target: E2eGenerationTarget;
      status: "exists";
      path: string;
      content: string;
    };

export type E2eContextItem = {
  id: string;
  label: string;
  type: "source-file" | "related-node" | "existing-page-object" | "existing-spec" | "test-selector" | "test-utility";
  file?: string;
  nodeId?: string;
  selected: boolean;
  reason: string;
};

export type E2eContextResponse = {
  node: {
    id: string;
    name: string;
    type: string;
    file?: string;
  };
  target: E2eGenerationTarget;
  pageObjectPath: string;
  poSpecPath: string;
  targetPath: string;
  suggestedContext: E2eContextItem[];
  graphSummary: string;
};

export type E2ePromptResponse = {
  nodeId: string;
  target: E2eGenerationTarget;
  targetPath: string;
  prompt: string;
  includedFiles: string[];
};

export type E2eJobResponse = GenerationJobResponse<{
  nodeId: string;
  target: E2eGenerationTarget;
  targetPath: string;
}>;

export type E2eCoverageSummaryResponse = {
  /** Pages whose every page-object target exists. */
  coveredPages: number;
  /** Pages that have at least one page-object target. */
  totalPages: number;
};
