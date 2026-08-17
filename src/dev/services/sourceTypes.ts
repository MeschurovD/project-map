export type SourceResponse = {
  nodeId?: string;
  edgeId?: string;
  name?: string;
  type?: string;
  file?: string;
  language: string;
  content: string;
  startLine?: number;
  endLine?: number;
  mode: "full-file" | "snippet" | "evidence-code";
  evidence?: {
    line?: number;
    code?: string;
  };
};
