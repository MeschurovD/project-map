import { Node, SyntaxKind, type Node as TsNode, type SourceFile } from "ts-morph";
import { getLocation, getOwnReturnedExpression, isCustomHookName } from "../shared/ast.js";
import { sourceLocation, type HookDeclarationShapeFact } from "./types.js";

export function detectHookDeclarationShape(sourceFile: SourceFile, filePath: string): HookDeclarationShapeFact[] {
  const facts: HookDeclarationShapeFact[] = [];

  for (const fn of sourceFile.getFunctions()) {
    const hookName = fn.getName();
    if (!hookName || !isCustomHookName(hookName)) continue;
    facts.push(hookShapeFact(sourceFile, filePath, hookName, fn));
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const hookName = declaration.getName();
    if (!isCustomHookName(hookName)) continue;

    const initializer = declaration.getInitializer();
    if (!initializer || !Node.isArrowFunction(initializer)) continue;
    facts.push(hookShapeFact(sourceFile, filePath, hookName, initializer));
  }

  return facts;
}

function hookShapeFact(
  sourceFile: SourceFile,
  filePath: string,
  hookName: string,
  node: TsNode
): HookDeclarationShapeFact {
  const params = (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node))
    ? node.getParameters().map((param) => param.getName())
    : [];

  return {
    type: "hookDeclarationShape",
    hookName,
    file: filePath,
    params,
    returnShape: returnShape(node),
    location: sourceLocation(filePath, getLocation(sourceFile, node)),
    confidence: "medium",
  };
}

function returnShape(node: TsNode): HookDeclarationShapeFact["returnShape"] {
  const returned = getOwnReturnedExpression(node);
  if (!returned) return { kind: "unknown" };

  if (Node.isObjectLiteralExpression(returned)) {
    return {
      kind: "object",
      fields: returned.getProperties().flatMap((property) => {
        if (Node.isShorthandPropertyAssignment(property)) return [property.getName()];
        if (Node.isPropertyAssignment(property) || Node.isMethodDeclaration(property)) return [property.getName()];
        return [];
      }),
    };
  }

  if (Node.isArrayLiteralExpression(returned)) {
    return {
      kind: "array",
      fields: returned.getElements().map((entry) => entry.getText()),
    };
  }

  if (Node.isIdentifier(returned)) {
    return {
      kind: "identifier",
      fields: [returned.getText()],
    };
  }

  return { kind: "unknown" };
}
