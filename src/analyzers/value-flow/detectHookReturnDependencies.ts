import { Node, SyntaxKind, type Node as TsNode, type SourceFile } from "ts-morph";
import type { FlowTransformationKind, FlowValueSemantics } from "../../flow/types.js";
import { getCallName, getLocation, getOwnReturnedExpression, isCustomHookName } from "../shared/ast.js";
import {
  sourceLocation,
  type HookReturnBoundarySource,
  type HookReturnDependencyFact,
} from "./types.js";

// Pull "which return value comes from which internal read" out of a hook body.
// For each returned field we collect the locals its initializer references, then
// follow those locals' own initializers transitively. The leaves bound to
// selectors (selectorBinding owner = hook) are the field's data origin; the UI
// resolves that. Intra-function only.
//
// Confidence is graded per field by how the dependency was derived:
//   - high   — a direct local/property read or a directly returned boundary;
//   - medium — a transitive or multi-input expression whose complete set of
//              referenced locals is preserved as separate dependency edges.
// Branching alone is not low-confidence: `x ?? y`, a ternary, and a memo that
// reads two locals prove that every recorded local can affect the result. Low
// remains reserved for analyzers that must guess a missing identity or edge.
export function detectHookReturnDependencies(sourceFile: SourceFile, filePath: string): HookReturnDependencyFact[] {
  const facts: HookReturnDependencyFact[] = [];

  for (const fn of sourceFile.getFunctions()) {
    const hookName = fn.getName();
    if (hookName && isCustomHookName(hookName)) facts.push(...hookFacts(sourceFile, filePath, hookName, fn));
  }
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const hookName = declaration.getName();
    if (!isCustomHookName(hookName)) continue;
    const initializer = declaration.getInitializer();
    if (initializer && Node.isArrowFunction(initializer)) facts.push(...hookFacts(sourceFile, filePath, hookName, initializer));
  }

  return facts;
}

function hookFacts(sourceFile: SourceFile, filePath: string, hookName: string, fn: TsNode): HookReturnDependencyFact[] {
  const returned = getOwnReturnedExpression(fn);
  if (!returned || (
    !Node.isObjectLiteralExpression(returned) &&
    !Node.isArrayLiteralExpression(returned) &&
    !Node.isIdentifier(returned)
  )) return [];

  // Local dependency graph: each local const -> the local names its initializer
  // references. Parameters count as locals too (they can be data sources).
  const localDeps = new Map<string, Set<string>>();
  const locals = new Set<string>();
  const localBoundaries = new Map<string, HookReturnBoundarySource>();
  const localDeclarations = new Map<string, TsNode>();
  const nonBoundaryLocals = new Set<string>();
  if (Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    for (const param of fn.getParameters()) {
      for (const name of bindingNames(param.getNameNode())) {
        locals.add(name);
        localBoundaries.set(name, boundarySource(sourceFile, filePath, name, "parameter", param));
      }
    }
  }
  for (const declaration of fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (declaration.getFirstAncestor(isFunctionScope) !== fn) continue;
    const name = declaration.getNameNode();
    if (Node.isIdentifier(name)) {
      locals.add(name.getText());
      localDeclarations.set(name.getText(), declaration);
      localDeps.set(name.getText(), referencedNames(declaration.getInitializer()));
      const kind = localBoundaryKind(declaration.getInitializer());
      if (kind) {
        localBoundaries.set(name.getText(), boundarySource(sourceFile, filePath, name.getText(), kind, declaration));
      } else if (isCustomHookCall(declaration.getInitializer())) {
        nonBoundaryLocals.add(name.getText());
      }
      continue;
    }
    if (Node.isObjectBindingPattern(name) || Node.isArrayBindingPattern(name)) {
      const kind = localBoundaryKind(declaration.getInitializer());
      for (const element of name.getElements()) {
        if (!element || !Node.isBindingElement(element)) continue;
        const localNode = element.getNameNode();
        if (!Node.isIdentifier(localNode)) continue;
        locals.add(localNode.getText());
        localDeclarations.set(localNode.getText(), declaration);
        localDeps.set(localNode.getText(), new Set());
        if (kind) {
          localBoundaries.set(
            localNode.getText(),
            boundarySource(sourceFile, filePath, localNode.getText(), kind, declaration)
          );
        } else if (isCustomHookCall(declaration.getInitializer())) {
          nonBoundaryLocals.add(localNode.getText());
        }
      }
    }
  }

  const fields = returnedFields(returned);
  const nestedHookSources = hookSources(fn);
  const importedNames = importedLocalNames(sourceFile);
  const location = sourceLocation(filePath, getLocation(sourceFile, returned));
  return fields
    .map(({ field, seed, expression }) => {
      const discoveredDependencies = closure(seed, localDeps, locals);
      const boundarySources = collectBoundarySources({
        sourceFile,
        filePath,
        seed,
        expression,
        localDeps,
        locals,
        localBoundaries,
        localDeclarations,
        importedNames,
        nonBoundaryLocals,
      });
      const directReturnedLocal = expression && Node.isIdentifier(expression) ? expression.getText() : undefined;
      const returnsDirectBoundary = Boolean(
        directReturnedLocal && localBoundaries.has(directReturnedLocal)
      );
      // Returning a callback/state/parameter directly returns that value. The
      // locals captured inside a callback affect its behavior, not the origin
      // of the function object itself, so do not create false data origins.
      const dependsOn = returnsDirectBoundary ? [] : discoveredDependencies;
      const hookSources = boundarySources.length > 0
        ? []
        : dependsOn.flatMap((localName) => (nestedHookSources.get(localName) ?? []).filter((source) =>
          source.field !== "$return" || source.localName === directReturnedLocal
        ));
      return {
        type: "hookReturnDependency" as const,
        hookName,
        field,
        dependsOn,
        hookSources,
        boundarySources,
        valueSemantics: valueSemantics({
          sourceFile,
          filePath,
          expression,
          directReturnedLocal,
          dependsOn,
          boundarySources,
          localDeclarations,
          localDeps,
          locals,
        }),
        file: filePath,
        location,
        confidence: gradeConfidence(seed, dependsOn, boundarySources),
      };
    })
    .filter((fact) => fact.dependsOn.length > 0 || (fact.boundarySources?.length ?? 0) > 0);
}

