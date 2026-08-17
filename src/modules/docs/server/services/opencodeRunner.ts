import fs from "node:fs/promises";
import path from "node:path";
import type { GeneratorConfig } from "../../../../config/types.js";
import { runOpenCodeJob } from "../../../../generation/runners/opencodeRunner.js";
import { appendJobLog, markJobError, markJobRunning, markJobSuccess } from "./docsJobService.js";
import { readDocsFile, resolveWritableDocsPath } from "./docsFileService.js";
import {
  DOCS_PARTIAL_OUTPUT_TOKEN,
} from "./docsPromptService.js";
import type { DocsGenerationScope } from "./docsTypes.js";
import {
  parseDocsV2File,
  validateDocsV2File,
  withV2SourceManifest,
  type DocsV2Source,
} from "./docsV2FileFormat.js";
import { mergeDocsV2Blocks } from "./docsV2MergeService.js";
import {
  validateDocsV2References,
  type DocsV2ReferenceAllowlist,
} from "./docsV2ReferenceValidator.js";

export async function runOpenCodeDocsJob(params: {
  projectRoot: string;
  prompt: string;
  docsPath: string;
  nodeId: string;
  jobId: string;
  generator: GeneratorConfig;
  scope: DocsGenerationScope;
  sourceManifest: DocsV2Source[];
  referenceAllowlist: DocsV2ReferenceAllowlist;
}): Promise<void> {
  const targetPath = resolveWritableDocsPath(params.projectRoot, params.docsPath);
  const partial = params.scope.type !== "document";
  const generatedPath = partial
    ? path.posix.join(".project-map", "jobs", params.jobId, "docs-fragment.md")
    : params.docsPath;
  const generatedTargetPath = resolveWritableDocsPath(
    params.projectRoot,
    generatedPath
  );
  const prompt = params.prompt.replaceAll(
    DOCS_PARTIAL_OUTPUT_TOKEN,
    generatedPath
  );
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
  } catch (error) {
    markJobError(
      params.jobId,
      error instanceof Error ? error.message : String(error)
    );
    return;
  }

  return runOpenCodeJob({
    projectRoot: params.projectRoot,
    prompt,
    jobId: params.jobId,
    generator: params.generator,
    hooks: { markJobRunning, appendJobLog, markJobSuccess, markJobError },
    startLog: "Building docs context",
    successLog: "Docs file created",
    verifyTarget: async () => {
      await fs.access(generatedTargetPath);
    },
    validateTarget: async () => {
      if (params.scope.type !== "document") {
        try {
          const merged = mergeDocsV2Blocks({
            content: await readDocsFile(params.projectRoot, params.docsPath),
            fragment: await readDocsFile(params.projectRoot, generatedPath),
            scope: params.scope,
          });
          return validateDocsV2References({
            parsed: merged.parsed,
            expectedOwnerNodeId: params.nodeId,
            allowlist: params.referenceAllowlist,
          });
        } catch (error) {
          return [error instanceof Error ? error.message : String(error)];
        }
      }
      const content = await readDocsFile(params.projectRoot, generatedPath);
      const parsed = parseDocsV2File(content);
      if (!parsed) return ["Файл обязан использовать schema project-map.docs/v2."];
      const errors = validateDocsV2File(parsed)
        .filter((diagnostic) =>
          diagnostic.severity === "error" ||
          diagnostic.code === "missing-value-summary" ||
          diagnostic.code === "invalid-value-summary" ||
          diagnostic.code === "value-summary-too-long" ||
          diagnostic.code === "missing-value-category" ||
          diagnostic.code === "invalid-value-category" ||
          diagnostic.code === "value-meaning-too-long" ||
          diagnostic.code === "value-meaning-technical-narration"
        )
        .map((diagnostic) => diagnostic.message);
      errors.push(...validateDocsV2References({
        parsed,
        expectedOwnerNodeId: params.nodeId,
        allowlist: params.referenceAllowlist,
      }));
      errors.push(...sourceManifestErrors(
        parsed.frontmatter.sources ?? [],
        params.sourceManifest
      ));
      return errors;
    },
    buildRetryPrompt: (errors) => buildDocsRetryPrompt({
      prompt,
      docsPath: generatedPath,
    }, errors),
    finalizeTarget: partial
      ? async () => {
          if (params.scope.type === "document") return;
          const merged = mergeDocsV2Blocks({
            content: await readDocsFile(params.projectRoot, params.docsPath),
            fragment: await readDocsFile(params.projectRoot, generatedPath),
            scope: params.scope,
          });
          const content = withV2SourceManifest(
            merged.content,
            params.sourceManifest
          );
          const temporaryPath = `${targetPath}.project-map-${params.jobId}.tmp`;
          await fs.writeFile(temporaryPath, content, "utf8");
          await fs.rename(temporaryPath, targetPath);
        }
      : undefined,
  });
}

function sourceManifestErrors(
  actual: DocsV2Source[],
  expected: DocsV2Source[]
) {
  const actualByPath = new Map(actual.map((source) => [source.path, source.hash]));
  const expectedByPath = new Map(expected.map((source) => [source.path, source.hash]));
  const errors: string[] = [];
  for (const [sourcePath, hash] of expectedByPath) {
    if (actualByPath.get(sourcePath) !== hash) {
      errors.push(`Source manifest обязан содержать актуальный hash для "${sourcePath}".`);
    }
  }
  for (const sourcePath of actualByPath.keys()) {
    if (!expectedByPath.has(sourcePath)) {
      errors.push(`Source manifest содержит неразрешённый path "${sourcePath}".`);
    }
  }
  return errors;
}

function buildDocsRetryPrompt(params: { prompt: string; docsPath: string }, errors: string[]) {
  return `${params.prompt}

## Исправление

Файл ${params.docsPath} уже создан тобой, но не прошёл валидацию формата.
Исправь только перечисленные нарушения, не переписывая остальное содержимое:

${errors.map((error) => `- ${error}`).join("\n")}
`;
}
