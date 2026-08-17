import path from "node:path";
import { Project } from "ts-morph";
import type { ResolvedProjectMapConfig } from "../config/types.js";

export function createTsProject(config: ResolvedProjectMapConfig, files: string[]) {
  const project = new Project({
    ...(config.tsconfigPathAbs ? { tsConfigFilePath: config.tsconfigPathAbs } : {}),
    skipAddingFilesFromTsConfig: true,
  });

  for (const file of files) {
    project.addSourceFileAtPath(path.join(config.projectRoot, file));
  }

  return project;
}
