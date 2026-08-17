import { Node, SyntaxKind, type JsxAttribute, type Node as TsNode, type SourceFile } from "ts-morph";
import { ownerNodeId } from "../../utils/ownerNodeId.js";
import { getCallName, getLocation } from "../shared/ast.js";
import { jsxOccurrenceId } from "../react/jsxOccurrences.js";
import {
  sourceLocation,
  type LocalVariableUsageFact,
  type LocalVariableUsageKind,
  type SelectorBindingFact,
} from "./types.js";

type VariableSource = {
  owner: string;
  ownerNodeId?: string;
  variableName: string;
};

export function detectLocalVariableUsages(
  sourceFile: SourceFile,
  filePath: string,
  bindings: SelectorBindingFact[]
): LocalVariableUsageFact[] {
  return detectVariableUsages(sourceFile, filePath, bindings.map((binding) => ({
    owner: binding.owner,
    ownerNodeId: binding.ownerNodeId,
    variableName: binding.localName,
  })));
}

export function detectVariableUsages(
  sourceFile: SourceFile,
  filePath: string,
  variables: VariableSource[]
): LocalVariableUsageFact[] {
  const facts: LocalVariableUsageFact[] = [];
  const seen = new Set<string>();

  for (const variable of variables) {
    const ownerNode = findOwnerNode(sourceFile, variable.owner);
    if (!ownerNode) continue;

    const candidates = [
      ...detectConditionalRenders(sourceFile, filePath, ownerNode, variable),
      ...detectGuardClauseRenders(sourceFile, filePath, ownerNode, variable),
      ...detectTernaryConditions(sourceFile, filePath, ownerNode, variable),
      ...detectJsxPropUsages(sourceFile, filePath, ownerNode, variable),
      ...detectCallArgumentUsages(sourceFile, filePath, ownerNode, variable),
      ...detectRenderedExpressions(sourceFile, filePath, ownerNode, variable),
    ];

    for (const fact of candidates) {
      const key = [
        fact.owner,
        fact.variableName,
        fact.usageKind,
        fact.targetName ?? "",
        fact.propName ?? "",
        fact.location?.line ?? "",
        fact.code ?? "",
      ].join("\0");
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push(fact);
    }
  }

  return facts;
}

function detectGuardClauseRenders(
  sourceFile: SourceFile,
  filePath: string,
  ownerNode: TsNode,
  variable: VariableSource
): LocalVariableUsageFact[] {
  const facts: LocalVariableUsageFact[] = [];

  for (const statement of ownerNode.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    if (!containsIdentifier(statement.getExpression(), variable.variableName)) continue;
    const branches: TsNode[] = [statement.getThenStatement()];
    const elseBranch = statement.getElseStatement();
    if (elseBranch) branches.push(elseBranch);
    const returns = branches.flatMap((branch) => [
      ...(Node.isReturnStatement(branch) ? [branch] : []),
      ...branch.getDescendantsOfKind(SyntaxKind.ReturnStatement),
    ]);
    if (!returns.some((entry) => returnBelongsToOwner(entry, ownerNode))) continue;

    facts.push(localUsageFact(
      sourceFile,
      filePath,
      variable,
      statement,
      "conditionalRender",
      "high",
      {
        propertyPath: propertyPathIn(statement.getExpression(), variable.variableName),
      }
    ));
  }

  return facts;
}

function detectConditionalRenders(
  sourceFile: SourceFile,
  filePath: string,
  ownerNode: TsNode,
  variable: VariableSource
): LocalVariableUsageFact[] {
  const facts: LocalVariableUsageFact[] = [];

  for (const expression of ownerNode.getDescendantsOfKind(SyntaxKind.JsxExpression)) {
    const inner = expression.getExpression();
    if (!inner || !Node.isBinaryExpression(inner)) continue;
    if (inner.getOperatorToken().getText() !== "&&") continue;
    if (!containsIdentifier(inner.getLeft(), variable.variableName)) continue;

    const targetName = jsxTargetName(inner.getRight());
    facts.push(localUsageFact(sourceFile, filePath, variable, expression, "conditionalRender", "high", {
      targetName,
      targetNodeId: targetName ? componentTargetNodeId(targetName) : undefined,
      propertyPath: propertyPathIn(inner.getLeft(), variable.variableName),
    }));
  }

  return facts;
}

