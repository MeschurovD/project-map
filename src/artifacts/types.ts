export const ARTIFACT_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;

export const ARTIFACT_FILES = {
  config: "config.json",
  facts: "facts.json",
  graph: "graph.json",
  flows: "flows.json",
  unresolved: "unresolved.json",
  stats: "stats.json",
} as const;

export type ArtifactName = keyof typeof ARTIFACT_FILES;

export type ArtifactDescriptor = {
  file: string;
  digest: string;
  schemaVersion?: string;
};

export type ArtifactManifest = {
  schemaVersion: typeof ARTIFACT_MANIFEST_SCHEMA_VERSION;
  runId: string;
  generatedAt: string;
  sourceFingerprint: string;
  artifacts: Record<ArtifactName, ArtifactDescriptor>;
};

export type ArtifactHealthStatus = "fresh" | "stale" | "incompatible";

export type ArtifactHealthReason = {
  code: string;
  message: string;
  artifact?: ArtifactName | "manifest";
};

export type ArtifactHealth = {
  status: ArtifactHealthStatus;
  checkedAt: string;
  runId?: string;
  generatedAt?: string;
  sourceFingerprint?: string;
  reasons: ArtifactHealthReason[];
};
