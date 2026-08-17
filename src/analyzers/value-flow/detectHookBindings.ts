import path from "node:path";
import { Node, SyntaxKind, type BindingElement, type CallExpression, type SourceFile } from "ts-morph";
import type { ResolvedProjectMapConfig } from "../../config/types.js";
import { ownerNodeId } from "../../utils/ownerNodeId.js";
import { getCallName, getLocation, getNearestOwner, isCustomHookName } from "../shared/ast.js";
import { sourceLocation, type HookBindingFact } from "./types.js";

export function detectHookBindings(
  sourceFile: SourceFile,
  filePath: string,
  config: ResolvedProjectMapConfig
): HookBindingFact[] {
  const facts: HookBindingFact[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const hookName = getCallName(call);
    if (!hookName || !isCustomHookName(hookName)) continue;
    if (config.redux.selectorHooks.includes(hookName) || config.redux.dispatchHooks.includes(hookName)) continue;

    const declaration = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (!declaration || declaration.getInitializer() !== call) continue;

    const owner = getNearestOwner(call);
    facts.push({
      type: "hookBinding",
      owner,
      ownerNodeId: ownerNodeId(owner, filePath),
      hookName,
      externalModule: externalHookModule(sourceFile, hookName, config.sourceRootAbs),
      arguments: call.getArguments().map((arg) => arg.getText()),
      boundTo: bindingFromCall(call),
      file: filePath,
      location: sourceLocation(filePath, getLocation(sourceFile, declaration)),
      code: declaration.getFirstAncestorByKind(SyntaxKind.VariableStatement)?.getText() ?? declaration.getText(),
      confidence: "high",
    });
  }

  return facts;
}

function externalHookModule(sourceFile: SourceFile, hookName: string, sourceRootAbs: string) {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const importsHook = declaration.getDefaultImport()?.getText() === hookName ||
      declaration.getNamespaceImport()?.getText() === hookName ||
      declaration.getNamedImports().some((specifier) =>
        (specifier.getAliasNode()?.getText() ?? specifier.getName()) === hookName
      );
    if (!importsHook) continue;

    const resolved = declaration.getModuleSpecifierSourceFile();
    if (!resolved) return undefined;
    const relative = path.relative(sourceRootAbs, resolved.getFilePath());
    const insideSourceRoot = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    return insideSourceRoot ? undefined : declaration.getModuleSpecifierValue();
  }
  return undefined;
}

function bindingFromCall(call: CallExpression): HookBindingFact["boundTo"] {
  const declaration = call.getFirstAncestorByKindOrThrow(SyntaxKind.VariableDeclaration);
  const nameNode = declaration.getNameNode();

  if (Node.isIdentifier(nameNode)) {
    return {
      kind: "identifier",
      name: nameNode.getText(),
    };
  }

  if (Node.isObjectBindingPattern(nameNode)) {
    return {
      kind: "objectDestructure",
      fields: nameNode.getElements().map(objectBindingField).filter((field): field is {
        sourceName: string;
        localName: string;
      } => Boolean(field)),
    };
  }

  if (Node.isArrayBindingPattern(nameNode)) {
    return {
      kind: "arrayDestructure",
      items: nameNode.getElements().flatMap((element, index) => {
        if (!element || !Node.isBindingElement(element)) return [];
        const localName = bindingLocalName(element);
        return localName ? [{ index, localName }] : [];
      }),
    };
  }

  return { kind: "none" };
}

function objectBindingField(element: BindingElement) {
  const propertyName = element.getPropertyNameNode()?.getText();
  const localName = bindingLocalName(element);
  if (!localName) return null;

  return {
    sourceName: propertyName ?? localName,
    localName,
  };
}

function bindingLocalName(element: BindingElement) {
  const nameNode = element.getNameNode();
  return Node.isIdentifier(nameNode) ? nameNode.getText() : null;
}
