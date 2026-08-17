import fs from "node:fs/promises";
import path from "node:path";
import { artifactDigest } from "./digest.js";
import {
  ARTIFACT_FILES,
  ARTIFACT_MANIFEST_SCHEMA_VERSION,
  type ArtifactHealth,
  type ArtifactHealthReason,
  type ArtifactManifest,
  type ArtifactName,
} from "./types.js";
import { FLOW_SCHEMA_VERSION } from "../flow/types.js";
import { loadConfig } from "../config/loadConfig.js";
import { scanFiles } from "../scanner/scanFiles.js";

const EXPECTED_ARTIFACT_SCHEMAS: Partial<Record<ArtifactName, string>> = {
  graph: "1.1.0",
  flows: FLOW_SCHEMA_VERSION,
};

export async function assessArtifactDirectory(projectRoot: string): Promise<ArtifactHealth> {
  const outputDir = path.join(projectRoot, ".project-map");
  const manifestResult = await readJson(path.join(outputDir, "manifest.json"));
  if (manifestResult.kind === "missing") {
    return health("stale", [{
      code: "manifest-missing",
      artifact: "manifest",
      message: "Artifact manifest is missing; run a new scan.",
    }]);
  }
  if (manifestResult.kind === "invalid" || !isManifestShape(manifestResult.value)) {
    return health("incompatible", [{
      code: "manifest-invalid",
      artifact: "manifest",
      message: "Artifact manifest is invalid.",
    }]);
  }

  const manifest = manifestResult.value;
  if (manifest.schemaVersion !== ARTIFACT_MANIFEST_SCHEMA_VERSION) {
    return health("incompatible", [{
      code: "manifest-schema-incompatible",
      artifact: "manifest",
      message: `Expected manifest schema ${ARTIFACT_MANIFEST_SCHEMA_VERSION}, received ${manifest.schemaVersion}.`,
    }], manifest);
  }

  const staleReasons: ArtifactHealthReason[] = [];
  const incompatibleReasons: ArtifactHealthReason[] = [];
  for (const artifact of Object.keys(ARTIFACT_FILES) as ArtifactName[]) {
    const descriptor = manifest.artifacts[artifact];
    const expectedFile = ARTIFACT_FILES[artifact];
    if (!descriptor || descriptor.file !== expectedFile) {
      incompatibleReasons.push({
        code: "artifact-descriptor-invalid",
        artifact,
        message: `Manifest descriptor for ${artifact} is invalid.`,
      });
      continue;
    }

    const result = await readJson(path.join(outputDir, expectedFile));
    if (result.kind !== "ok") {
      staleReasons.push({
        code: result.kind === "missing" ? "artifact-missing" : "artifact-invalid-json",
        artifact,
        message: `${expectedFile} is ${result.kind === "missing" ? "missing" : "not valid JSON"}.`,
      });
      continue;
    }

    if (artifactDigest(result.value) !== descriptor.digest) {
      staleReasons.push({
        code: "artifact-digest-mismatch",
        artifact,
        message: `${expectedFile} does not belong to manifest run ${manifest.runId}.`,
      });
    }

    const expectedSchema = EXPECTED_ARTIFACT_SCHEMAS[artifact];
    const actualSchema = schemaVersionOf(result.value);
    if (expectedSchema && (descriptor.schemaVersion !== expectedSchema || actualSchema !== expectedSchema)) {
      incompatibleReasons.push({
        code: "artifact-schema-incompatible",
        artifact,
        message: `Expected ${artifact} schema ${expectedSchema}, received ${actualSchema ?? "none"}.`,
      });
    }

    if (artifact === "flows" && isRecord(result.value)) {
      if (
        result.value.runId !== manifest.runId ||
        result.value.generatedAt !== manifest.generatedAt ||
        result.value.sourceFingerprint !== manifest.sourceFingerprint
      ) {
        staleReasons.push({
          code: "artifact-run-mismatch",
          artifact,
          message: "flows.json metadata does not match the manifest run.",
        });
      }
    }
  }

  if (await hasNewerSourceFile(projectRoot, manifest.generatedAt)) {
    staleReasons.push({
      code: "source-newer-than-analysis",
      message: "Project source files changed after the last analysis.",
    });
  }

  if (incompatibleReasons.length > 0) return health("incompatible", incompatibleReasons, manifest);
  if (staleReasons.length > 0) return health("stale", staleReasons, manifest);
  return health("fresh", [], manifest);
}

function health(
  status: ArtifactHealth["status"],
  reasons: ArtifactHealthReason[],
  manifest?: ArtifactManifest
): ArtifactHealth {
  return {
    status,
    checkedAt: new Date().toISOString(),
    runId: manifest?.runId,
    generatedAt: manifest?.generatedAt,
    sourceFingerprint: manifest?.sourceFingerprint,
    reasons,
  };
}

async function readJson(filePath: string): Promise<
  | { kind: "ok"; value: unknown }
  | { kind: "missing" }
  | { kind: "invalid"; value?: unknown }
> {
  try {
    return { kind: "ok", value: JSON.parse(await fs.readFile(filePath, "utf8")) as unknown };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { kind: "missing" };
    return { kind: "invalid" };
  }
}

function isManifestShape(value: unknown): value is ArtifactManifest {
  return isRecord(value) &&
    typeof value.schemaVersion === "string" &&
    typeof value.runId === "string" &&
    typeof value.generatedAt === "string" &&
    typeof value.sourceFingerprint === "string" &&
    isRecord(value.artifacts);
}

function schemaVersionOf(value: unknown): string | null {
  return isRecord(value) && typeof value.schemaVersion === "string" ? value.schemaVersion : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function hasNewerSourceFile(projectRoot: string, generatedAt: string) {
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) return true;

  try {
    const config = await loadConfig(projectRoot);
    const files = await scanFiles(config);
    for (const file of files) {
      const stat = await fs.stat(path.join(projectRoot, file));
      if (stat.mtimeMs > generatedAtMs) return true;
    }
    return false;
  } catch {
    // A missing/unreadable source root needs a new diagnostic scan rather than
    // being silently labelled fresh.
    return true;
  }
}
