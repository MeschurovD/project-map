import type { ProjectMapGraph } from "../../../../graph/types.js";
import { withReviewedFlag } from "./docsFileFormat.js";
import {
  parseDocsV2File,
  withV2BlockReviewStatus,
} from "./docsV2FileFormat.js";
import { readDocsFile, writeDocsFile } from "./docsFileService.js";
import { getDocsStatusForNode } from "./docsStatusService.js";
import type { DocsStatus } from "./docsTypes.js";

/**
 * Flip the frontmatter `reviewed` flag on a node's docs file. Only structured
 * docs carry the flag; legacy and missing files are rejected. Returns the fresh
 * status so the UI can re-render badges without a second request.
 */
export async function setDocsReviewed(params: {
  graph: ProjectMapGraph;
  nodeId: string;
  projectRoot: string;
  reviewed: boolean;
  annotationIds?: string[];
}): Promise<DocsStatus> {
  const status = await getDocsStatusForNode({ graph: params.graph, nodeId: params.nodeId, projectRoot: params.projectRoot });

  if (status.status !== "exists" && status.status !== "stale") {
    throw Object.assign(new Error("Документация отсутствует — отметить как проверенную нельзя"), { statusCode: 409 });
  }
  if (status.format === "legacy") {
    throw Object.assign(new Error("Легаси-документация без frontmatter не поддерживает отметку «проверено»"), { statusCode: 409 });
  }

  const content = await readDocsFile(params.projectRoot, status.path);
  if (params.annotationIds?.length && status.format !== "structured-v2") {
    throw Object.assign(
      new Error("Block-level review доступен только для docs v2"),
      { statusCode: 409 }
    );
  }
  await writeDocsFile(
    params.projectRoot,
    status.path,
    status.format === "structured-v2"
      ? withV2BlockReviewStatus(
          content,
          params.annotationIds ??
            parseDocsV2File(content)?.blocks.map((block) => block.metadata.id) ??
            [],
          params.reviewed
        )
      : withReviewedFlag(content, params.reviewed)
  );

  return getDocsStatusForNode({ graph: params.graph, nodeId: params.nodeId, projectRoot: params.projectRoot });
}