function valueSemantics(input: {
  sourceFile: SourceFile;
  filePath: string;
  expression?: TsNode;
  directReturnedLocal?: string;
  dependsOn: string[];
  boundarySources: HookReturnBoundarySource[];
  localDeclarations: Map<string, TsNode>;
  localDeps: Map<string, Set<string>>;
  locals: Set<string>;
}): FlowValueSemantics {
  const resolved = resolveTransformationExpression(
    input.expression,
    input.directReturnedLocal,
    input.localDeclarations
  );
  const kind = transformationKind(resolved.expression, resolved.direct, input.boundarySources);
  const definition = kind === "constant"
    ? constantDefinition(input.expression, input.sourceFile, input.filePath)
    : undefined;
  const codeNode = definition?.code ?? resolved.code;
  const focusNode = definition?.focus ?? resolved.expression;
  const operation = transformationOperation(resolved.expression, kind);
  const inputPaths = transformationInputPaths(
    resolved.expression,
    input.locals
  );
  const type = input.expression ? displayType(input.expression) : undefined;
  const expression = resolved.expression?.getText();
  const code = codeNode?.getText();

  return {
    ...(type ? { type } : {}),
    transformation: {
      kind,
      inputPaths,
      ...(expression ? { expression } : {}),
      ...(code ? { code } : {}),
      ...(operation ? { operation } : {}),
      ...(codeNode ? {
        file: definition?.file ?? input.filePath,
        line: codeNode.getStartLineNumber(),
        endLine: codeNode.getEndLineNumber(),
        expressionLine: focusNode?.getStartLineNumber(),
      } : {}),
    },
  };
}

function constantDefinition(
  expression: TsNode | undefined,
  sourceFile: SourceFile,
  filePath: string
): { code: TsNode; focus: TsNode; file: string } | undefined {
  if (!expression) return undefined;
  const identifier = rootIdentifierNode(expression);
  let symbol = identifier?.getSymbol();
  for (let depth = 0; symbol && depth < 4; depth += 1) {
    const aliased = symbol.getAliasedSymbol();
    if (!aliased || aliased === symbol) break;
    symbol = aliased;
  }
  const declaration = symbol?.getDeclarations().find((entry) =>
    Node.isVariableDeclaration(entry) || Node.isEnumMember(entry)
  );
  if (!declaration) return undefined;

  const targetFile = projectRelativePeerPath(sourceFile, filePath, declaration.getSourceFile());
  if (!targetFile) return undefined;
  if (Node.isVariableDeclaration(declaration)) {
    return {
      code: declaration.getFirstAncestorByKind(SyntaxKind.VariableStatement) ?? declaration,
      focus: declaration.getInitializer() ?? declaration,
      file: targetFile,
    };
  }
  return { code: declaration, focus: declaration, file: targetFile };
}

