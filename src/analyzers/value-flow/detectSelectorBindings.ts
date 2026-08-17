import { Node, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph";
import type { ResolvedProjectMapConfig } from "../../config/types.js";
import { ownerNodeId } from "../../utils/ownerNodeId.js";
import { toProjectRelative } from "../../utils/path.js";
import { getCallName, getLocation, getNearestOwner } from "../shared/ast.js";
import { sourceLocation, type SelectorBindingFact } from "./types.js";

export function detectSelectorBindings(
  sourceFile: SourceFile,
  filePath: string,
  config: ResolvedProjectMapConfig
): SelectorBindingFact[] {
  const facts: SelectorBindingFact[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callName = getCallName(call);
    if (!callName || !config.redux.selectorHooks.includes(callName)) continue;

    const declaration = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (!declaration || declaration.getInitializer() !== call) continue;
    const selectorName = selectorNameFromCall(call);
    if (!selectorName) continue;

    const owner = getNearestOwner(call);
    for (const localName of bindingLocalNames(declaration.getNameNode())) {
      facts.push({
        type: "selectorBinding",
        owner,
        ownerNodeId: ownerNodeId(owner, filePath),
        selectorName: selectorName.name,
        selectorFile: selectorDefinitionFile(call, config.projectRoot),
        statePath: selectorName.statePath,
        localName,
        valueType: displayType(declaration.getNameNode()),
        file: filePath,
        location: sourceLocation(filePath, getLocation(sourceFile, declaration)),
        code: declaration.getFirstAncestorByKind(SyntaxKind.VariableStatement)?.getText() ?? declaration.getText(),
        confidence: selectorName.confidence,
      });
    }
  }

  return facts;
}

function displayType(node: Node): string | undefined {
  const text = node.getType().getText(node).replace(/import\("[^"]+"\)\./g, "");
  return text && text !== "unknown" ? text : undefined;
}

function bindingLocalNames(node: Node): string[] {
  if (Node.isIdentifier(node)) return [node.getText()];
  if (Node.isObjectBindingPattern(node) || Node.isArrayBindingPattern(node)) {
    return node.getElements().flatMap((element) => {
      if (!element || !Node.isBindingElement(element)) return [];
      return bindingLocalNames(element.getNameNode());
    });
  }
  return [];
}

function selectorDefinitionFile(call: CallExpression, projectRoot: string) {
  const selector = call.getArguments()[0];
  if (!selector || !Node.isIdentifier(selector)) return undefined;

  const files = [...new Set(selector.getDefinitions().map((definition) =>
    toProjectRelative(projectRoot, definition.getSourceFile().getFilePath())
  ))];
  return files.length === 1 ? files[0] : undefined;
}

function selectorNameFromCall(call: CallExpression): {
  name: string;
  statePath?: string;
  confidence: "high" | "medium";
} | null {
  const firstArg = call.getArguments()[0];
  if (!firstArg) return null;

  if (Node.isIdentifier(firstArg)) {
    return { name: firstArg.getText(), confidence: "high" };
  }

  if (Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg)) {
    const statePath = extractStatePath(firstArg);
    if (!statePath) return null;
    return {
      name: `inlineSelector:${statePath}`,
      statePath,
      confidence: "medium",
    };
  }

  return null;
}

function extractStatePath(fn: Node) {
  const firstParam = Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)
    ? fn.getParameters()[0]?.getName()
    : undefined;
  if (!firstParam) return null;

  const propertyAccesses = fn.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
  const matching = propertyAccesses
    .map((expr) => expr.getText())
    .filter((text) => text.startsWith(`${firstParam}.`))
    .sort((left, right) => right.length - left.length);

  const path = matching[0];
  return path ? `state.${path.slice(firstParam.length + 1)}` : null;
}
