import { Node, Project, SyntaxKind, type Node as MorphNode } from "ts-morph";

export type SourceSnippet = {
  content: string;
  startLine: number;
  endLine: number;
};

export function getSnippetAroundLine(content: string, line: number | undefined, contextLines = 8): SourceSnippet {
  const lines = content.split(/\r?\n/);
  if (!line || !Number.isInteger(line) || line < 1 || line > lines.length) {
    return {
      content,
      startLine: 1,
      endLine: lines.length,
    };
  }

  const startLine = Math.max(1, line - contextLines);
  const endLine = Math.min(lines.length, line + contextLines);

  return {
    content: lines.slice(startLine - 1, endLine).join("\n"),
    startLine,
    endLine,
  };
}

export function getEnclosingFunctionSnippet(
  content: string,
  line: number | undefined,
  fileName = "source.ts"
): SourceSnippet | undefined {
  if (!line || !Number.isInteger(line) || line < 1) return undefined;

  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 1 },
  });
  const sourceFile = project.createSourceFile(fileName, content, { overwrite: true });
  if (line > sourceFile.getEndLineNumber()) return undefined;

  const lineText = sourceFile.getFullText().split(/\r?\n/)[line - 1] ?? "";
  const column = lineText.search(/\S/);
  const position = positionAtLine(content, line, Math.max(0, column));
  let current = sourceFile.getDescendantAtPos(position);
  let functionNode: MorphNode | undefined;

  while (current) {
    if (isFunctionLike(current)) {
      functionNode = current;
      break;
    }
    current = current.getParent();
  }

  functionNode ??= sourceFile.getDescendants()
    .filter(isFunctionLike)
    .filter((node) => node.getStartLineNumber() <= line && node.getEndLineNumber() >= line)
    .sort((left, right) => left.getWidth() - right.getWidth())[0];

  if (!functionNode) return undefined;
  const container = declarationContainer(functionNode) ?? functionNode;
  const startLine = container.getStartLineNumber();
  const endLine = container.getEndLineNumber();
  const lines = content.split(/\r?\n/);

  return {
    content: lines.slice(startLine - 1, endLine).join("\n"),
    startLine,
    endLine,
  };
}

function positionAtLine(content: string, line: number, column: number) {
  let position = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const newline = content.indexOf("\n", position);
    if (newline < 0) return content.length;
    position = newline + 1;
  }
  return Math.min(content.length, position + column);
}

function isFunctionLike(node: MorphNode) {
  return Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node);
}

function declarationContainer(node: MorphNode): MorphNode | undefined {
  if (!Node.isArrowFunction(node) && !Node.isFunctionExpression(node)) return undefined;
  const declaration = node.getParentIfKind(SyntaxKind.VariableDeclaration);
  return declaration?.getFirstAncestorByKind(SyntaxKind.VariableStatement);
}
