import { Node, SyntaxKind, type Node as TsNode, type SourceFile } from "ts-morph";
import type {
  ComponentFact,
  HookCallFact,
  HookFact,
  JsxUsageFact,
  ProjectFact,
  UnresolvedFact,
} from "../../scanner/facts.js";
import { toProjectRelative } from "../../utils/path.js";
import {
  getCallName,
  getLocation,
  hasJsx,
  isComponentName,
  isCustomHookName,
  isExportedName,
} from "../shared/ast.js";
import { collectJsxOccurrenceFacts } from "./jsxOccurrences.js";

type ComponentCandidate = {
  name: string;
  node: TsNode;
  declaration: ComponentFact["declaration"];
};

type HookCandidate = {
  name: string;
  node: TsNode;
};

export function analyzeReact(sourceFile: SourceFile, projectRoot: string): ProjectFact[] {
  const filePath = toProjectRelative(projectRoot, sourceFile.getFilePath());
  const facts: ProjectFact[] = [];
  const components = findComponentCandidates(sourceFile);
  const hooks = findHookCandidates(sourceFile);

  for (const component of components) {
    const fact: ComponentFact = {
      type: "component",
      name: component.name,
      file: filePath,
      exported: isExportedName(sourceFile, component.name),
      declaration: component.declaration,
      location: getLocation(sourceFile, component.node),
    };
    facts.push(fact);

    facts.push(...collectJsxUsages(sourceFile, filePath, component));
    facts.push(...collectJsxOccurrenceFacts(sourceFile, filePath, component));
    facts.push(...collectHookCalls(sourceFile, filePath, component.name, component.node));
  }

  for (const hook of hooks) {
    const fact: HookFact = {
      type: "hook",
      name: hook.name,
      file: filePath,
      exported: isExportedName(sourceFile, hook.name),
      location: getLocation(sourceFile, hook.node),
    };
    facts.push(fact);
    facts.push(...collectHookCalls(sourceFile, filePath, hook.name, hook.node));
  }

  return facts;
}

function findComponentCandidates(sourceFile: SourceFile): ComponentCandidate[] {
  const components: ComponentCandidate[] = [];

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name || !isComponentName(name) || !hasJsx(fn)) continue;
    components.push({ name, node: fn, declaration: "function" });
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getName();
    if (!isComponentName(name)) continue;

    const initializer = declaration.getInitializer();
    if (!initializer) continue;

    if (Node.isArrowFunction(initializer) && hasJsx(initializer)) {
      components.push({ name, node: initializer, declaration: "arrow" });
      continue;
    }

    if (!Node.isCallExpression(initializer)) continue;

    const callName = getCallName(initializer);
    const firstArg = initializer.getArguments()[0];
    if (
      (callName === "memo" || callName === "forwardRef") &&
      firstArg &&
      (Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg)) &&
      hasJsx(firstArg)
    ) {
      components.push({
        name,
        node: firstArg,
        declaration: callName,
      });
    }
  }

  return components;
}

function findHookCandidates(sourceFile: SourceFile): HookCandidate[] {
  const hooks: HookCandidate[] = [];

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name || !isCustomHookName(name)) continue;
    hooks.push({ name, node: fn });
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getName();
    if (!isCustomHookName(name)) continue;

    const initializer = declaration.getInitializer();
    if (!initializer || !Node.isArrowFunction(initializer)) continue;
    hooks.push({ name, node: initializer });
  }

  return hooks;
}

function collectJsxUsages(
  sourceFile: SourceFile,
  filePath: string,
  owner: ComponentCandidate
): Array<JsxUsageFact | UnresolvedFact> {
  const facts: Array<JsxUsageFact | UnresolvedFact> = [];
  const jsxNodes = [
    ...owner.node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...owner.node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const jsxNode of jsxNodes) {
    const tagName = jsxNode.getTagNameNode().getText();
    if (!isComponentName(tagName)) continue;

    const location = getLocation(sourceFile, jsxNode);
    const code = jsxNode.getText();

    facts.push({
      type: "jsxUsage",
      sourceFile: filePath,
      ownerComponent: owner.name,
      componentName: tagName,
      location,
      code,
    });

    if (tagName === "Component") {
      facts.push({
        type: "unresolvedJsxComponent",
        sourceFile: filePath,
        name: tagName,
        reason: "Potential dynamic component usage",
        location,
      });
    }
  }

  return facts;
}

function collectHookCalls(
  sourceFile: SourceFile,
  filePath: string,
  owner: string,
  node: TsNode
): HookCallFact[] {
  const facts: HookCallFact[] = [];

  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const hookName = getCallName(call);
    if (!hookName || !isCustomHookName(hookName)) continue;

    facts.push({
      type: "hookCall",
      sourceFile: filePath,
      owner,
      hookName,
      location: getLocation(sourceFile, call),
      code: call.getText(),
    });
  }

  return facts;
}
