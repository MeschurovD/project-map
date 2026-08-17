import fs from "node:fs/promises";
import { readProjectFile, resolveProjectFilePath } from "../../../../dev/services/sourceFileService.js";

export async function e2eFileStat(projectRoot: string, targetPath: string) {
  const fullPath = resolveProjectFilePath({ projectRoot, relativePath: targetPath });
  return fs.stat(fullPath);
}

export async function readE2eFile(projectRoot: string, targetPath: string) {
  const { content } = await readProjectFile({ projectRoot, relativePath: targetPath });
  return content;
}

export async function e2eFileExists(projectRoot: string, targetPath: string) {
  try {
    await e2eFileStat(projectRoot, targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
