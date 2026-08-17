import path from "node:path";

export function toPosixPath(filePath: string) {
  return filePath.replaceAll(path.sep, "/");
}

export function toProjectRelative(projectRoot: string, filePath: string) {
  return toPosixPath(path.relative(projectRoot, filePath));
}

export function stripExtension(filePath: string) {
  return filePath.replace(/\.(tsx?|jsx?)$/, "");
}
