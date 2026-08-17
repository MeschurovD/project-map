import type { ProjectMapNode } from "../../../../graph/types.js";
import type { E2eContextItem, E2eGenerationTarget } from "../../shared/apiTypes.js";

export type ComponentE2eTargets = {
  pageObjectPath: string;
  poSpecPath: string;
};

export type E2eContext = {
  node: Pick<ProjectMapNode, "id" | "name" | "type" | "file">;
  target: E2eGenerationTarget;
  pageObjectPath: string;
  poSpecPath: string;
  targetPath: string;
  suggestedContext: E2eContextItem[];
  graphSummary: string;
};
