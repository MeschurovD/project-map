import { Node, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph";
import type { ResolvedProjectMapConfig } from "../../config/types.js";
import type {
  DispatchCallFact,
  InlineSelectorUsageFact,
  ProjectFact,
  ReduxActionFact,
  ReduxSliceFact,
  ReduxThunkFact,
  RtkQueryHookCallFact,
  SelectorUsageFact,
  SliceWriteFact,
  ThunkApiCall,
} from "../../scanner/facts.js";
import { toProjectRelative } from "../../utils/path.js";
import { getCallName, getLocation, getNearestOwner } from "../shared/ast.js";

export function analyzeRedux(
  sourceFile: SourceFile,
  projectRoot: string,
  config: ResolvedProjectMapConfig
): ProjectFact[] {
  const filePath = toProjectRelative(projectRoot, sourceFile.getFilePath());
  const facts: ProjectFact[] = [];
  const dispatchVariables = collectDispatchVariables(sourceFile, config);

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callName = getCallName(call);

    if (isDispatchInvocation(call, dispatchVariables, config)) {
      const dispatchFact = collectDispatchCall(sourceFile, filePath, call);
      if (dispatchFact) facts.push(dispatchFact);
      continue;
    }

    if (!callName) continue;

    if (config.redux.selectorHooks.includes(callName)) {
      facts.push(...collectSelectorUsage(sourceFile, filePath, callName, call));
      continue;
    }

    if (isRtkQueryHookName(callName)) {
      const fact: RtkQueryHookCallFact = {
        type: "rtkQueryHookCall",
        sourceFile: filePath,
        owner: getNearestOwner(call),
        hookName: callName,
        location: getLocation(sourceFile, call),
        code: call.getText(),
      };
      facts.push(fact);
      continue;
    }

    if (callName === "createSlice") {
      facts.push(...collectCreateSliceFacts(sourceFile, filePath, call));
      continue;
    }

    if (callName === "createAsyncThunk") {
      const thunkFact = collectThunkFact(sourceFile, filePath, call);
      if (thunkFact) facts.push(thunkFact);
    }
  }

  return facts;
}

function collectDispatchVariables(sourceFile: SourceFile, config: ResolvedProjectMapConfig) {
  const variables = new Set<string>();

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    if (!initializer || !Node.isCallExpression(initializer)) continue;

    const callName = getCallName(initializer);
    if (callName && config.redux.dispatchHooks.includes(callName)) {
      variables.add(declaration.getName());
    }
  }

  return variables;
}

function isDispatchInvocation(
  call: CallExpression,
  dispatchVariables: ReadonlySet<string>,
  config: ResolvedProjectMapConfig
): boolean {
  const expression = call.getExpression();
  if (dispatchVariables.has(expression.getText())) return true;

  // Covers thunk/listener parameters (`dispatch(action())`) and the common
  // store form (`appStore.dispatch(action())`). The first argument still has
  // to be an action call, so unrelated zero/value dispatch helpers are ignored
  // by collectDispatchCall below.
  if (Node.isIdentifier(expression) && expression.getText() === "dispatch") return true;
  if (Node.isPropertyAccessExpression(expression) && expression.getName() === "dispatch") return true;

  // Inline form: useAppDispatch()(loadData()).
  if (Node.isCallExpression(expression)) {
    const hookName = getCallName(expression);
    return Boolean(hookName && config.redux.dispatchHooks.includes(hookName));
  }

  return false;
}

function collectSelectorUsage(
  sourceFile: SourceFile,
  filePath: string,
  selectorHook: string,
  call: CallExpression
): Array<SelectorUsageFact | InlineSelectorUsageFact> {
  const firstArg = call.getArguments()[0];
  if (!firstArg) return [];

  const base = {
    sourceFile: filePath,
    owner: getNearestOwner(call),
    selectorHook,
    location: getLocation(sourceFile, call),
    code: call.getText(),
  };

  if (Node.isIdentifier(firstArg)) {
    return [
      {
        type: "selectorUsage",
        ...base,
        selectorName: firstArg.getText(),
      },
    ];
  }

  if (Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg)) {
    const statePath = extractStatePath(firstArg);
    if (!statePath) return [];

    return [
      {
        type: "inlineSelectorUsage",
        ...base,
        statePath,
        sliceName: statePath.split(".")[1] ?? null,
      },
    ];
  }

  return [];
}