function detectTernaryConditions(
  sourceFile: SourceFile,
  filePath: string,
  ownerNode: TsNode,
  variable: VariableSource
): LocalVariableUsageFact[] {
  const facts: LocalVariableUsageFact[] = [];

  for (const expression of ownerNode.getDescendantsOfKind(SyntaxKind.ConditionalExpression)) {
    if (!containsIdentifier(expression.getCondition(), variable.variableName)) continue;

    const targets = [
      jsxTargetName(expression.getWhenTrue()),
      jsxTargetName(expression.getWhenFalse()),
    ].filter(Boolean);

    facts.push(localUsageFact(sourceFile, filePath, variable, expression, "ternaryCondition", "medium", {
      targetName: targets.join(" / ") || undefined,
      propertyPath: propertyPathIn(expression.getCondition(), variable.variableName),
    }));
  }

  return facts;
}

function detectJsxPropUsages(
  sourceFile: SourceFile,
  filePath: string,
  ownerNode: TsNode,
  variable: VariableSource
): LocalVariableUsageFact[] {
  const facts: LocalVariableUsageFact[] = [];

  for (const attribute of ownerNode.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const initializer = attribute.getInitializer();
    if (!initializer || !containsIdentifier(initializer, variable.variableName)) continue;

    const propName = attribute.getNameNode().getText();
    const targetName = jsxAttributeTargetName(attribute);
    const targetOccurrenceId = jsxAttributeOccurrenceId(
      sourceFile,
      filePath,
      variable.owner,
      attribute
    );
    const usageKind: LocalVariableUsageKind = /^on[A-Z]/.test(propName) ? "eventHandler" : "prop";
    facts.push(localUsageFact(sourceFile, filePath, variable, attribute, usageKind, "high", {
      targetName,
      targetNodeId: targetName ? componentTargetNodeId(targetName) : undefined,
      targetOccurrenceId,
      propName,
      propertyPath: propertyPathIn(initializer, variable.variableName),
    }));
  }

  return facts;
}

function detectCallArgumentUsages(
  sourceFile: SourceFile,
  filePath: string,
  ownerNode: TsNode,
  variable: VariableSource
): LocalVariableUsageFact[] {
  const facts: LocalVariableUsageFact[] = [];

  for (const call of ownerNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callName = getCallName(call);
    if (!callName) continue;

    if (isDispatchCall(callName)) {
      const actionCall = call.getArguments().find((arg) => Node.isCallExpression(arg));
      if (actionCall && Node.isCallExpression(actionCall) && containsIdentifier(actionCall, variable.variableName)) {
        facts.push(localUsageFact(sourceFile, filePath, variable, call, "actionArgument", "high", {
          targetName: getCallName(actionCall) ?? actionCall.getExpression().getText(),
          propertyPath: propertyPathIn(actionCall, variable.variableName),
        }));
      }
      continue;
    }

    if (!call.getArguments().some((arg) => containsIdentifier(arg, variable.variableName))) continue;

    facts.push(localUsageFact(
      sourceFile,
      filePath,
      variable,
      call,
      /^use[A-Z0-9]/.test(callName) ? "hookArgument" : "functionArgument",
      /^use[A-Z0-9]/.test(callName) ? "high" : "medium",
      {
        targetName: callName,
        propertyPath: propertyPathIn(call, variable.variableName),
      }
    ));
  }

  return facts;
}

function detectRenderedExpressions(
  sourceFile: SourceFile,
  filePath: string,
  ownerNode: TsNode,
  variable: VariableSource
): LocalVariableUsageFact[] {
  const facts: LocalVariableUsageFact[] = [];

  for (const expression of ownerNode.getDescendantsOfKind(SyntaxKind.JsxExpression)) {
    const inner = expression.getExpression();
    if (!inner || !Node.isIdentifier(inner) || inner.getText() !== variable.variableName) continue;
    if (Node.isJsxAttribute(expression.getParent())) continue;

    facts.push(localUsageFact(sourceFile, filePath, variable, expression, "renderedExpression", "medium", {
      propertyPath: undefined,
    }));
  }

  return facts;
}

function localUsageFact(
  sourceFile: SourceFile,
  filePath: string,
  variable: VariableSource,
  node: TsNode,
  usageKind: LocalVariableUsageKind,
  confidence: "high" | "medium" | "low",
  extra: Pick<
    LocalVariableUsageFact,
    "targetName" | "targetNodeId" | "targetOccurrenceId" | "propName" | "propertyPath"
  >
): LocalVariableUsageFact {
  return {
    type: "localVariableUsage",
    owner: variable.owner,
    ownerNodeId: variable.ownerNodeId ?? ownerNodeId(variable.owner, filePath),
    variableName: variable.variableName,
    usageKind,
    ...extra,
    file: filePath,
    location: sourceLocation(filePath, getLocation(sourceFile, node)),
    code: evidenceText(node),
    confidence,
  };
}

