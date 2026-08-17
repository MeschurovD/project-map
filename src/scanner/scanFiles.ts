import path from "node:path";
import { globby } from "globby";
import type { ResolvedProjectMapConfig } from "../config/types.js";
import { toPosixPath } from "../utils/path.js";

export async function scanFiles(config: ResolvedProjectMapConfig): Promise<string[]> {
  const ignore = config.ignore.map((entry) => `**/${entry}/**`);
  const patterns = ["**/*.ts", "**/*.tsx"];
  const files = await globby(patterns, {
    cwd: config.sourceRootAbs,
    absolute: true,
    ignore,
  });

  return files
    .filter((file) => !file.endsWith(".d.ts"))
    .map((file) => toPosixPath(path.relative(config.projectRoot, file)))
    .sort();
}