function projectRelativePeerPath(
  sourceFile: SourceFile,
  filePath: string,
  targetFile: SourceFile
): string | undefined {
  const current = sourceFile.getFilePath().replace(/\\/g, "/");
  const target = targetFile.getFilePath().replace(/\\/g, "/");
  const suffix = `/${filePath.replace(/\\/g, "/")}`;
  if (!current.endsWith(suffix)) return undefined;
  const root = current.slice(0, -suffix.length);
  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : undefined;
}

function resolveTransformationExpression(
  expression: TsNode | undefined,
  directReturnedLocal: string | undefined,
  localDeclarations: Map<string, TsNode>
): { expression?: TsNode; code?: TsNode; direct: boolean } {
  if (!expression || !directReturnedLocal) {
    return { expression, code: expression, direct: Node.isIdentifier(expression) };
  }
  const declaration = localDeclarations.get(directReturnedLocal);
  const code = declaration && Node.isVariableDeclaration(declaration)
    ? declaration.getFirstAncestorByKind(SyntaxKind.VariableStatement) ?? declaration
    : expression;
  const initializer = declaration && Node.isVariableDeclaration(declaration)
    ? declaration.getInitializer()
    : undefined;
  if (!initializer) return { expression, code, direct: true };

  if (Node.isCallExpression(initializer)) {
    const callName = getCallName(initializer);
    if (callName === "useMemo") {
      const callback = initializer.getArguments()[0];
      if (callback && (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback))) {
        return { expression: getOwnReturnedExpression(callback) ?? callback, code, direct: false };
      }
    }
    if (callName && (
      isCustomHookName(callName) ||
      callName === "useSelector" ||
      callName === "useAppSelector"
    )) return { expression, code, direct: true };
  }

  return { expression: initializer, code, direct: false };
}

function transformationKind(
  expression: TsNode | undefined,
  direct: boolean,
  boundaries: HookReturnBoundarySource[]
): FlowTransformationKind {
  if (
    boundaries.length > 0 &&
    boundaries.every((source) => source.kind === "import" || source.kind === "literal")
  ) return "constant";
  if (!expression || direct || Node.isIdentifier(expression)) return "direct";
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) return "property-read";
  if (Node.isObjectLiteralExpression(expression)) return "object";
  if (Node.isArrayLiteralExpression(expression)) return "array";
  if (Node.isConditionalExpression(expression) || Node.isPrefixUnaryExpression(expression)) return "condition";
  if (Node.isBinaryExpression(expression)) {
    const operator = expression.getOperatorToken().getKind();
    if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) return "fallback";
    return "condition";
  }
  if (Node.isCallExpression(expression)) {
    const operation = transformationOperation(expression, "call");
    if (operation === "find" || operation === "filter" || operation === "map" || operation === "reduce") {
      return operation;
    }
    return "call";
  }
  return "expression";
}

function transformationOperation(
  expression: TsNode | undefined,
  kind: FlowTransformationKind
): string | undefined {
  if (!expression || !Node.isCallExpression(expression)) return undefined;
  const callee = expression.getExpression();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  const name = getCallName(expression);
  return name && kind === "call" ? name : undefined;
}

function transformationInputPaths(
  expression: TsNode | undefined,
  locals: Set<string>
): string[] {
  if (!expression) return [];
  const directNames = [...referencedNames(expression)].filter((name) => locals.has(name));
  return [...new Set(directNames.map((name) => longestReadPath(name, [expression]) ?? name))];
}

function longestReadPath(name: string, nodes: TsNode[]): string | undefined {
  const candidates: string[] = [];
  for (const node of nodes) {
    const accesses = [
      ...(Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node) ? [node] : []),
      ...node.getDescendants().filter((entry) =>
        Node.isPropertyAccessExpression(entry) || Node.isElementAccessExpression(entry)
      ),
    ];
    for (const access of accesses) {
      if (rootIdentifier(access) !== name) continue;
      const parent = access.getParent();
      const path = Node.isCallExpression(parent) && parent.getExpression() === access
        ? name
        : access.getText().replace(/\?\./g, ".");
      candidates.push(path);
    }
    if (
      (Node.isIdentifier(node) && node.getText() === name) ||
      node.getDescendantsOfKind(SyntaxKind.Identifier).some((entry) => entry.getText() === name)
    ) candidates.push(name);
  }
  return candidates.sort((left, right) => right.length - left.length)[0];
}

