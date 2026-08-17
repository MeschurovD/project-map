import type {
  HookBindingFact,
  HookDeclarationShapeFact,
  HookReturnUsageFact,
  LocalVariableUsageFact,
  SelectorBindingFact,
  SourceLocation,
} from "../../analyzers/value-flow/types.js";
import type { ProjectMapGraph, ProjectMapNode } from "../../graph/types.js";
import type { ProjectFact } from "../../scanner/facts.js";
import { collectNodeInternals } from "../graph-view/collectNodeInternals.js";
import {
  hookBindingFacts,
  hookDeclarationShapeFacts,
  hookReturnUsageFacts,
  localVariableUsageFacts,
  selectorBindingFacts,
} from "./valueFlowTypes.js";

export type ComponentSummarySection = {
  titleKey: ComponentSummarySectionKey;
  rows: ComponentSummaryRow[];
};

export type ComponentSummarySectionKey =
  | "structure"
  | "hook"
  | "hookState"
  | "hookTexts"
  | "hookAvailability"
  | "hookHandlers"
  | "hookOther"
  | "selectorValues"
  | "events";

export type ComponentSummaryRow = {
  label: string;
  detail?: string;
  location?: SourceLocation;
  code?: string;
};

export type ComponentOverviewKind =
  | "rendersChildren"
  | "usesHooks"
  | "usesSelectors"
  | "dispatchesActions"
  | "callsApi"
  | "passesState"
  | "passesHandlers"
  | "generic";

/** One overview bullet: a relationship plus the concrete names it involves,
 * so the UI can render "reads: selectFeatureData, selectFeaturePermission" instead of a
 * generic "uses selector values in its render flow". */
export type ComponentOverviewLine = { kind: ComponentOverviewKind; names: string[] };

export type ComponentSemanticSummary = {
  overviewLines: ComponentOverviewLine[];
  sections: ComponentSummarySection[];
  rawRows: ComponentSummaryRow[];
};

export function buildComponentSemanticSummary(
  graph: ProjectMapGraph,
  facts: ProjectFact[],
  component: ProjectMapNode
): ComponentSemanticSummary {
  const selectorBindings = uniqueSelectorBindings(selectorBindingFacts(facts).filter((fact) => fact.ownerNodeId === component.id));
  const hookBindings = hookBindingFacts(facts).filter((fact) => fact.ownerNodeId === component.id);
  const localUsages = localVariableUsageFacts(facts).filter((fact) => fact.ownerNodeId === component.id);
  const hookUsages = hookReturnUsageFacts(facts).filter((fact) => fact.ownerNodeId === component.id);
  const declarations = hookDeclarationShapeFacts(facts);
  const internals = collectNodeInternals(graph, component.id, {
    showFiles: false,
    showImports: false,
    showUnknown: false,
  });

  const sections: ComponentSummarySection[] = [];
  const structureRows = structureSummaryRows(internals);
  if (structureRows.length > 0) sections.push({ titleKey: "structure", rows: structureRows });

  const hookRows = hookSummaryRows(hookBindings, declarations);
  if (hookRows.length > 0) sections.push({ titleKey: "hook", rows: hookRows });

  const hookValueGroups = groupedHookValueRows(hookBindings, hookUsages);
  for (const group of hookValueGroups) {
    if (group.rows.length > 0) sections.push(group);
  }

  const selectorRows = selectorBindings.map((binding) => {
    const destinations = localUsages
      .filter((usage) => usage.owner === binding.owner && usage.variableName === binding.localName)
      .map(usageDestination);
    return {
      label: `${binding.selectorName} -> ${binding.localName}`,
      detail: uniqueStrings(destinations).join(", ") || undefined,
      location: destinations.length > 0
        ? localUsages.find((usage) => usage.owner === binding.owner && usage.variableName === binding.localName)?.location
        : binding.location,
      code: binding.code,
    };
  });
  if (selectorRows.length > 0) sections.push({ titleKey: "selectorValues", rows: selectorRows });

  const eventRows = hookUsages
    .filter((usage) => usage.usageKind === "eventHandler")
    .map((usage) => ({
      label: usage.sourceField ?? usage.localName,
      detail: usageDestination(usage),
      location: usage.location,
      code: usage.code,
    }));
  if (eventRows.length > 0) sections.push({ titleKey: "events", rows: eventRows });

  return {
    overviewLines: componentOverviewLines(component, selectorBindings, hookBindings, hookUsages, internals),
    sections,
    rawRows: [
      ...selectorBindings.map((binding) => ({
        label: `selectorBinding: ${binding.selectorName} -> ${binding.localName}`,
        detail: binding.owner,
        location: binding.location,
        code: binding.code,
      })),
      ...hookBindings.map((binding) => ({
        label: `hookBinding: ${binding.hookName} -> ${hookBindingLocals(binding).map((local) => local.localName).join(", ")}`,
        detail: binding.arguments.join(", "),
        location: binding.location,
        code: binding.code,
      })),
      ...hookUsages.map((usage) => ({
        label: `hookReturnUsage: ${usage.localName} -> ${usageDestination(usage)}`,
        detail: usage.hookName,
        location: usage.location,
        code: usage.code,
      })),
    ],
  };
}

