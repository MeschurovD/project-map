import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedProjectMapConfig } from "../config/types.js";
import type { ProjectFact, UnresolvedFact } from "../scanner/facts.js";
import type { ProjectMapGraph } from "../graph/types.js";
import type { FlowIndex } from "../flow/types.js";
import { artifactDigest } from "../artifacts/digest.js";
import {
  ARTIFACT_FILES,
  ARTIFACT_MANIFEST_SCHEMA_VERSION,
  type ArtifactManifest,
  type ArtifactName,
} from "../artifacts/types.js";

export type ProjectMapStats = {
  filesCount: number;
  factsCount: number;
  unresolvedCount: number;
  nodesCount: number;
  edgesCount: number;
};

export async function writeArtifacts(args: {
  config: ResolvedProjectMapConfig;
  facts: ProjectFact[];
  graph: ProjectMapGraph;
  flowIndex: FlowIndex;
  stats: ProjectMapStats;
}) {
  await fs.mkdir(args.config.outputDirAbs, { recursive: true });

  const unresolved = args.facts.filter(isUnresolvedFact);
  const artifacts: Record<ArtifactName, unknown> = {
    config: {
      sourceRoot: args.config.sourceRoot,
      fsd: args.config.fsd,
      redux: args.config.redux,
      ignore: args.config.ignore,
      outputDir: args.config.outputDir,
    },
    facts: args.facts,
    graph: args.graph,
    flows: args.flowIndex,
    unresolved,
    stats: args.stats,
  };

  for (const artifact of Object.keys(ARTIFACT_FILES) as ArtifactName[]) {
    await writeJson(path.join(args.config.outputDirAbs, ARTIFACT_FILES[artifact]), artifacts[artifact]);
  }

  const manifest: ArtifactManifest = {
    schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
    runId: args.flowIndex.runId,
    generatedAt: args.flowIndex.generatedAt,
    sourceFingerprint: args.flowIndex.sourceFingerprint,
    artifacts: {
      config: descriptor("config", artifacts.config),
      facts: descriptor("facts", artifacts.facts),
      graph: descriptor("graph", artifacts.graph, args.graph.schemaVersion),
      flows: descriptor("flows", artifacts.flows, args.flowIndex.schemaVersion),
      unresolved: descriptor("unresolved", artifacts.unresolved),
      stats: descriptor("stats", artifacts.stats),
    },
  };
  // Commit marker for the run: readers only trust artifacts matching this
  // manifest, so it must be written after every artifact is in place.
  await writeJson(path.join(args.config.outputDirAbs, "manifest.json"), manifest);
}

function descriptor(artifact: ArtifactName, value: unknown, schemaVersion?: string) {
  return {
    file: ARTIFACT_FILES[artifact],
    digest: artifactDigest(value),
    ...(schemaVersion ? { schemaVersion } : {}),
  };
}

function isUnresolvedFact(fact: ProjectFact): fact is UnresolvedFact {
  return (
    fact.type === "unresolvedImport" ||
    fact.type === "unresolvedJsxComponent" ||
    fact.type === "unresolvedHook"
  );
}

async function writeJson(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}
