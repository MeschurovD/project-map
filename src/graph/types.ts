import type { Evidence, FsdInfo } from "../scanner/facts.js";

export type NodeType =
  | "project"
  | "layer"
  | "slice"
  | "segment"
  | "page"
  | "widget"
  | "feature"
  | "entity"
  | "shared"
  | "component"
  | "hook"
  | "selector"
  | "action"
  | "thunk"
  | "slice-model"
  | "api"
  | "file"
  | "external-package"
  | "unknown";

export type EdgeType =
  | "contains"
  | "imports"
  | "reExports"
  | "dependsOn"
  | "renders"
  | "usesHook"
  | "usesSelector"
  | "dispatchesAction"
  | "readsSlice"
  | "writesSlice"
  | "callsApi"
  | "belongsToLayer"
  | "belongsToSlice"
  | "definedIn"
  | "unknown";

export type Confidence = "high" | "medium" | "low" | "unknown";

export type ProjectMapNode = {
  id: string;
  type: NodeType;
  name: string;
  file?: string;
  fsd?: Partial<FsdInfo>;
  meta?: Record<string, unknown>;
};

export type ProjectMapEdge = {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  confidence: Confidence;
  evidence: Evidence[];
};

export type ProjectMapGraph = {
  // 1.1.0: added thunk nodes and writesSlice edges (createAsyncThunk/extraReducers).
  schemaVersion: "1.1.0";
  project: {
    name: string;
    root: string;
    sourceRoot: string;
  };
  nodes: ProjectMapNode[];
  edges: ProjectMapEdge[];
  stats: {
    nodesCount: number;
    edgesCount: number;
  };
};
