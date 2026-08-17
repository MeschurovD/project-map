import type { FlowIndex } from "../../../../flow/types.js";
import type { ProjectMapGraph } from "../../../../graph/types.js";
import type { ParsedDocsV2File } from "./docsV2FileFormat.js";

export type DocsV2ReferenceAllowlist = {
  nodeIds: Set<string>;
  flowNodeIds: Set<string>;
  occurrenceIds: Set<string>;
};

export type DocsV2ReferenceDiagnostic = {
  code: "unexpected-owner" | "missing-owner-node" | "unknown-target";
  message: string;
  blockId?: string;
};

export function buildDocsV2ReferenceAllowlist(
  graph: ProjectMapGraph,
  flowIndex?: FlowIndex
): DocsV2ReferenceAllowlist {
  return {
    nodeIds: new Set(graph.nodes.map((node) => node.id)),
    flowNodeIds: new Set(flowIndex?.nodes.map((node) => node.id) ?? []),
    occurrenceIds: new Set(
      flowIndex?.componentStructures.flatMap((structure) =>
        structure.occurrences.map((occurrence) => occurrence.id)
      ) ?? []
    ),
  };
}

/**
 * Write-boundary allowlist for one owner document. Values are limited to
 * flows that contain at least one value owned by the document owner. This
 * still permits cross-component props and upstream selector/hook values, but
 * rejects arbitrary canonical ids copied from an unrelated page.
 */
export function buildDocsV2OwnerReferenceAllowlist(
  graph: ProjectMapGraph,
  flowIndex: FlowIndex | undefined,
  ownerNodeId: string
): DocsV2ReferenceAllowlist {
  const flowNodeIds = new Set<string>();
  const nodeIds = new Set([ownerNodeId]);
  if (flowIndex) {
    const ownerValueIds = new Set(flowIndex.nodes
      .filter((node) => node.ownerNodeId === ownerNodeId)
      .map((node) => node.id));
    for (const flow of flowIndex.flows) {
      if (!flow.nodeIds.some((nodeId) => ownerValueIds.has(nodeId))) continue;
      for (const nodeId of flow.nodeIds) flowNodeIds.add(nodeId);
    }
    for (const node of flowIndex.nodes) {
      if (!flowNodeIds.has(node.id) || !node.ownerNodeId) continue;
      nodeIds.add(node.ownerNodeId);
    }
  }

  const knownGraphIds = new Set(graph.nodes.map((node) => node.id));
  const scopedNodeIds = new Set([...nodeIds].filter((id) => knownGraphIds.has(id)));
  const occurrenceIds = new Set(flowIndex?.componentStructures
    .filter((structure) => scopedNodeIds.has(structure.componentNodeId))
    .flatMap((structure) => structure.occurrences.map((occurrence) => occurrence.id)) ?? []);
  return { nodeIds: scopedNodeIds, flowNodeIds, occurrenceIds };
}

export function validateDocsV2References(params: {
  parsed: ParsedDocsV2File;
  expectedOwnerNodeId: string;
  allowlist: DocsV2ReferenceAllowlist;
}): string[] {
  return validateDocsV2ReferenceDiagnostics(params).map(
    (diagnostic) => diagnostic.message
  );
}

export function validateDocsV2ReferenceDiagnostics(params: {
  parsed: ParsedDocsV2File;
  expectedOwnerNodeId: string;
  allowlist: DocsV2ReferenceAllowlist;
}): DocsV2ReferenceDiagnostic[] {
  const diagnostics: DocsV2ReferenceDiagnostic[] = [];
  if (params.parsed.frontmatter.owner !== params.expectedOwnerNodeId) {
    diagnostics.push({
      code: "unexpected-owner",
      message: `Frontmatter owner должен быть равен "${params.expectedOwnerNodeId}".`,
    });
  }
  if (!params.allowlist.nodeIds.has(params.expectedOwnerNodeId)) {
    diagnostics.push({
      code: "missing-owner-node",
      message: `Owner node "${params.expectedOwnerNodeId}" отсутствует в graph.`,
    });
  }

  for (const block of params.parsed.blocks) {
    for (const target of block.metadata.targets) {
      const known = target.type === "node"
        ? params.allowlist.nodeIds.has(target.id)
        : target.type === "flow-node"
          ? params.allowlist.flowNodeIds.has(target.id)
          : params.allowlist.occurrenceIds.has(target.id);
      if (!known) {
        diagnostics.push({
          code: "unknown-target",
          blockId: block.metadata.id,
          message:
            `Annotation "${block.metadata.id}" содержит неизвестный ` +
            `${target.type} target "${target.id}".`,
        });
      }
    }
  }
  return diagnostics;
}
