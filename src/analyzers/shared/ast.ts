import { Node, SyntaxKind, type CallExpression, type Node as TsNode, type SourceFile } from "ts-morph";
import type { Location } from "../../scanner/facts.js";

export const BUILT_IN_HOOKS = new Set([
  "useState",
  "useReducer",
  "useEffect",
  "useLayoutEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useContext",
  "useDeferredValue",
  "useTransition",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useSyncExternalStore",
  "useOptimistic",
  "useActionState",
]);

export type NamedOwner = {
  name: string;
  node: TsNode;
};

export function isComponentName(name: string) {
  return /^[A-Z]/.test(name);
}

export function isHookName(name: string) {
  return /^use[A-Z0-9]/.test(name);
}

export function isCustomHookName(name: string) {
  return isHookName(name) && !BUILT_IN_HOOKS.has(name);
}

export function hasJsx(node: TsNode) {
  return (
    node.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
    node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0 ||
    node.getDescendantsOfKind(SyntaxKind.JsxFragment).length > 0
  );
}

export function getLocation(sourceFile: SourceFile, node: TsNode): Location {
  return sourceFile.getLineAndColumnAtPos(node.getStart());
}

export function getCallName(call: CallExpression): string | null {
  const expression = call.getExpression();

  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();

  return null;
}

export function getNearestOwner(call: CallExpression): string {
  let nearestNamedOwner: string | undefined;

  for (const ancestor of call.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor)) {
      const name = ancestor.getName();
      if (!name) continue;
      nearestNamedOwner ??= name;
      if (isHookName(name) || isComponentName(name)) return name;
      continue;
    }

    if (Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)) {
      const variable = ancestor.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      if (!variable) continue;
      const name = variable.getName();
      nearestNamedOwner ??= name;
      if (isHookName(name) || isComponentName(name)) return name;
    }
  }

  return nearestNamedOwner ?? "<module>";
}

export function isExportedName(sourceFile: SourceFile, name: string) {
  return sourceFile.getExportSymbols().some((symbol) => symbol.getName() === name);
}

export function collectNamedFunctionOwners(sourceFile: SourceFile): NamedOwner[] {
  const owners: NamedOwner[] = [];

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name) owners.push({ name, node: fn });
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;

    if (
      Node.isArrowFunction(initializer) ||
      Node.isFunctionExpression(initializer) ||
      Node.isCallExpression(initializer)
    ) {
      owners.push({ name: declaration.getName(), node: initializer });
    }
  }

  return owners;
}

/**
 * Return the first expression returned by this function itself. Returns inside
 * nested callbacks (for example a useMemo factory) belong to another function
 * scope and must not be mistaken for the custom hook's public return value.
 */
export function getOwnReturnedExpression(node: TsNode): TsNode | null {
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    if (!Node.isBlock(body)) return unwrapParentheses(body);
  }

  const statement = node.getDescendantsOfKind(SyntaxKind.ReturnStatement).find((candidate) =>
    candidate.getFirstAncestor(isFunctionScope) === node
  );
  const expression = statement?.getExpression();
  return expression ? unwrapParentheses(expression) : null;
}

function isFunctionScope(node: TsNode) {
  return Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node);
}

function unwrapParentheses(node: TsNode): TsNode {
  return Node.isParenthesizedExpression(node) ? unwrapParentheses(node.getExpression()) : node;
}
