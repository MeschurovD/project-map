import type { SourceFile } from "ts-morph";
import { detectVariableUsages } from "./detectLocalVariableUsages.js";
import type { HookBindingFact, HookReturnUsageFact } from "./types.js";

type HookLocal = {
  hookName: string;
  externalModule?: string;
  sourceField?: string;
  localName: string;
  owner: string;
  ownerNodeId?: string;
};

export function detectHookReturnUsages(
  sourceFile: SourceFile,
  filePath: string,
  bindings: HookBindingFact[]
): HookReturnUsageFact[] {
  const hookLocals = bindings.flatMap(localNamesFromHookBinding);
  const usageFacts = detectVariableUsages(sourceFile, filePath, hookLocals.map((entry) => ({
    owner: entry.owner,
    ownerNodeId: entry.ownerNodeId,
    variableName: entry.localName,
  })));

  return usageFacts.flatMap((usage): HookReturnUsageFact[] => {
    if (usage.usageKind === "ternaryCondition") return [];

    const hookLocal = hookLocals.find((entry) =>
      entry.owner === usage.owner &&
      entry.localName === usage.variableName
    );
    if (!hookLocal) return [];

    return [{
      type: "hookReturnUsage",
      owner: usage.owner,
      ownerNodeId: usage.ownerNodeId,
      hookName: hookLocal.hookName,
      externalModule: hookLocal.externalModule,
      localName: hookLocal.localName,
      sourceField: joinPropertyPath(hookLocal.sourceField, usage.propertyPath),
      usageKind: usage.usageKind,
      targetName: usage.targetName,
      targetNodeId: usage.targetNodeId,
      targetOccurrenceId: usage.targetOccurrenceId,
      propName: usage.propName,
      file: usage.file,
      location: usage.location,
      code: usage.code,
      confidence: usage.confidence,
    }];
  });
}

function joinPropertyPath(prefix: string | undefined, suffix: string | undefined): string | undefined {
  if (prefix && suffix) return `${prefix}.${suffix}`;
  return prefix ?? suffix;
}

function localNamesFromHookBinding(binding: HookBindingFact): HookLocal[] {
  if (binding.boundTo.kind === "identifier") {
    return [{
      hookName: binding.hookName,
      externalModule: binding.externalModule,
      localName: binding.boundTo.name,
      owner: binding.owner,
      ownerNodeId: binding.ownerNodeId,
    }];
  }

  if (binding.boundTo.kind === "objectDestructure") {
    return binding.boundTo.fields.map((field) => ({
      hookName: binding.hookName,
      externalModule: binding.externalModule,
      sourceField: field.sourceName,
      localName: field.localName,
      owner: binding.owner,
      ownerNodeId: binding.ownerNodeId,
    }));
  }

  if (binding.boundTo.kind === "arrayDestructure") {
    return binding.boundTo.items.map((item) => ({
      hookName: binding.hookName,
      externalModule: binding.externalModule,
      sourceField: String(item.index),
      localName: item.localName,
      owner: binding.owner,
      ownerNodeId: binding.ownerNodeId,
    }));
  }

  return [];
}
