import fs from "node:fs/promises";
import path from "node:path";

export type ReadProjectFileArgs = {
  projectRoot: string;
  relativePath: string;
};

export async function readProjectFile(args: ReadProjectFileArgs) {
  const fullPath = resolveProjectFilePath(args);
  const content = await fs.readFile(fullPath, "utf8");

  return {
    fullPath,
    content,
  };
}

export function resolveProjectFilePath(args: ReadProjectFileArgs) {
  if (!args.relativePath.trim()) {
    throw new Error("Source path is required");
  }

  if (args.relativePath.includes("\0")) {
    throw new Error("Source path contains an invalid character");
  }

  const projectRoot = path.resolve(args.projectRoot);
  const fullPath = path.resolve(projectRoot, args.relativePath);
  const relativeToRoot = path.relative(projectRoot, fullPath);

  if (
    relativeToRoot === "" ||
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("Access outside project root is forbidden");
  }

  if (relativeToRoot.split(path.sep).includes("node_modules")) {
    throw new Error("Reading node_modules is forbidden");
  }

  return fullPath;
}

export function getLanguageByFile(file: string | undefined): string {
  if (!file) return "plaintext";
  if (file.endsWith(".tsx")) return "typescript";
  if (file.endsWith(".ts")) return "typescript";
  if (file.endsWith(".jsx")) return "javascript";
  if (file.endsWith(".js")) return "javascript";
  if (file.endsWith(".json")) return "json";
  if (file.endsWith(".md")) return "markdown";
  return "plaintext";
}