function propertyPathIn(node: TsNode, variableName: string): string | undefined {
  const identifiers = [
    ...(Node.isIdentifier(node) ? [node] : []),
    ...node.getDescendantsOfKind(SyntaxKind.Identifier),
  ];

  for (const identifier of identifiers) {
    if (identifier.getText() !== variableName || !isReferenceIdentifier(identifier)) continue;

    const parts: string[] = [];
    let current: TsNode = identifier;
    while (true) {
      const parent = current.getParent();
      if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === current) {
        parts.push(parent.getName());
        current = parent;
        continue;
      }
      if (Node.isElementAccessExpression(parent) && parent.getExpression() === current) {
        const argument = parent.getArgumentExpression();
        if (!argument) break;
        parts.push(argument.getText().replace(/^['"]|['"]$/g, ""));
        current = parent;
        continue;
      }
      break;
    }
    return parts.length > 0 ? parts.join(".") : undefined;
  }

  return undefined;
}

function findOwnerNode(sourceFile: SourceFile, owner: string): TsNode | null {
  for (const fn of sourceFile.getFunctions()) {
    if (fn.getName() === owner) return fn;
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    if (declaration.getName() !== owner) continue;

    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    if (Node.isCallExpression(initializer)) {
      const firstArg = initializer.getArguments()[0];
      if (firstArg && (Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg))) return firstArg;
    }
    return initializer;
  }

  return null;
}

function containsIdentifier(node: TsNode, identifier: string) {
  if (Node.isIdentifier(node) && isReferenceIdentifier(node) && node.getText() === identifier) return true;
  return node.getDescendantsOfKind(SyntaxKind.Identifier).some((entry) =>
    isReferenceIdentifier(entry) &&
    entry.getText() === identifier
  );
}

function returnBelongsToOwner(node: TsNode, ownerNode: TsNode): boolean {
  let current = node.getParent();
  while (current && current !== ownerNode) {
    if (
      Node.isArrowFunction(current) ||
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isMethodDeclaration(current)
    ) return false;
    current = current.getParent();
  }
  return current === ownerNode;
}

function isReferenceIdentifier(identifier: TsNode) {
  if (!Node.isIdentifier(identifier)) return false;

  const parent = identifier.getParent();
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) {
    return false;
  }
  if ((Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent)) && parent.getTagNameNode() === identifier) {
    return false;
  }

  return true;
}

function jsxTargetName(node: TsNode) {
  if (Node.isJsxSelfClosingElement(node)) return node.getTagNameNode().getText();
  if (Node.isJsxElement(node)) return node.getOpeningElement().getTagNameNode().getText();
  if (Node.isParenthesizedExpression(node)) return jsxTargetName(node.getExpression());
  return undefined;
}

function jsxAttributeTargetName(attribute: JsxAttribute) {
  const parent = attribute.getFirstAncestor((ancestor) =>
    Node.isJsxOpeningElement(ancestor) || Node.isJsxSelfClosingElement(ancestor)
  );
  return parent && (Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent))
    ? parent.getTagNameNode().getText()
    : undefined;
}

function jsxAttributeOccurrenceId(
  sourceFile: SourceFile,
  filePath: string,
  owner: string,
  attribute: JsxAttribute
) {
  const parent = attribute.getFirstAncestor((ancestor) =>
    Node.isJsxOpeningElement(ancestor) || Node.isJsxSelfClosingElement(ancestor)
  );
  return parent && (Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent))
    ? jsxOccurrenceId(filePath, owner, getLocation(sourceFile, parent))
    : undefined;
}

function evidenceText(node: TsNode) {
  if (Node.isJsxAttribute(node)) {
    const parent = node.getFirstAncestor((ancestor) =>
      Node.isJsxOpeningElement(ancestor) || Node.isJsxSelfClosingElement(ancestor)
    );
    if (parent) return parent.getText();
  }
  return node.getText();
}

function componentTargetNodeId(componentName: string) {
  return `component:unknown:${componentName}`;
}

function isDispatchCall(callName: string) {
  return callName === "dispatch" || callName.endsWith("Dispatch");
}