// Concrete overview: each line names the specific selectors/hooks/components
// involved, so the reader sees "renders: EditDisplayOptions, ProfileForm"
// rather than "renders child UI components". Names are capped so a long list
// stays readable.
function componentOverviewLines(
  component: ProjectMapNode,
  selectorBindings: SelectorBindingFact[],
  hookBindings: HookBindingFact[],
  hookUsages: HookReturnUsageFact[],
  internals: ReturnType<typeof collectNodeInternals>
): ComponentOverviewLine[] {
  const lines: ComponentOverviewLine[] = [];
  const push = (kind: ComponentOverviewKind, names: string[]) => {
    const unique = uniqueStrings(names).slice(0, OVERVIEW_NAME_LIMIT);
    if (unique.length > 0) lines.push({ kind, names: unique });
  };

  push("rendersChildren", internals.renderedComponents.map((node) => node.name));
  push("usesHooks", hookBindings.map((binding) => binding.hookName));
  push("usesSelectors", selectorBindings.map((binding) => binding.selectorName));
  push("dispatchesActions", internals.actions.map((node) => node.name));
  push("callsApi", internals.apiCalls.map((node) => node.name));
  push("passesState", hookUsages.filter((usage) => usage.usageKind === "prop").map(usageDestination));
  push("passesHandlers", hookUsages.filter((usage) => usage.usageKind === "eventHandler").map(usageDestination));

  if (lines.length === 0) lines.push({ kind: "generic", names: [component.name] });
  return lines.slice(0, OVERVIEW_LINE_LIMIT);
}

const OVERVIEW_NAME_LIMIT = 6;
const OVERVIEW_LINE_LIMIT = 6;

function structureSummaryRows(internals: ReturnType<typeof collectNodeInternals>) {
  return [
    ...internals.renderedComponents.map((node) => ({ label: `renders ${node.name}`, detail: node.type })),
    ...internals.hooks.map((node) => ({ label: `uses ${node.name}`, detail: node.type })),
    ...internals.selectors.map((node) => ({ label: `reads ${node.name}`, detail: node.type })),
    ...internals.actions.map((node) => ({ label: `dispatches ${node.name}`, detail: node.type })),
    ...internals.apiCalls.map((node) => ({ label: `calls ${node.name}`, detail: node.type })),
  ];
}

function hookSummaryRows(bindings: HookBindingFact[], declarations: HookDeclarationShapeFact[]) {
  return bindings.map((binding) => {
    const declared = declarations.find((declaration) => declaration.hookName === binding.hookName);
    const declaredCount = declared?.returnShape?.fields?.length;
    const localCount = hookBindingLocals(binding).length;
    const count = declaredCount ?? localCount;
    return {
      label: binding.hookName,
      detail: count > 0 ? `returns ${count} values` : "return shape unknown",
      location: binding.location,
      code: binding.code,
    };
  });
}

