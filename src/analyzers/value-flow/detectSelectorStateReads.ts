import { Node, SyntaxKind, type Node as TsNode, type SourceFile } from "ts-morph";
import { getCallName, getLocation } from "../shared/ast.js";
import { sourceLocation, type SelectorStateReadFact } from "./types.js";

type SelectorFn = TsNode; // ArrowFunction | FunctionExpression | FunctionDeclaration

/** A composition of the form `base(state).a.b` returned by a selector. */
type Composition = { base: string; fieldPath: string };

type PendingSelector = {
  selectorName: string;
  location: SelectorStateReadFact["location"];
  code: string;
  /** Direct `state.…` path, when the selector reads state itself. */
  directPaths?: string[];
  /** `createSelector` input selector names (array or varargs form). */
  createSelectorInputs?: string[];
  /** Returned `base(state).field` composition, resolved in the second pass. */
  compositions?: Composition[];
  /** Selector calls found inside a larger returned expression. */
  composedSelectors?: string[];
  /** Selector has no state parameter — a constant like `() => false`. */
  constant?: boolean;
};

export function detectSelectorStateReads(sourceFile: SourceFile, filePath: string): SelectorStateReadFact[] {
  const pending: PendingSelector[] = [];

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const selectorName = declaration.getName();
    if (!isSelectorCandidate(selectorName, filePath)) continue;

    const initializer = declaration.getInitializer();
    if (!initializer) continue;

    const location = sourceLocation(filePath, getLocation(sourceFile, declaration));
    const code = declaration.getFirstAncestorByKind(SyntaxKind.VariableStatement)?.getText() ?? declaration.getText();

    if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
      pending.push({ selectorName, location, code, ...classifySelectorFn(initializer) });
      continue;
    }

    if (Node.isCallExpression(initializer) && getCallName(initializer) === "createSelector") {
      pending.push({ selectorName, location, code, createSelectorInputs: createSelectorInputs(initializer) });
    }
  }

  for (const fn of sourceFile.getFunctions()) {
    const selectorName = fn.getName();
    if (!selectorName || !isSelectorCandidate(selectorName, filePath)) continue;

    pending.push({
      selectorName,
      location: sourceLocation(filePath, getLocation(sourceFile, fn)),
      code: fn.getText(),
      ...classifySelectorFn(fn),
    });
  }

  const directPaths = new Map<string, string[]>();
  const localSelectorNames = new Set<string>();
  for (const entry of pending) {
    localSelectorNames.add(entry.selectorName);
    if (entry.directPaths?.length) directPaths.set(entry.selectorName, entry.directPaths);
  }

  const facts: SelectorStateReadFact[] = [];
  const factNames = new Set<string>();
  const base = (selectorName: string, entry: PendingSelector) => ({
    type: "selectorStateRead" as const,
    selectorName,
    file: filePath,
    location: entry.location,
    code: entry.code,
  });
  const pushFact = (fact: SelectorStateReadFact) => {
    facts.push(fact);
    factNames.add(fact.selectorName);
  };
  // Bases that are declared in this file but produced no fact of their own
  // (unparsed body). Emitting a placeholder keeps the `derives` edge local and
  // honestly labeled instead of masquerading as a cross-file composition.
  const localUnparsedBases = new Set<string>();
  const noteLocalBases = (inputs: string[]) => {
    for (const input of inputs) {
      if (localSelectorNames.has(input)) localUnparsedBases.add(input);
    }
  };

  for (const entry of pending) {
    let recorded = false;
    for (const directPath of entry.directPaths ?? []) {
      pushFact({ ...base(entry.selectorName, entry), statePath: directPath, confidence: "high" });
      recorded = true;
    }

    const derivedSelectors = new Set(entry.composedSelectors ?? []);
    for (const composition of entry.compositions ?? []) {
      const basePaths = directPaths.get(composition.base);
      if (basePaths?.length === 1) {
        // Direct AST fact: base reads a known state path, we own the field access.
        pushFact({
          ...base(entry.selectorName, entry),
          statePath: `${basePaths[0]}.${composition.fieldPath}`,
          confidence: "high",
        });
        recorded = true;
      } else {
        derivedSelectors.add(composition.base);
      }
    }

    if (derivedSelectors.size > 0) {
      const inputs = [...derivedSelectors];
      pushFact({
        ...base(entry.selectorName, entry),
        derivedFromSelectors: inputs,
        confidence: "medium",
      });
      noteLocalBases(inputs);
      recorded = true;
    }

    if (entry.createSelectorInputs) {
      if (entry.createSelectorInputs.length > 0) {
        pushFact({
          ...base(entry.selectorName, entry),
          derivedFromSelectors: entry.createSelectorInputs,
          confidence: "medium",
        });
        noteLocalBases(entry.createSelectorInputs);
        recorded = true;
      }
      // createSelector whose inputs are not plain identifiers (e.g. inline
      // arrows) stays unrecorded: the binding-side generic
      // selector-source-not-recorded gap is the honest label, not
      // selector-constant.
    }

    if (!recorded && entry.constant) {
      // No state parameter: a constant selector with no state source by
      // construction. The explicit flag keeps it distinguishable from a
      // selector we merely failed to parse.
      pushFact({ ...base(entry.selectorName, entry), constant: true, confidence: "high" });
    }
    // Otherwise (has a state param but no resolvable path/composition): emit
    // nothing; a binding of it becomes a generic `selector-source-not-recorded`.
  }

  for (const name of localUnparsedBases) {
    if (factNames.has(name)) continue;
    const entry = pending.find((candidate) => candidate.selectorName === name);
    if (!entry) continue;
    // Placeholder for a same-file composition base whose own body we could not
    // parse: no statePath, no dependencies, not constant. buildFlowIndex turns
    // it into a generic selector-source-not-recorded gap at the right node.
    pushFact({ ...base(name, entry), confidence: "low" });
  }

  return facts;
}