function displayType(node: TsNode): string | undefined {
  const text = node.getType().getText(node).replace(/import\("[^"]+"\)\./g, "");
  return text && text !== "unknown" ? text : undefined;
}

function hookSources(fn: TsNode) {
  const sources = new Map<string, HookReturnDependencyFact["hookSources"]>();

  for (const declaration of fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    if (!initializer || !Node.isCallExpression(initializer)) continue;
    const hookName = getCallName(initializer);
    if (!hookName || !isCustomHookName(hookName)) continue;
    if (["useAppDispatch", "useDispatch", "useAppSelector", "useSelector"].includes(hookName)) continue;

    const nameNode = declaration.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const localNode = element.getNameNode();
        if (!Node.isIdentifier(localNode)) continue;
        const localName = localNode.getText();
        const field = element.getPropertyNameNode()?.getText() ?? localName;
        sources.set(localName, [{ localName, hookName, field }]);
      }
      continue;
    }

    if (Node.isArrayBindingPattern(nameNode)) {
      nameNode.getElements().forEach((element, index) => {
        if (!element || !Node.isBindingElement(element)) return;
        const localNode = element.getNameNode();
        if (!Node.isIdentifier(localNode)) return;
        const localName = localNode.getText();
        sources.set(localName, [{ localName, hookName, field: String(index) }]);
      });
      continue;
    }

    if (Node.isIdentifier(nameNode)) {
      const localName = nameNode.getText();
      sources.set(localName, [{ localName, hookName, field: "$return" }]);
    }
  }

  return sources;
}

/**
 * Grade a field's dependency by the shape of its traversal (doc 21 §2).
 * Direct reads and direct boundaries are high. Transitive and multi-input
 * expressions are medium because we flatten their local dependency graph, but
 * every emitted branch is still backed by an identifier read in the AST.
 */
function gradeConfidence(
  seed: Set<string>,
  dependsOn: string[],
  boundarySources: HookReturnBoundarySource[]
): HookReturnDependencyFact["confidence"] {
  if (dependsOn.length === 0 && boundarySources.length > 0) return "high";
  return seed.size === 1 && dependsOn.length === 1 ? "high" : "medium";
}

function returnedFields(returned: TsNode): Array<{ field: string; seed: Set<string>; expression?: TsNode }> {
  if (Node.isObjectLiteralExpression(returned)) {
    return returned.getProperties().flatMap((property) => {
      if (Node.isShorthandPropertyAssignment(property)) {
        return [{ field: property.getName(), seed: new Set([property.getName()]), expression: property.getNameNode() }];
      }
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        const seed = referencedNames(initializer);
        return [{ field: property.getName(), seed, ...(initializer ? { expression: initializer } : {}) }];
      }
      return [];
    });
  }
  if (Node.isArrayLiteralExpression(returned)) {
    return returned.getElements().flatMap((element) =>
      Node.isIdentifier(element) ? [{ field: element.getText(), seed: new Set([element.getText()]), expression: element }] : []
    );
  }
  if (Node.isIdentifier(returned)) {
    return [{ field: "$return", seed: new Set([returned.getText()]), expression: returned }];
  }
  return [];
}

function collectBoundarySources(input: {
  sourceFile: SourceFile;
  filePath: string;
  seed: Set<string>;
  expression?: TsNode;
  localDeps: Map<string, Set<string>>;
  locals: Set<string>;
  localBoundaries: Map<string, HookReturnBoundarySource>;
  localDeclarations: Map<string, TsNode>;
  importedNames: Set<string>;
  nonBoundaryLocals: Set<string>;
}): HookReturnBoundarySource[] {
  const found = new Map<string, HookReturnBoundarySource>();
  const visited = new Set<string>();
  const queue = [...input.seed].filter((name) => input.locals.has(name));

  const directImportName = input.expression && !Node.isCallExpression(input.expression)
    ? rootIdentifier(input.expression)
    : undefined;
  if (directImportName && input.importedNames.has(directImportName)) {
    const name = directImportName;
    const declaration = input.sourceFile.getImportDeclarations().find((entry) => importLocalNames(entry).has(name));
    const source = boundarySource(input.sourceFile, input.filePath, name, "import", declaration ?? input.sourceFile);
    found.set(`${source.kind}:${source.name}`, source);
  }

  if (input.expression && (Node.isArrowFunction(input.expression) || Node.isFunctionExpression(input.expression))) {
    const source = boundarySource(
      input.sourceFile,
      input.filePath,
      "inline callback",
      "local-callback",
      input.expression
    );
    found.set(`${source.kind}:${source.name}`, source);
  }

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (visited.has(name)) continue;
    visited.add(name);

    const explicit = input.localBoundaries.get(name);
    if (explicit) {
      found.set(`${explicit.kind}:${explicit.name}`, explicit);
      continue;
    }
    if (input.nonBoundaryLocals.has(name)) continue;

    const localChildren = [...(input.localDeps.get(name) ?? [])].filter((dependency) => input.locals.has(dependency));
    if (localChildren.length === 0) {
      const source = boundarySource(
        input.sourceFile,
        input.filePath,
        name,
        "local-value",
        input.localDeclarations.get(name) ?? input.sourceFile
      );
      found.set(`${source.kind}:${source.name}`, source);
      continue;
    }
    queue.push(...localChildren);
  }

  if (input.seed.size === 0 && input.expression && !Node.isCallExpression(input.expression)) {
    const source = boundarySource(
      input.sourceFile,
      input.filePath,
      input.expression.getText(),
      "literal",
      input.expression
    );
    found.set(`${source.kind}:${source.name}`, source);
  }

  return [...found.values()];
}