function groupedHookValueRows(bindings: HookBindingFact[], usages: HookReturnUsageFact[]) {
  const groups: ComponentSummarySection[] = [
    { titleKey: "hookState", rows: [] },
    { titleKey: "hookTexts", rows: [] },
    { titleKey: "hookAvailability", rows: [] },
    { titleKey: "hookHandlers", rows: [] },
    { titleKey: "hookOther", rows: [] },
  ];
  const groupByKey = new Map(groups.map((group) => [group.titleKey, group]));

  for (const binding of bindings) {
    for (const local of hookBindingLocals(binding)) {
      const matchingUsages = usages.filter((usage) =>
        usage.hookName === binding.hookName &&
        usage.owner === binding.owner &&
        usage.localName === local.localName
      );
      const destinations = uniqueStrings(matchingUsages.map(usageDestination));
      const row = {
        label: local.sourceField && local.sourceField !== local.localName
          ? `${local.sourceField} -> ${local.localName}`
          : local.localName,
        detail: destinations.join(", ") || undefined,
        location: matchingUsages[0]?.location ?? binding.location,
        code: matchingUsages[0]?.code ?? binding.code,
      };
      groupByKey.get(categoryForHookValue(local.sourceField ?? local.localName, matchingUsages))?.rows.push(row);
    }
  }

  return groups;
}

type HookBindingLocal = {
  sourceField?: string;
  localName: string;
};

function hookBindingLocals(binding: HookBindingFact): HookBindingLocal[] {
  if (binding.boundTo.kind === "identifier") return [{ localName: binding.boundTo.name }];
  if (binding.boundTo.kind === "objectDestructure") {
    return binding.boundTo.fields.map((field) => ({
      sourceField: field.sourceName,
      localName: field.localName,
    }));
  }
  if (binding.boundTo.kind === "arrayDestructure") {
    return binding.boundTo.items.map((item) => ({
      sourceField: String(item.index),
      localName: item.localName,
    }));
  }
  return [];
}

function categoryForHookValue(name: string, usages: HookReturnUsageFact[]): ComponentSummarySectionKey {
  const normalized = name.toLowerCase();
  if (usages.some((usage) => usage.usageKind === "eventHandler") || /^handle[A-Z]/.test(name) || /^on[A-Z]/.test(name)) {
    return "hookHandlers";
  }
  if (normalized.includes("disabled") || usages.some((usage) => usage.propName?.toLowerCase() === "disabled")) {
    return "hookAvailability";
  }
  if (
    normalized.includes("text") ||
    normalized.includes("title") ||
    normalized.includes("message") ||
    normalized.includes("tooltip") ||
    normalized.includes("label")
  ) {
    return "hookTexts";
  }
  if (/^(is|has|should|can|will)[A-Z]/.test(name) || normalized.includes("loading") || normalized.includes("error")) {
    return "hookState";
  }
  return "hookOther";
}

function usageDestination(usage: HookReturnUsageFact | LocalVariableUsageFact) {
  const target = usage.targetName;
  const prop = usage.propName;
  if (usage.usageKind === "prop" && target) return `${target}.${prop ?? "prop"}`;
  if (usage.usageKind === "eventHandler" && target) return `${target}.${prop ?? "handler"}`;
  if (usage.usageKind === "conditionalRender") return target ? `controls render: ${target}` : "controls conditional render";
  if (usage.usageKind === "ternaryCondition") return target ? `chooses render: ${target}` : "chooses render";
  if (usage.usageKind === "hookArgument") return target ? `${target} argument` : "hook argument";
  if (usage.usageKind === "actionArgument") return target ? `${target} action argument` : "action argument";
  if (usage.usageKind === "functionArgument") return target ? `${target} argument` : "function argument";
  if (usage.usageKind === "renderedExpression") return "rendered expression";
  return usage.usageKind;
}

function uniqueSelectorBindings(bindings: SelectorBindingFact[]) {
  const byBinding = new Map<string, SelectorBindingFact>();
  for (const binding of bindings) {
    const key = `${binding.owner}\0${binding.localName}`;
    if (!byBinding.has(key)) byBinding.set(key, binding);
  }
  return [...byBinding.values()];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
