import type { ValueFlowFact } from "../analyzers/value-flow/types.js";

export type Location = {
  line: number;
  column: number;
};

export type Evidence = Location & {
  file: string;
  code?: string;
};

export type FsdInfo = {
  layer: string;
  slice: string | null;
  segment: string | null;
};

export type FileFact = {
  type: "file";
  file: string;
  extension: ".ts" | ".tsx";
};

export type ImportFact = {
  type: "import";
  sourceFile: string;
  target: string;
  importedNames: string[];
  defaultImportName?: string;
  namespaceImportName?: string;
  isTypeOnly: boolean;
  location: Location;
};

export type ResolvedImportFact = {
  type: "resolvedImport";
  sourceFile: string;
  target: string;
  targetFile?: string;
  packageName?: string;
  resolved: boolean;
  external: boolean;
  location: Location;
};

export type ExportFact = {
  type: "export";
  sourceFile: string;
  exportedNames: string[];
};

export type FsdClassificationFact = {
  type: "fsdClassification";
  file: string;
  layer: string;
  slice: string | null;
  segment: string | null;
};

export type ComponentFact = {
  type: "component";
  name: string;
  file: string;
  exported: boolean;
  declaration: "function" | "arrow" | "memo" | "forwardRef";
  location: Location;
};

export type JsxUsageFact = {
  type: "jsxUsage";
  sourceFile: string;
  ownerComponent: string;
  componentName: string;
  location: Location;
  code: string;
};

/**
 * One concrete JSX callsite inside a component return tree.
 *
 * Unlike `jsxUsage`, this is occurrence-aware: repeated uses of the same
 * component keep distinct ids and JSX passed through a prop keeps its slot.
 * Canonical component dependency edges remain separate in ProjectMapGraph.
 */
export type JsxOccurrenceFact = {
  type: "jsxOccurrence";
  occurrenceId: string;
  parentOccurrenceId?: string;
  sourceFile: string;
  ownerComponent: string;
  kind: "component" | "intrinsic" | "fragment";
  tagName: string;
  slotName?: string;
  returnIndex: number;
  location: Location;
  code: string;
};

export type HookFact = {
  type: "hook";
  name: string;
  file: string;
  exported: boolean;
  location: Location;
};

export type HookCallFact = {
  type: "hookCall";
  sourceFile: string;
  owner: string;
  hookName: string;
  location: Location;
  code: string;
};

export type SelectorUsageFact = {
  type: "selectorUsage";
  sourceFile: string;
  owner: string;
  selectorHook: string;
  selectorName: string;
  location: Location;
  code: string;
};

export type InlineSelectorUsageFact = {
  type: "inlineSelectorUsage";
  sourceFile: string;
  owner: string;
  selectorHook: string;
  statePath: string;
  sliceName: string | null;
  location: Location;
  code: string;
};

export type DispatchCallFact = {
  type: "dispatchCall";
  sourceFile: string;
  owner: string;
  actionName: string;
  location: Location;
  code: string;
};

export type RtkQueryHookCallFact = {
  type: "rtkQueryHookCall";
  sourceFile: string;
  owner: string;
  hookName: string;
  location: Location;
  code: string;
};

export type ReduxSliceFact = {
  type: "reduxSlice";
  name: string;
  variableName: string | null;
  file: string;
  location: Location;
};

export type ReduxActionFact = {
  type: "reduxAction";
  name: string;
  sliceName: string;
  file: string;
  location: Location;
  /** Exact assignments performed by this synchronous slice reducer. */
  writes?: SliceStateWrite[];
};

/** An HTTP call found inside a thunk's payload creator (heuristic). */
export type ThunkApiCall = {
  /** Direct HTTP call or a call through an imported API/service boundary. */
  kind?: "http" | "service";
  /** HTTP method, e.g. GET/POST, uppercased; "GET" assumed for bare fetch. */
  method: string;
  /** URL literal or imported service symbol, e.g. "/records/${id}" or "recordsApi.get". */
  url: string;
  /** Nearest meaningful statement containing the call, not only the call expression. */
  code: string;
  /** First source line of `code`; `line` remains the exact API call line. */
  codeStartLine?: number;
  line: number;
};

export type ReduxThunkFact = {
  type: "reduxThunk";
  /** Variable the createAsyncThunk result is assigned to, e.g. fetchUser. */
  name: string;
  /** First createAsyncThunk argument, e.g. "user/fetchUser". */
  typePrefix: string | null;
  /** HTTP calls detected in the payload creator (thunk → API link). */
  apiCalls?: ThunkApiCall[];
  file: string;
  location: Location;
};

export type SliceWriteFact = {
  type: "sliceWrite";
  sliceName: string;
  /** Root identifier of the extraReducers case, e.g. fetchUser for fetchUser.fulfilled. */
  writerName: string;
  /** Thunk lifecycle stage when present: fulfilled | pending | rejected. */
  writerState: string | null;
  writes?: SliceStateWrite[];
  file: string;
  location: Location;
  code: string;
  /** First line of the complete reducer case stored in `code`. */
  codeStartLine?: number;
};

export type SliceStateWrite = {
  statePath: string;
  valueOrigin: "payload" | "literal" | "reset" | "derived" | "unknown";
  payloadPath?: string;
  location: Location;
  code: string;
};

export type UnresolvedFact = {
  type: "unresolvedImport" | "unresolvedJsxComponent" | "unresolvedHook";
  sourceFile: string;
  name?: string;
  target?: string;
  reason: string;
  location?: Location;
};

export type ProjectFact =
  | FileFact
  | ImportFact
  | ResolvedImportFact
  | ExportFact
  | FsdClassificationFact
  | ComponentFact
  | JsxUsageFact
  | JsxOccurrenceFact
  | HookFact
  | HookCallFact
  | SelectorUsageFact
  | InlineSelectorUsageFact
  | DispatchCallFact
  | RtkQueryHookCallFact
  | ReduxSliceFact
  | ReduxActionFact
  | ReduxThunkFact
  | SliceWriteFact
  | ValueFlowFact
  | UnresolvedFact;