function rootIdentifier(expression: TsNode): string | undefined {
  return rootIdentifierNode(expression)?.getText();
}

function rootIdentifierNode(expression: TsNode) {
  let current = expression;
  while (Node.isPropertyAccessExpression(current) || Node.isElementAccessExpression(current)) {
    current = current.getExpression();
  }
  return Node.isIdentifier(current) ? current : undefined;
}

function bindingNames(node: TsNode): string[] {
  if (Node.isIdentifier(node)) return [node.getText()];
  if (Node.isObjectBindingPattern(node) || Node.isArrayBindingPattern(node)) {
    return node.getElements().flatMap((element) => {
      if (!element || !Node.isBindingElement(element)) return [];
      return bindingNames(element.getNameNode());
    });
  }
  return [];
}

function localBoundaryKind(initializer: TsNode | undefined): HookReturnBoundarySource["kind"] | undefined {
  if (!initializer) return undefined;
  if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) return "local-callback";
  if (!Node.isCallExpression(initializer)) return undefined;
  const callName = getCallName(initializer);
  if (callName === "useCallback") return "local-callback";
  return callName === "useState" || callName === "useReducer" ? "local-state" : undefined;
}

function isCustomHookCall(initializer: TsNode | undefined) {
  if (!initializer || !Node.isCallExpression(initializer)) return false;
  const callName = getCallName(initializer);
  return Boolean(callName && isCustomHookName(callName));
}

function boundarySource(
  sourceFile: SourceFile,
  filePath: string,
  name: string,
  kind: HookReturnBoundarySource["kind"],
  node: TsNode
): HookReturnBoundarySource {
  return {
    name,
    kind,
    location: sourceLocation(filePath, getLocation(sourceFile, node)),
    code: Node.isSourceFile(node) ? undefined : node.getText(),
  };
}

function importedLocalNames(sourceFile: SourceFile) {
  const names = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    for (const name of importLocalNames(declaration)) names.add(name);
  }
  return names;
}

function importLocalNames(declaration: ReturnType<SourceFile["getImportDeclarations"]>[number]) {
  const names = new Set<string>();
  const defaultImport = declaration.getDefaultImport();
  const namespaceImport = declaration.getNamespaceImport();
  if (defaultImport) names.add(defaultImport.getText());
  if (namespaceImport) names.add(namespaceImport.getText());
  for (const specifier of declaration.getNamedImports()) {
    names.add(specifier.getAliasNode()?.getText() ?? specifier.getName());
  }
  return names;
}

function isFunctionScope(node: TsNode) {
  return Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node);
}

/** Transitively expand a seed of names through the local dependency graph. */
function closure(seed: Set<string>, localDeps: Map<string, Set<string>>, locals: Set<string>): string[] {
  const result = new Set<string>();
  const queue = [...seed].filter((name) => locals.has(name));
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (result.has(name)) continue;
    result.add(name);
    for (const dep of localDeps.get(name) ?? []) {
      if (locals.has(dep) && !result.has(dep)) queue.push(dep);
    }
  }
  return [...result];
}

/** Identifier names read in an expression, excluding property keys/accessors. */
function referencedNames(node: TsNode | undefined): Set<string> {
  const names = new Set<string>();
  if (!node) return names;
  // A bare identifier initializer (`{ z: b }`, `const b = a`) has no descendant
  // identifiers, so include the node itself when it is one.
  const ids = Node.isIdentifier(node) ? [node] : node.getDescendantsOfKind(SyntaxKind.Identifier);
  for (const id of ids) {
    const parent = id.getParent();
    if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) continue; // obj.foo -> skip foo
    if (Node.isPropertyAssignment(parent) && parent.getNameNode() === id) continue; // { foo: ... } -> skip key
    names.add(id.getText());
  }
  return names;
}