function collectDispatchCall(
  sourceFile: SourceFile,
  filePath: string,
  call: CallExpression
): DispatchCallFact | null {
  const actionCall = call.getArguments()[0];
  if (!actionCall || !Node.isCallExpression(actionCall)) return null;

  return {
    type: "dispatchCall",
    sourceFile: filePath,
    owner: getNearestOwner(call),
    actionName: actionCall.getExpression().getText(),
    location: getLocation(sourceFile, call),
    code: call.getText(),
  };
}

function collectCreateSliceFacts(
  sourceFile: SourceFile,
  filePath: string,
  call: CallExpression
): Array<ReduxSliceFact | ReduxActionFact | SliceWriteFact> {
  const firstArg = call.getArguments()[0];
  if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) return [];

  const sliceNameProperty = firstArg.getProperty("name");
  const sliceName =
    sliceNameProperty && Node.isPropertyAssignment(sliceNameProperty)
      ? trimQuotes(sliceNameProperty.getInitializer()?.getText() ?? "")
      : null;
  if (!sliceName) return [];

  const variableName = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getName() ?? null;
  const location = getLocation(sourceFile, call);
  const facts: Array<ReduxSliceFact | ReduxActionFact> = [
    {
      type: "reduxSlice",
      name: sliceName,
      variableName,
      file: filePath,
      location,
    },
  ];

  const writes = collectExtraReducerWrites(sourceFile, filePath, sliceName, firstArg);

  const reducersProperty = firstArg.getProperty("reducers");
  if (!reducersProperty || !Node.isPropertyAssignment(reducersProperty)) return [...facts, ...writes];

  const reducers = reducersProperty.getInitializer();
  if (!reducers || !Node.isObjectLiteralExpression(reducers)) return [...facts, ...writes];

  for (const property of reducers.getProperties()) {
    const name = Node.isPropertyAssignment(property) || Node.isMethodDeclaration(property)
      ? property.getName()
      : null;
    if (!name) continue;

    const reducer = Node.isPropertyAssignment(property) ? property.getInitializer() : property;
    const writes = reducerWrites(sourceFile, reducer);
    facts.push({
      type: "reduxAction",
      name,
      sliceName,
      file: filePath,
      location: getLocation(sourceFile, property),
      ...(writes.length > 0 ? { writes } : {}),
    });
  }

  return [...facts, ...writes];
}

function collectThunkFact(
  sourceFile: SourceFile,
  filePath: string,
  call: CallExpression
): ReduxThunkFact | null {
  const name = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getName() ?? null;
  if (!name) return null;

  const firstArg = call.getArguments()[0];
  const typePrefix = firstArg && (Node.isStringLiteral(firstArg) || Node.isNoSubstitutionTemplateLiteral(firstArg))
    ? firstArg.getLiteralText()
    : null;

  const apiCalls = collectThunkApiCalls(sourceFile, call.getArguments()[1]);

  return {
    type: "reduxThunk",
    name,
    typePrefix,
    ...(apiCalls.length > 0 ? { apiCalls } : {}),
    file: filePath,
    location: getLocation(sourceFile, call),
  };
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "request"]);

