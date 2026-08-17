import type { SourceFile } from "ts-morph";
import type { ResolvedProjectMapConfig } from "../../config/types.js";
import { toProjectRelative } from "../../utils/path.js";
import { detectHookBindings } from "./detectHookBindings.js";
import { detectHookDeclarationShape } from "./detectHookDeclarationShape.js";
import { detectHookReturnDependencies } from "./detectHookReturnDependencies.js";
import { detectHookReturnSpreads } from "./detectHookReturnSpreads.js";
import { detectHookReturnUsages } from "./detectHookReturnUsages.js";
import { detectLocalVariableUsages } from "./detectLocalVariableUsages.js";
import { detectSelectorBindings } from "./detectSelectorBindings.js";
import { detectSelectorStateReads } from "./detectSelectorStateReads.js";
import type { ValueFlowFact } from "./types.js";

export function analyzeValueFlow(
  sourceFile: SourceFile,
  projectRoot: string,
  config: ResolvedProjectMapConfig
): ValueFlowFact[] {
  const filePath = toProjectRelative(projectRoot, sourceFile.getFilePath());
  const selectorBindings = detectSelectorBindings(sourceFile, filePath, config);
  const hookBindings = detectHookBindings(sourceFile, filePath, config);

  return [
    ...detectSelectorStateReads(sourceFile, filePath),
    ...selectorBindings,
    ...detectLocalVariableUsages(sourceFile, filePath, selectorBindings),
    ...hookBindings,
    ...detectHookReturnUsages(sourceFile, filePath, hookBindings),
    ...detectHookDeclarationShape(sourceFile, filePath),
    ...detectHookReturnSpreads(sourceFile, filePath),
    ...detectHookReturnDependencies(sourceFile, filePath),
  ];
}
