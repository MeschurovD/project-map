import {
  Node,
  SyntaxKind,
  type JsxElement,
  type JsxSelfClosingElement,
  type Node as TsNode,
  type SourceFile,
} from "ts-morph";
import type { JsxOccurrenceFact, Location } from "../../scanner/facts.js";
import { getLocation, isComponentName } from "../shared/ast.js";

type ComponentOwner = {
  name: string;
  node: TsNode;
};

export function collectJsxOccurrenceFacts(
  sourceFile: SourceFile,
  filePath: string,
  owner: ComponentOwner
): JsxOccurrenceFact[] {
  const facts: JsxOccurrenceFact[] = [];
  const returned = componentReturnExpressions(owner.node);

  returned.forEach((expression, returnIndex) => {
    visitPotentialJsx(expression, undefined, undefined, returnIndex, facts, sourceFile, filePath, owner.name);
  });

  return facts;
}

export function jsxOccurrenceId(
  filePath: string,
  ownerComponent: string,
  location: Location
): string {
  return `jsx:${encodeURIComponent(filePath)}#${encodeURIComponent(ownerComponent)}:${location.line}:${location.column}`;
}

function visitPotentialJsx(
  node: TsNode,
  parentOccurrenceId: string | undefined,
  slotName: string | undefined,
  returnIndex: number,
  facts: JsxOccurrenceFact[],
  sourceFile: SourceFile,
  filePath: string,
  ownerComponent: string
): void {
  const unwrapped = unwrapExpression(node);
  if (Node.isJsxElement(unwrapped)) {
    visitElement(
      unwrapped,
      parentOccurrenceId,
      slotName,
      returnIndex,
      facts,
      sourceFile,
      filePath,
      ownerComponent
    );
    return;
  }
  if (Node.isJsxSelfClosingElement(unwrapped)) {
    visitSelfClosing(
      unwrapped,
      parentOccurrenceId,
      slotName,
      returnIndex,
      facts,
      sourceFile,
      filePath,
      ownerComponent
    );
    return;
  }
  if (Node.isJsxFragment(unwrapped)) {
    const location = getLocation(sourceFile, unwrapped);
    const occurrenceId = jsxOccurrenceId(filePath, ownerComponent, location);
    facts.push({
      type: "jsxOccurrence",
      occurrenceId,
      ...(parentOccurrenceId ? { parentOccurrenceId } : {}),
      sourceFile: filePath,
      ownerComponent,
      kind: "fragment",
      tagName: "Fragment",
      ...(slotName ? { slotName } : {}),
      returnIndex,
      location,
      code: "<>…</>",
    });
    for (const child of unwrapped.getJsxChildren()) {
      visitPotentialJsx(
        child,
        occurrenceId,
        undefined,
        returnIndex,
        facts,
        sourceFile,
        filePath,
        ownerComponent
      );
    }
    return;
  }

  for (const child of unwrapped.getChildren()) {
    visitPotentialJsx(
      child,
      parentOccurrenceId,
      slotName,
      returnIndex,
      facts,
      sourceFile,
      filePath,
      ownerComponent
    );
  }
}

function visitElement(
  element: JsxElement,
  parentOccurrenceId: string | undefined,
  slotName: string | undefined,
  returnIndex: number,
  facts: JsxOccurrenceFact[],
  sourceFile: SourceFile,
  filePath: string,
  ownerComponent: string
): void {
  const opening = element.getOpeningElement();
  const occurrenceId = addTagOccurrence(
    opening,
    parentOccurrenceId,
    slotName,
    returnIndex,
    facts,
    sourceFile,
    filePath,
    ownerComponent
  );
  visitAttributeSlots(
    opening.getAttributes(),
    occurrenceId,
    returnIndex,
    facts,
    sourceFile,
    filePath,
    ownerComponent
  );
  for (const child of element.getJsxChildren()) {
    visitPotentialJsx(
      child,
      occurrenceId,
      undefined,
      returnIndex,
      facts,
      sourceFile,
      filePath,
      ownerComponent
    );
  }
}

function visitSelfClosing(
  element: JsxSelfClosingElement,
  parentOccurrenceId: string | undefined,
  slotName: string | undefined,
  returnIndex: number,
  facts: JsxOccurrenceFact[],
  sourceFile: SourceFile,
  filePath: string,
  ownerComponent: string
): void {
  const occurrenceId = addTagOccurrence(
    element,
    parentOccurrenceId,
    slotName,
    returnIndex,
    facts,
    sourceFile,
    filePath,
    ownerComponent
  );
  visitAttributeSlots(
    element.getAttributes(),
    occurrenceId,
    returnIndex,
    facts,
    sourceFile,
    filePath,
    ownerComponent
  );
}

function addTagOccurrence(
  element: TsNode & { getTagNameNode(): TsNode; getText(): string },
  parentOccurrenceId: string | undefined,
  slotName: string | undefined,
  returnIndex: number,
  facts: JsxOccurrenceFact[],
  sourceFile: SourceFile,
  filePath: string,
  ownerComponent: string
): string {
  const tagName = element.getTagNameNode().getText();
  const location = getLocation(sourceFile, element);
  const occurrenceId = jsxOccurrenceId(filePath, ownerComponent, location);
  const fragment = tagName === "Fragment" || tagName === "React.Fragment";
  facts.push({
    type: "jsxOccurrence",
    occurrenceId,
    ...(parentOccurrenceId ? { parentOccurrenceId } : {}),
    sourceFile: filePath,
    ownerComponent,
    kind: fragment ? "fragment" : isComponentName(tagName) ? "component" : "intrinsic",
    tagName: fragment ? "Fragment" : tagName,
    ...(slotName ? { slotName } : {}),
    returnIndex,
    location,
    code: compactCode(element.getText()),
  });
  return occurrenceId;
}

function visitAttributeSlots(
  attributes: Array<TsNode>,
  parentOccurrenceId: string,
  returnIndex: number,
  facts: JsxOccurrenceFact[],
  sourceFile: SourceFile,
  filePath: string,
  ownerComponent: string
): void {
  for (const attribute of attributes) {
    if (!Node.isJsxAttribute(attribute)) continue;
    const initializer = attribute.getInitializer();
    if (!initializer || !Node.isJsxExpression(initializer)) continue;
    const expression = initializer.getExpression();
    if (!expression) continue;
    visitPotentialJsx(
      expression,
      parentOccurrenceId,
      attribute.getNameNode().getText(),
      returnIndex,
      facts,
      sourceFile,
      filePath,
      ownerComponent
    );
  }
}

function componentReturnExpressions(owner: TsNode): TsNode[] {
  if (Node.isArrowFunction(owner)) {
    const body = owner.getBody();
    if (!Node.isBlock(body)) return [body];
  }

  return owner.getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => nearestFunctionLike(statement) === owner)
    .flatMap((statement) => statement.getExpression() ?? []);
}

function nearestFunctionLike(node: TsNode): TsNode | undefined {
  return node.getAncestors().find((ancestor) =>
    Node.isFunctionDeclaration(ancestor) ||
    Node.isFunctionExpression(ancestor) ||
    Node.isArrowFunction(ancestor) ||
    Node.isMethodDeclaration(ancestor)
  );
}

function unwrapExpression(node: TsNode): TsNode {
  if (Node.isParenthesizedExpression(node)) return unwrapExpression(node.getExpression());
  if (Node.isJsxExpression(node)) return node.getExpression() ? unwrapExpression(node.getExpression()!) : node;
  return node;
}

function compactCode(code: string): string {
  const compact = code.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}