// Heuristic thunk → API link: scan the payload creator for HTTP calls — a bare
// `fetch("/url")` or a client method `<api>.get("/url")` carrying a URL-like
// string. Dynamic URLs (no string argument) are intentionally not matched.
function collectThunkApiCalls(sourceFile: SourceFile, creator: Node | undefined): ThunkApiCall[] {
  if (!creator || (!Node.isArrowFunction(creator) && !Node.isFunctionExpression(creator))) return [];

  const detected: Array<{ call: CallExpression; api: Omit<ThunkApiCall, "line"> }> = [];
  const seen = new Set<string>();
  const apiRoots = collectApiImportNames(sourceFile);
  for (const root of collectThunkContextApiNames(creator)) apiRoots.add(root);

  for (const call of creator.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const api = extractApiCall(call, apiRoots);
    if (!api) continue;
    detected.push({ call, api });
  }

  const calls: ThunkApiCall[] = [];
  for (const entry of detected) {
    // withRequestGuard(() => serviceClient.*()) and equivalent wrappers are control
    // boundaries, not endpoints. Once a nested API call is known, keep the
    // inner service and hide the outer callback wrapper.
    const wrapsDetectedCall = entry.api.kind === "service" && detected.some((candidate) =>
      candidate !== entry && candidate.call.getAncestors().includes(entry.call)
    );
    if (wrapsDetectedCall) continue;

    const api = entry.api;
    const key = `${api.method} ${api.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const evidenceNode = apiEvidenceNode(entry.call, creator);
    calls.push({
      ...api,
      code: evidenceNode.getText(),
      codeStartLine: getLocation(sourceFile, evidenceNode).line,
      line: getLocation(sourceFile, entry.call).line,
    });
  }
  return calls;
}

/**
 * An API call alone rarely explains what the thunk does with its result.
 * Keep the nearest complete statement so evidence includes assignment,
 * Promise.all siblings, guards and return handling without exposing the
 * entire thunk or source file.
 */
function apiEvidenceNode(call: CallExpression, creator: Node): Node {
  for (const ancestor of call.getAncestors()) {
    if (ancestor === creator) break;
    if (
      Node.isVariableStatement(ancestor) ||
      Node.isReturnStatement(ancestor) ||
      Node.isExpressionStatement(ancestor) ||
      Node.isThrowStatement(ancestor)
    ) {
      return ancestor;
    }
  }

  if (Node.isArrowFunction(creator)) {
    const body = creator.getBody();
    if (!Node.isBlock(body) && (body === call || call.getAncestors().includes(body))) return body;
  }

  return call;
}

function collectThunkContextApiNames(creator: Node): Set<string> {
  const names = new Set<string>();
  if (!Node.isArrowFunction(creator) && !Node.isFunctionExpression(creator)) return names;

  const context = creator.getParameters()[1]?.getNameNode();
  if (!context) return names;
  for (const identifier of [
    ...(Node.isIdentifier(context) ? [context] : []),
    ...context.getDescendantsOfKind(SyntaxKind.Identifier),
  ]) {
    const name = identifier.getText();
    if (/(api|client|fetcher|service)$/i.test(name)) names.add(name);
  }
  return names;
}

function extractApiCall(
  call: CallExpression,
  apiImports: ReadonlySet<string>
): Omit<ThunkApiCall, "line"> | null {
  const expression = call.getExpression();
  const url = urlLiteral(call.getArguments()[0]);

  if (url && Node.isIdentifier(expression) && expression.getText() === "fetch") {
    return { kind: "http", method: fetchMethod(call.getArguments()[1]) ?? "GET", url, code: snippet(call) };
  }
  if (url && Node.isPropertyAccessExpression(expression)) {
    const method = expression.getName().toLowerCase();
    if (HTTP_METHODS.has(method)) {
      return { kind: "http", method: method.toUpperCase(), url, code: snippet(call) };
    }
  }

  const importedRoot = callRootIdentifier(expression);
  if (importedRoot && apiImports.has(importedRoot)) {
    return {
      kind: "service",
      method: "CALL",
      url: expression.getText(),
      code: snippet(call),
    };
  }
  return null;
}

function collectApiImportNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const moduleName = declaration.getModuleSpecifierValue().toLowerCase();
    if (!/(^|[\/_-])(api|apis|service|services|client|gateway|repository)([\/_-]|$)/.test(moduleName)) continue;

    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) names.add(defaultImport.getText());
    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) names.add(namespaceImport.getText());
    for (const namedImport of declaration.getNamedImports()) {
      names.add(namedImport.getAliasNode()?.getText() ?? namedImport.getName());
    }
  }
  return names;
}

function callRootIdentifier(expression: Node): string | null {
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) return callRootIdentifier(expression.getExpression());
  return null;
}

function urlLiteral(node: Node | undefined): string | null {
  if (!node) return null;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    const text = node.getLiteralText();
    return text.includes("/") ? text : null;
  }
  if (Node.isTemplateExpression(node)) {
    const text = node.getText().replace(/^`|`$/g, "");
    return text.includes("/") ? text : null;
  }
  return null;
}

function fetchMethod(options: Node | undefined): string | null {
  if (!options || !Node.isObjectLiteralExpression(options)) return null;
  const method = options.getProperty("method");
  if (!method || !Node.isPropertyAssignment(method)) return null;
  const value = method.getInitializer();
  if (value && (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value))) {
    return value.getLiteralText().toUpperCase();
  }
  return null;
}

function snippet(call: CallExpression): string {
  return call.getText();
}

// extraReducers describe who writes the slice from the outside: builder
// callbacks (builder.addCase(fetchUser.fulfilled, ...)) and the legacy
// object-map syntax ({ [fetchUser.fulfilled]: ... }).
function collectExtraReducerWrites(
  sourceFile: SourceFile,
  filePath: string,
  sliceName: string,
  sliceArg: Node
): SliceWriteFact[] {
  if (!Node.isObjectLiteralExpression(sliceArg)) return [];
  const extraProperty = sliceArg.getProperty("extraReducers");
  if (!extraProperty || !Node.isPropertyAssignment(extraProperty)) return [];

  const initializer = extraProperty.getInitializer();
  if (!initializer) return [];
  const writes: SliceWriteFact[] = [];

  if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
    for (const call of initializer.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== "addCase") continue;

      const caseArg = call.getArguments()[0];
      const writer = caseArg ? parseWriterRef(caseArg.getText()) : null;
      if (!writer) continue;
      const evidenceStart = expression.getNameNode();

      writes.push({
        type: "sliceWrite",
        sliceName,
        writerName: writer.name,
        writerState: writer.state,
        writes: reducerWrites(sourceFile, call.getArguments()[1]),
        file: filePath,
        // Focus the lifecycle reference, even when this addCase is part of a chain.
        location: getLocation(sourceFile, caseArg!),
        // call.getText() includes every preceding call in a builder chain. Slice
        // from this method name instead, preserving exactly one complete case.
        code: sourceFile.getFullText().slice(evidenceStart.getStart(), call.getEnd()),
        codeStartLine: getLocation(sourceFile, evidenceStart).line,
      });
    }
    return writes;
  }

  if (Node.isObjectLiteralExpression(initializer)) {
    for (const property of initializer.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const nameNode = property.getNameNode();
      if (!Node.isComputedPropertyName(nameNode)) continue;

      const writer = parseWriterRef(nameNode.getExpression().getText());
      if (!writer) continue;

      writes.push({
        type: "sliceWrite",
        sliceName,
        writerName: writer.name,
        writerState: writer.state,
        writes: reducerWrites(sourceFile, property.getInitializer()),
        file: filePath,
        location: getLocation(sourceFile, nameNode.getExpression()),
        code: property.getText(),
        codeStartLine: getLocation(sourceFile, property).line,
      });
    }
  }

  return writes;
}

function reducerWrites(
  sourceFile: SourceFile,
  reducer: Node | undefined
): NonNullable<SliceWriteFact["writes"]> {
  if (!reducer || (
    !Node.isArrowFunction(reducer) &&
    !Node.isFunctionExpression(reducer) &&
    !Node.isMethodDeclaration(reducer)
  )) return [];
  const stateParam = reducer.getParameters()[0]?.getName();
  const actionParameter = reducer.getParameters()[1];
  const payloadRoots = actionPayloadRoots(actionParameter);
  const derivedRoots = actionDerivedRoots(actionParameter);
  const importedValues = importedValueNames(sourceFile);
  const valueAliases = reducerValueAliases(reducer, payloadRoots, derivedRoots, importedValues);
  if (!stateParam) return [];

  return reducer.getDescendantsOfKind(SyntaxKind.BinaryExpression).flatMap((assignment) => {
    if (assignment.getOperatorToken().getText() !== "=") return [];
    const statePath = rootedPropertyPath(assignment.getLeft(), stateParam);
    if (!statePath) return [];
    const classified = classifyWriteValue(
      assignment.getRight(),
      payloadRoots,
      derivedRoots,
      valueAliases,
      importedValues
    );
    return [{
      statePath,
      ...classified,
      location: getLocation(sourceFile, assignment),
      code: assignment.getText(),
    }];
  });
}

function actionPayloadRoots(parameter: Node | undefined): string[] {
  if (!parameter || !Node.isParameterDeclaration(parameter)) return [];
  const name = parameter.getNameNode();

  if (Node.isIdentifier(name)) return [`${name.getText()}.payload`];
  if (!Node.isObjectBindingPattern(name)) return [];

  return name.getElements().flatMap((element) => {
    const propertyName = element.getPropertyNameNode()?.getText() ?? element.getNameNode().getText();
    const localName = element.getNameNode();
    return propertyName === "payload" && Node.isIdentifier(localName)
      ? [localName.getText()]
      : [];
  });
}

function actionDerivedRoots(parameter: Node | undefined): string[] {
  if (!parameter || !Node.isParameterDeclaration(parameter)) return [];
  const name = parameter.getNameNode();

  if (Node.isIdentifier(name)) return [`${name.getText()}.meta`, `${name.getText()}.error`];
  if (!Node.isObjectBindingPattern(name)) return [];

  return name.getElements().flatMap((element) => {
    const propertyName = element.getPropertyNameNode()?.getText() ?? element.getNameNode().getText();
    const localName = element.getNameNode();
    return propertyName !== "payload" && Node.isIdentifier(localName)
      ? [localName.getText()]
      : [];
  });
}

type WriteValueClassification = Pick<
  NonNullable<SliceWriteFact["writes"]>[number],
  "valueOrigin" | "payloadPath"
>;

function reducerValueAliases(
  reducer: Node,
  payloadRoots: string[],
  derivedRoots: string[],
  importedValues: ReadonlySet<string>
): Map<string, WriteValueClassification> {
  const aliases = new Map<string, WriteValueClassification>();

  for (const declaration of reducer.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const owner = declaration.getFirstAncestor((ancestor) =>
      Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor) || Node.isMethodDeclaration(ancestor)
    );
    if (owner !== reducer) continue;
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const source = classifyWriteValue(initializer, payloadRoots, derivedRoots, aliases, importedValues);
    if (source.valueOrigin === "unknown") continue;

    const name = declaration.getNameNode();
    if (Node.isIdentifier(name)) {
      aliases.set(name.getText(), source);
      continue;
    }
    if (!Node.isObjectBindingPattern(name) && !Node.isArrayBindingPattern(name)) continue;

    name.getElements().forEach((element, index) => {
      if (!element || !Node.isBindingElement(element)) return;
      const localName = element.getNameNode();
      if (!Node.isIdentifier(localName)) return;
      const propertyName = Node.isObjectBindingPattern(name)
        ? element.getPropertyNameNode()?.getText() ?? localName.getText()
        : String(index);
      aliases.set(localName.getText(), extendWriteSource(source, propertyName));
    });
  }

  return aliases;
}

function importedValueNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) names.add(defaultImport.getText());
    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) names.add(namespaceImport.getText());
    for (const namedImport of declaration.getNamedImports()) {
      names.add(namedImport.getAliasNode()?.getText() ?? namedImport.getName());
    }
  }
  return names;
}

function extendWriteSource(source: WriteValueClassification, path: string): WriteValueClassification {
  if (source.valueOrigin !== "payload") return { valueOrigin: "derived" };
  return {
    valueOrigin: "payload",
    payloadPath: [source.payloadPath, path].filter(Boolean).join("."),
  };
}

function rootedPropertyPath(node: Node, rootName: string): string | null {
  const parts: string[] = [];
  let current: Node = node;

  while (Node.isPropertyAccessExpression(current) || Node.isElementAccessExpression(current)) {
    if (Node.isPropertyAccessExpression(current)) {
      parts.unshift(current.getName());
      current = current.getExpression();
      continue;
    }
    const argument = current.getArgumentExpression();
    if (!argument) return null;
    parts.unshift(argument.getText().replace(/^["']|["']$/g, ""));
    current = current.getExpression();
  }

  return Node.isIdentifier(current) && current.getText() === rootName && parts.length > 0
    ? parts.join(".")
    : null;
}

function classifyWriteValue(
  node: Node,
  payloadRoots: string[],
  derivedRoots: string[] = [],
  aliases: ReadonlyMap<string, WriteValueClassification> = new Map(),
  importedValues: ReadonlySet<string> = new Set()
): WriteValueClassification {
  const text = node.getText();
  const normalizedText = text.replace(/\?\./g, ".");
  for (const payloadRoot of payloadRoots) {
    if (normalizedText === payloadRoot || normalizedText.startsWith(`${payloadRoot}.`)) {
      const payloadPath = normalizedText === payloadRoot ? undefined : normalizedText.slice(payloadRoot.length + 1);
      return { valueOrigin: "payload", ...(payloadPath ? { payloadPath } : {}) };
    }
    const escapedRoot = payloadRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z0-9_$])${escapedRoot}(?=$|[^A-Za-z0-9_$])`).test(text)) {
      return { valueOrigin: "derived" };
    }
  }

  for (const derivedRoot of derivedRoots) {
    if (normalizedText === derivedRoot || normalizedText.startsWith(`${derivedRoot}.`)) {
      return { valueOrigin: "derived" };
    }
  }

  for (const [alias, source] of aliases) {
    if (text === alias) return source;
    if (normalizedText.startsWith(`${alias}.`)) {
      return extendWriteSource(source, normalizedText.slice(alias.length + 1));
    }
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z0-9_$])${escapedAlias}(?=$|[^A-Za-z0-9_$])`).test(text)) {
      return { valueOrigin: "derived" };
    }
  }

  if (
    (Node.isIdentifier(node) && importedValues.has(node.getText())) ||
    (Node.isPropertyAccessExpression(node) && importedValues.has(callRootIdentifier(node) ?? ""))
  ) {
    return { valueOrigin: "derived" };
  }

  if (
    Node.isNullLiteral(node) ||
    (Node.isIdentifier(node) && node.getText() === "undefined") ||
    (Node.isArrayLiteralExpression(node) && node.getElements().length === 0) ||
    (Node.isObjectLiteralExpression(node) && node.getProperties().length === 0)
  ) {
    return { valueOrigin: "reset" };
  }

  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isNumericLiteral(node) ||
    Node.isTrueLiteral(node) ||
    Node.isFalseLiteral(node)
  ) {
    return { valueOrigin: "literal" };
  }

  return { valueOrigin: "unknown" };
}

const THUNK_LIFECYCLE_STATES = new Set(["fulfilled", "pending", "rejected"]);

function parseWriterRef(text: string): { name: string; state: string | null } | null {
  const parts = text.split(".").map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;

  if (THUNK_LIFECYCLE_STATES.has(last)) {
    const name = parts[parts.length - 2];
    return name ? { name, state: last } : null;
  }

  return { name: last, state: null };
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

  return matching[0] ?? null;
}

function isRtkQueryHookName(name: string) {
  return /^use[A-Z0-9].*(Query|Mutation)$/.test(name);
}

function trimQuotes(value: string) {
  return value.replace(/^["']|["']$/g, "");
}
