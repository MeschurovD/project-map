import type { FlowValueSemantics } from "../../flow/types.js";

export type Confidence = "high" | "medium" | "low";

export type SourceLocation = {
  file?: string;
  line?: number;
  column?: number;
  startLine?: number;
  endLine?: number;
};

export type ValueFlowFact =
  | SelectorStateReadFact
  | SelectorBindingFact
  | LocalVariableUsageFact
  | HookBindingFact
  | HookReturnUsageFact
  | HookDeclarationShapeFact
  | HookReturnSpreadFact
  | HookReturnDependencyFact;

export type SelectorStateReadFact = {
  type: "selectorStateRead";
  selectorName: string;
  file: string;
  /**
   * Normalized `state.…` path the selector reads directly (or via a resolved
   * same-file composition base). Absent when the selector is derived from other
   * selectors (`derivedFromSelectors`) or is a constant with no state source.
   */
  statePath?: string;
  /**
   * Names of the selectors this one is composed from — `createSelector` inputs
   * (array or varargs form) and single-base compositions whose base has no
   * directly known state path. Replaces the former `"derived from a, b"` string
   * encoding of `statePath`.
   */
  derivedFromSelectors?: string[];
  /**
   * The selector takes no state parameter (e.g. `() => false`): it has no state
   * source by construction, distinct from a selector we failed to parse.
   */
  constant?: boolean;
  location?: SourceLocation;
  code?: string;
  confidence: Confidence;
};

export type SelectorBindingFact = {
  type: "selectorBinding";
  owner: string;
  ownerNodeId?: string;
  selectorName: string;
  /** Project-relative file containing the selector declaration after resolving imports/re-exports. */
  selectorFile?: string;
  /** Canonical state path when the selector is declared inline at the binding. */
  statePath?: string;
  localName: string;
  valueType?: string;
  file: string;
  location?: SourceLocation;
  code?: string;
  confidence: Confidence;
};

export type LocalVariableUsageKind =
  | "conditionalRender"
  | "ternaryCondition"
  | "prop"
  | "hookArgument"
  | "functionArgument"
  | "actionArgument"
  | "renderedExpression"
  | "eventHandler"
  | "unknown";

export type LocalVariableUsageFact = {
  type: "localVariableUsage";
  owner: string;
  ownerNodeId?: string;
  variableName: string;
  /** Property path read from the local value, relative to variableName. */
  propertyPath?: string;
  usageKind: LocalVariableUsageKind;
  targetName?: string;
  targetNodeId?: string;
  targetOccurrenceId?: string;
  propName?: string;
  file: string;
  location?: SourceLocation;
  code?: string;
  confidence: Confidence;
};

export type HookBindingFact = {
  type: "hookBinding";
  owner: string;
  ownerNodeId?: string;
  hookName: string;
  /** Package that owns the hook when its implementation is outside sourceRoot. */
  externalModule?: string;
  arguments: string[];
  boundTo:
    | {
      kind: "identifier";
      name: string;
    }
    | {
      kind: "objectDestructure";
      fields: Array<{
        sourceName: string;
        localName: string;
      }>;
    }
    | {
      kind: "arrayDestructure";
      items: Array<{
        index: number;
        localName: string;
      }>;
    }
    | {
      kind: "none";
    };
  file: string;
  location?: SourceLocation;
  code?: string;
  confidence: Confidence;
};

export type HookReturnUsageFact = {
  type: "hookReturnUsage";
  owner: string;
  ownerNodeId?: string;
  hookName: string;
  /** Package that owns the hook when its implementation is outside sourceRoot. */
  externalModule?: string;
  localName: string;
  /** Hook return path used by the consumer, including nested properties. */
  sourceField?: string;
  usageKind: Exclude<LocalVariableUsageKind, "ternaryCondition">;
  targetName?: string;
  targetNodeId?: string;
  targetOccurrenceId?: string;
  propName?: string;
  file: string;
  location?: SourceLocation;
  code?: string;
  confidence: Confidence;
};

export type HookDeclarationShapeFact = {
  type: "hookDeclarationShape";
  hookName: string;
  file: string;
  params: string[];
  returnShape?: {
    kind: "object" | "array" | "identifier" | "unknown";
    fields?: string[];
  };
  location?: SourceLocation;
  confidence: Confidence;
};

/** An object returned by a hook spreads the object returned by another hook. */
export type HookReturnSpreadFact = {
  type: "hookReturnSpread";
  hookName: string;
  sourceLocalName: string;
  sourceHookName: string;
  file: string;
  location?: SourceLocation;
  code?: string;
  confidence: Confidence;
};

/**
 * Which local values a hook's returned field is computed from. Resolved by
 * walking the hook body: a returned field's initializer references some locals,
 * each of which may reference others, transitively. The leaves that are bound to
 * selectors (selectorBinding with owner = hook) give the field's data origin.
 */
export type HookReturnDependencyFact = {
  type: "hookReturnDependency";
  hookName: string;
  /** Returned field name (object property or array element identifier). */
  field: string;
  /** Local variable names the field transitively depends on. */
  dependsOn: string[];
  /** Nested custom-hook return fields that feed one of the local dependencies. */
  hookSources?: Array<{
    localName: string;
    hookName: string;
    field: string;
  }>;
  /** Explicit non-canonical origins that legitimately enter or start in the hook. */
  boundarySources?: HookReturnBoundarySource[];
  /** Type and transformation facts derived directly from the returned expression. */
  valueSemantics?: FlowValueSemantics;
  file: string;
  location?: SourceLocation;
  confidence: Confidence;
};

export type HookReturnBoundarySource = {
  name: string;
  kind: "parameter" | "local-state" | "local-callback" | "local-value" | "import" | "literal";
  location?: SourceLocation;
  code?: string;
};

export function sourceLocation(file: string, location: { line: number; column: number }): SourceLocation {
  return {
    file,
    line: location.line,
    column: location.column,
  };
}
