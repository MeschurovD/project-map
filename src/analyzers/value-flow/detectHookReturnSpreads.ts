import { Node, SyntaxKind, type Node as TsNode, type SourceFile } from "ts-morph";
import { getCallName, getLocation, getOwnReturnedExpression, isCustomHookName } from "../shared/ast.js";
import { sourceLocation, type HookReturnSpreadFact } from "./types.js";

export function detectHookReturnSpreads(sourceFile: SourceFile, filePath: string): HookReturnSpreadFact[] {
  const facts: HookReturnSpreadFact[] = [];

  for (const fn of sourceFile.getFunctions()) {
    const hookName = fn.getName();
    if (hookName && isCustomHookName(hookName)) facts.push(...spreadFacts(sourceFile, filePath, hookName, fn));
  }
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const hookName = declaration.getName();
    const initializer = declaration.getInitializer();
    if (isCustomHookName(hookName) && initializer && Node.isArrowFunction(initializer)) {
      facts.push(...spreadFacts(sourceFile, filePath, hookName, initializer));
    }
  }

  return facts;
}

function spreadFacts(
  sourceFile: SourceFile,
  filePath: string,
  hookName: string,
  fn: TsNode
): HookReturnSpreadFact[] {
  const returned = getOwnReturnedExpression(fn);
  if (!returned || !Node.isObjectLiteralExpression(returned)) return [];

  const hookBindings = new Map<string, string>();
  for (const declaration of fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (declaration.getFirstAncestor(isFunctionScope) !== fn) continue;
    const name = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(name) || !initializer || !Node.isCallExpression(initializer)) continue;
    const sourceHookName = getCallName(initializer);
    if (sourceHookName && isCustomHookName(sourceHookName)) hookBindings.set(name.getText(), sourceHookName);
  }

  return returned.getProperties().flatMap((property) => {
    if (!Node.isSpreadAssignment(property)) return [];
    const expression = property.getExpression();
    if (!Node.isIdentifier(expression)) return [];
    const sourceHookName = hookBindings.get(expression.getText());
    if (!sourceHookName) return [];
    return [{
      type: "hookReturnSpread" as const,
      hookName,
      sourceLocalName: expression.getText(),
      sourceHookName,
      file: filePath,
      location: sourceLocation(filePath, getLocation(sourceFile, property)),
      code: property.getText(),
      confidence: "medium" as const,
    }];
  });
}

function isFunctionScope(node: TsNode) {
  return Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node);
}
