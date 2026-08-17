import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { readProjectFile, resolveProjectFilePath } from "../../../../dev/services/sourceFileService.js";

export async function readDocsFile(projectRoot: string, docsPath: string) {
  const { content } = await readProjectFile({ projectRoot, relativePath: docsPath });
  return content;
}

export async function docsFileStat(projectRoot: string, docsPath: string) {
  const fullPath = resolveProjectFilePath({ projectRoot, relativePath: docsPath });
  return fs.stat(fullPath);
}

export function resolveWritableDocsPath(projectRoot: string, docsPath: string) {
  return resolveProjectFilePath({ projectRoot, relativePath: docsPath });
}

export async function writeDocsFile(projectRoot: string, docsPath: string, content: string) {
  await fs.writeFile(resolveWritableDocsPath(projectRoot, docsPath), content, "utf8");
}

/**
 * Short content hash of a project source file; written into the docs
 * frontmatter at generation time and compared later for staleness.
 */
export async function computeSourceHash(projectRoot: string, sourceFile: string) {
  return (await computeSourceDigest(projectRoot, sourceFile))
    .slice("sha256:".length, "sha256:".length + 12);
}

export async function computeSourceDigest(projectRoot: string, sourceFile: string) {
  const { content } = await readProjectFile({ projectRoot, relativePath: sourceFile });
  return `sha256:${createHash("sha256").update(content).digest("hex")}` as const;
}
