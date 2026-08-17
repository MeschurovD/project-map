import fs from "node:fs/promises";
import path from "node:path";
import { defaultConfig } from "./defaultConfig.js";
import type { ProjectMapConfig, ResolvedProjectMapConfig } from "./types.js";

export async function loadConfig(projectRoot: string): Promise<ResolvedProjectMapConfig> {
  const configPath = path.join(projectRoot, ".project-map", "config.json");
  const userConfig = await readUserConfig(configPath);
  const config = mergeConfig(defaultConfig, userConfig);
  const resolvedProjectRoot = path.resolve(projectRoot);
  const tsconfigPath = path.join(resolvedProjectRoot, "tsconfig.json");

  return {
    ...config,
    projectRoot: resolvedProjectRoot,
    sourceRootAbs: path.resolve(resolvedProjectRoot, config.sourceRoot),
    outputDirAbs: path.resolve(resolvedProjectRoot, config.outputDir),
    tsconfigPathAbs: (await exists(tsconfigPath)) ? tsconfigPath : null,
  };
}

async function readUserConfig(configPath: string): Promise<Partial<ProjectMapConfig>> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw) as Partial<ProjectMapConfig>;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

/**
 * Recursively merge a user override onto the defaults. Plain objects are
 * merged key-by-key; arrays and primitives are replaced wholesale. This is
 * intentionally module-agnostic: a module can add its own config section
 * (e.g. `docs`, `e2e`) without touching this merge logic.
 */
function mergeConfig(
  base: ProjectMapConfig,
  override: Partial<ProjectMapConfig>
): ProjectMapConfig {
  return deepMerge(base, override);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    result[key] = deepMerge(result[key], value);
  }

  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