function classifySelectorFn(
  fn: SelectorFn
): Pick<PendingSelector, "directPaths" | "compositions" | "composedSelectors" | "constant"> {
  const stateParam = firstParamName(fn);
  if (!stateParam) return { constant: true };

  const expressions = returnedExpressions(fn);
  return {
    directPaths: extractStatePaths(fn, stateParam),
    compositions: expressions.flatMap((expression) => compositionFromExpression(expression, stateParam) ?? []),
    composedSelectors: selectorCalls([fn], stateParam),
  };
}

function firstParamName(fn: SelectorFn): string | undefined {
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn)) {
    return fn.getParameters()[0]?.getName();
  }
  return undefined;
}

function createSelectorInputs(call: TsNode): string[] {
  if (!Node.isCallExpression(call)) return [];
  const args = call.getArguments();
  const first = args[0];
  if (Node.isArrayLiteralExpression(first)) {
    return first.getElements().map((entry) => entry.getText()).filter(Boolean);
  }
  // Varargs form: every argument except the trailing result function is an input.
  return args
    .slice(0, Math.max(args.length - 1, 0))
    .filter((arg) => Node.isIdentifier(arg))
    .map((arg) => arg.getText())
    .filter(Boolean);
}

function returnedExpressions(fn: SelectorFn): TsNode[] {
  const expressions: TsNode[] = [];
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody();
    if (!Node.isBlock(body)) expressions.push(body);
  }
  for (const statement of fn.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const expression = statement.getExpression();
    if (expression) expressions.push(expression);
  }
  return expressions;
}

function extractStatePaths(fn: SelectorFn, stateParam: string): string[] {
  const candidates = [
    ...(Node.isPropertyAccessExpression(fn) ? [fn.getText()] : []),
    ...fn.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).map((expression) => expression.getText()),
  ].filter((text) => text.startsWith(`${stateParam}.`));
  const unique = [...new Set(candidates)];
  return unique.filter((candidate) =>
    !unique.some((other) => other !== candidate && other.startsWith(`${candidate}.`))
  );
}

function selectorCalls(expressions: TsNode[], stateParam: string): string[] {
  const names = new Set<string>();
  for (const expression of expressions) {
    const calls = [
      ...(Node.isCallExpression(expression) ? [expression] : []),
      ...expression.getDescendantsOfKind(SyntaxKind.CallExpression),
    ];
    for (const call of calls) {
      const callee = call.getExpression();
      const firstArg = call.getArguments()[0];
      if (!Node.isIdentifier(callee) || !isSelectorName(callee.getText())) continue;
      if (!firstArg || !Node.isIdentifier(firstArg) || firstArg.getText() !== stateParam) continue;
      names.add(callee.getText());
    }
  }
  return [...names];
}

/**
 * Resolve `base(state).a.b` into its base selector name and the property path
 * accessed on its result. Keeps the full property path (any depth).
 */
function compositionFromExpression(expression: TsNode, stateParam: string): Composition | null {
  if (!Node.isPropertyAccessExpression(expression)) return null;

  const fields: string[] = [];
  let current: TsNode = expression;
  while (Node.isPropertyAccessExpression(current)) {
    fields.unshift(current.getName());
    current = current.getExpression();
  }

  if (fields.length === 0 || !Node.isCallExpression(current)) return null;

  const callee = current.getExpression();
  if (!Node.isIdentifier(callee)) return null;
  const baseName = callee.getText();
  if (!isSelectorName(baseName)) return null;

  const firstArg = current.getArguments()[0];
  if (!firstArg || !Node.isIdentifier(firstArg) || firstArg.getText() !== stateParam) return null;

  return { base: baseName, fieldPath: fields.join(".") };
}

function isSelectorName(name: string) {
  return /^(?:select|selct)[A-Z0-9]/.test(name) || /Selector$/.test(name);
}

function isSelectorCandidate(name: string, filePath: string) {
  return isSelectorName(name) || /(?:^|\/)selectors?\.[jt]sx?$/.test(filePath);
}
