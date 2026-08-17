import type { ProjectMapNode } from "../../graph/types.js";
import type { Evidence, ProjectFact } from "../../scanner/facts.js";
import type {
  HookBindingFact,
  HookDeclarationShapeFact,
  HookReturnDependencyFact,
  HookReturnUsageFact,
  LocalVariableUsageFact,
  SelectorBindingFact,
  SelectorStateReadFact,
  ValueFlowFact,
} from "../../analyzers/value-flow/types.js";

export type DataFlowViewNodeType =
  | "state-field"
  | "input-selectors"
  | "selector"
  | "bound-value"
  | "local-variable"
  | "ui-effect"
  | "component"
  | "prop"
  | "hook"
  | "action"
  | "function";

export type SelectorValueFlow = {
  selector: ProjectMapNode;
  stateReads: SelectorStateReadFact[];
  bindings: Array<SelectorBindingFact & {
    usages: LocalVariableUsageFact[];
  }>;
};

export type HookValueFlow = {
  hook: ProjectMapNode;
  declarations: HookDeclarationShapeFact[];
  bindings: Array<HookBindingFact & {
    returnUsages: HookReturnUsageFact[];
  }>;
};

export type DataFlowUsageRole =
  | "data"
  | "loading"
  | "error"
  | "availability"
  | "visibility"
  | "text"
  | "handler"
  | "event"
  | "unknown";

export type DataFlowUsage = {
  sourceName: string;
  sourceKind: "hookReturn" | "selectorValue" | "localVariable";
  usageKind:
    | "prop"
    | "conditionalRender"
    | "eventHandler"
    | "hookArgument"
    | "functionArgument"
    | "actionArgument"
    | "renderedExpression"
    | "unknown";
  targetName?: string;
  targetNodeId?: string;
  targetType?: "component" | "hook" | "function" | "action" | "condition" | "unknown";
  propName?: string;
  evidence?: Evidence;
  confidence?: "high" | "medium" | "low";
};

export type DataFlowTargetGroup = {
  id: string;
  targetName: string;
  targetNodeId?: string;
  targetType: "component" | "hook" | "function" | "action" | "condition" | "unknown";
  usages: DataFlowUsage[];
  roles: Record<DataFlowUsageRole, DataFlowUsage[]>;
  stats: Record<DataFlowUsageRole, number> & {
    total: number;
  };
};

export function valueFlowFacts(facts: ProjectFact[]): ValueFlowFact[] {
  return facts.filter((fact): fact is ValueFlowFact => VALUE_FLOW_TYPES.has(fact.type));
}

export function selectorStateReadFacts(facts: ProjectFact[]) {
  return facts.filter((fact): fact is SelectorStateReadFact => fact.type === "selectorStateRead");
}

export function selectorBindingFacts(facts: ProjectFact[]) {
  return facts.filter((fact): fact is SelectorBindingFact => fact.type === "selectorBinding");
}

export function localVariableUsageFacts(facts: ProjectFact[]) {
  return facts.filter((fact): fact is LocalVariableUsageFact => fact.type === "localVariableUsage");
}

export function hookBindingFacts(facts: ProjectFact[]) {
  return facts.filter((fact): fact is HookBindingFact => fact.type === "hookBinding");
}

export function hookReturnUsageFacts(facts: ProjectFact[]) {
  return facts.filter((fact): fact is HookReturnUsageFact => fact.type === "hookReturnUsage");
}

export function hookDeclarationShapeFacts(facts: ProjectFact[]) {
  return facts.filter((fact): fact is HookDeclarationShapeFact => fact.type === "hookDeclarationShape");
}

export function hookReturnDependencyFacts(facts: ProjectFact[]) {
  return facts.filter((fact): fact is HookReturnDependencyFact => fact.type === "hookReturnDependency");
}

const VALUE_FLOW_TYPES = new Set<string>([
  "selectorStateRead",
  "selectorBinding",
  "localVariableUsage",
  "hookBinding",
  "hookReturnUsage",
  "hookDeclarationShape",
  "hookReturnDependency",
]);
