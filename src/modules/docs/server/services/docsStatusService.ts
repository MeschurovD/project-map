import type { ProjectMapGraph } from "../../../../graph/types.js";
import { getGraphNode } from "../../../server/graphNode.js";
import {
  resolveDocsReadPathsForNode,
  resolveV2DocsPathForNode,
} from "./docsPathResolver.js";
import { parseDocsFile, type ParsedDocsFile } from "./docsFileFormat.js";
import {
  isV2FullyReviewed,
  parseDocsV2File,
} from "./docsV2FileFormat.js";
import {
  computeSourceDigest,
  computeSourceHash,
  docsFileStat,
  readDocsFile,
} from "./docsFileService.js";
import type { DocsStatus } from "./docsTypes.js";

export { getGraphNode };

export async function getDocsStatusForNode(params: {
  graph: ProjectMapGraph;
  nodeId: string;
  projectRoot: string;
}): Promise<DocsStatus> {
  const node = getGraphNode(params.graph, params.nodeId);
  const expectedPath = resolveV2DocsPathForNode(node);

  if (!expectedPath || !node.file) {
    return {
      nodeId: params.nodeId,
      status: "unsupported",
      reason: "Node has no source file",
    };
  }

  let existing:
    | { path: string; stat: Awaited<ReturnType<typeof docsFileStat>> }
    | undefined;
  for (const docsPath of resolveDocsReadPathsForNode(node)) {
    try {
      existing = {
        path: docsPath,
        stat: await docsFileStat(params.projectRoot, docsPath),
      };
      break;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
  }
  if (!existing) {
    return {
      nodeId: params.nodeId,
      status: "missing",
      expectedPath,
    };
  }

  const content = await readDocsFile(params.projectRoot, existing.path);
  const parsedV2 = parseDocsV2File(content);
  const parsed = parseDocsFile(content);
  const staleReasons = parsedV2
    ? await getV2StaleReasons(parsedV2, params.projectRoot)
    : [];
  const stale = parsedV2
    ? staleReasons.length > 0
    : await isStale(parsed, params.projectRoot, node.file);

  return {
    nodeId: params.nodeId,
    status: stale ? "stale" : "exists",
    path: existing.path,
    updatedAt: existing.stat.mtime.toISOString(),
    sizeBytes: existing.stat.size,
    format: parsedV2
      ? "structured-v2"
      : parsed.kind === "structured"
        ? "structured"
        : "legacy",
    reviewed: parsedV2
      ? isV2FullyReviewed(parsedV2)
      : parsed.kind === "structured" && parsed.frontmatter.reviewed === true,
    staleReasons: staleReasons.length > 0 ? staleReasons : undefined,
  };
}

/** Legacy files carry no sourceHash, so they can never be reported stale. */
export async function isStale(parsed: ParsedDocsFile, projectRoot: string, sourceFile: string) {
  if (parsed.kind !== "structured" || !parsed.frontmatter.sourceHash) return false;
  return parsed.frontmatter.sourceHash !== (await computeSourceHash(projectRoot, sourceFile));
}

export async function getV2StaleReasons(
  parsed: NonNullable<ReturnType<typeof parseDocsV2File>>,
  projectRoot: string
) {
  const sources = parsed.frontmatter.sources;
  // Existing pre-manifest docs remain readable and are migrated on the next
  // regeneration; absence of a manifest is not reported as a false change.
  if (!sources || sources.length === 0) return [];

  const reasons: string[] = [];
  for (const source of sources) {
    try {
      const currentHash = await computeSourceDigest(projectRoot, source.path);
      if (currentHash !== source.hash) {
        reasons.push(`Изменился source-файл: ${source.path}`);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        reasons.push(`Source-файл удалён: ${source.path}`);
      } else {
        reasons.push(`Source-файл недоступен: ${source.path}`);
      }
    }
  }
  return reasons;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
