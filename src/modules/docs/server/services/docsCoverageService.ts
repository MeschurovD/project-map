import { globby } from "globby";
import type { FlowIndex } from "../../../../flow/types.js";
import type { ProjectMapGraph, ProjectMapNode } from "../../../../graph/types.js";
import type {
  DocsAuditDocument,
  DocsAuditIssue,
  DocsCoverageNode,
  DocsCoverageResponse,
} from "../../shared/apiTypes.js";
import {
  parseDocsFile,
  validateDocsFile,
} from "./docsFileFormat.js";
import { readDocsFile } from "./docsFileService.js";
import {
  resolveDocsReadPathsForNode,
  resolveV2DocsPathForNode,
} from "./docsPathResolver.js";
import { getV2StaleReasons, isStale } from "./docsStatusService.js";
import {
  isV2FullyReviewed,
  parseDocsV2File,
} from "./docsV2FileFormat.js";
import {
  buildDocsV2OwnerReferenceAllowlist,
  validateDocsV2ReferenceDiagnostics,
} from "./docsV2ReferenceValidator.js";

const DOCUMENTABLE_NODE_TYPES = new Set(["page", "component", "hook"]);

/** Audit the complete docs corpus and derive node coverage from canonical owners. */
export async function buildDocsCoverage(params: {
  graph: ProjectMapGraph;
  flowIndex?: FlowIndex;
  projectRoot: string;
}): Promise<DocsCoverageResponse> {
  const nodes = params.graph.nodes.filter(isDocumentableNode);
  const nodeById = new Map(params.graph.nodes.map((node) => [node.id, node]));
  const paths = await discoverDocsPaths(params.projectRoot);
  const documents = await Promise.all(
    paths.map((docsPath) =>
      auditDocument({
        docsPath,
        nodeById,
        graph: params.graph,
        flowIndex: params.flowIndex,
        projectRoot: params.projectRoot,
      })
    )
  );
  const documentByPath = new Map(documents.map((document) => [document.path, document]));
  const coverageNodes = nodes.map((node) =>
    buildNodeCoverage(node, documentByPath)
  );

  return {
    summary: {
      totalNodes: coverageNodes.length,
      documentedNodes: coverageNodes.filter((node) => node.documented).length,
      freshNodes: coverageNodes.filter((node) => node.fresh).length,
      reviewedNodes: coverageNodes.filter((node) => node.reviewed).length,
      missingNodes: coverageNodes.filter((node) => !node.documented).length,
      invalidDocuments: documents.filter((document) => document.invalid).length,
      orphanedDocuments: documents.filter((document) => document.orphaned).length,
    },
    nodes: coverageNodes,
    documents,
  };
}

export function listStaleV2Docs(
  coverage: DocsCoverageResponse
): Array<{ nodeId: string; nodeName: string; docsPath: string }> {
  return coverage.nodes.flatMap((node) =>
    node.documented &&
    !node.fresh &&
    node.documentFormat === "structured-v2" &&
    node.documentPath
      ? [{
          nodeId: node.nodeId,
          nodeName: node.nodeName,
          docsPath: node.documentPath,
        }]
      : []
  );
}

async function discoverDocsPaths(projectRoot: string) {
  return globby(["**/*.docs.md", "**/*.docs/*.md"], {
    cwd: projectRoot,
    onlyFiles: true,
    unique: true,
    ignore: [
      ".git/**",
      ".project-map/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
    ],
  });
}

async function auditDocument(params: {
  docsPath: string;
  nodeById: Map<string, ProjectMapNode>;
  graph: ProjectMapGraph;
  flowIndex?: FlowIndex;
  projectRoot: string;
}): Promise<DocsAuditDocument> {
  const content = await readDocsFile(params.projectRoot, params.docsPath);
  const parsedV2 = parseDocsV2File(content);
  if (parsedV2) {
    const ownerNodeId = parsedV2.frontmatter.owner;
    const ownerNode = ownerNodeId
      ? params.nodeById.get(ownerNodeId)
      : undefined;
    const issues: DocsAuditIssue[] = parsedV2.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      annotationId: diagnostic.blockId,
    }));
    if (ownerNodeId) {
      issues.push(
        ...validateDocsV2ReferenceDiagnostics({
          parsed: parsedV2,
          expectedOwnerNodeId: ownerNodeId,
          allowlist: buildDocsV2OwnerReferenceAllowlist(
            params.graph,
            params.flowIndex,
            ownerNodeId
          ),
        }).map((diagnostic) => ({
          code: diagnostic.code,
          message: diagnostic.message,
          annotationId: diagnostic.blockId,
        }))
      );
    }
    if (ownerNode && !isDocumentableNode(ownerNode)) {
      issues.push({
        code: "unsupported-owner",
        message: `Owner node "${ownerNode.id}" не поддерживает документацию.`,
      });
    }
    const orphaned = issues.some((issue) =>
      issue.code === "missing-owner-node" || issue.code === "unknown-target"
    );
    const staleReasons = ownerNode
      ? await getV2StaleReasons(parsedV2, params.projectRoot)
      : [];
    issues.push(...staleReasons.map((message) => ({
      code: "stale-source",
      message,
    })));
    return {
      path: params.docsPath,
      format: "structured-v2",
      ownerNodeId,
      ownerNodeName: ownerNode?.name,
      stale: staleReasons.length > 0,
      reviewed: isV2FullyReviewed(parsedV2),
      invalid: issues.some((issue) =>
        issue.code !== "stale-source" &&
        issue.code !== "unknown-target" &&
        issue.code !== "missing-owner-node"
      ),
      orphaned,
      issues,
    };
  }

  const parsed = parseDocsFile(content);
  if (parsed.kind === "legacy") {
    return {
      path: params.docsPath,
      format: "legacy",
      stale: false,
      reviewed: false,
      invalid: true,
      orphaned: false,
      issues: [{
        code: "missing-owner",
        message: "Legacy Markdown не содержит canonical owner и не учитывается в coverage.",
      }],
    };
  }

  const ownerNodeId = parsed.frontmatter.node;
  const ownerNode = ownerNodeId
    ? params.nodeById.get(ownerNodeId)
    : undefined;
  const orphaned = Boolean(ownerNodeId && !ownerNode);
  const issues: DocsAuditIssue[] = [];
  if (!ownerNodeId) {
    issues.push({
      code: "missing-owner",
      message: "Structured v1 документ не содержит frontmatter node.",
    });
  } else if (!ownerNode) {
    issues.push({
      code: "missing-owner-node",
      message: `Owner node "${ownerNodeId}" отсутствует в graph.`,
    });
  } else {
    issues.push(
      ...validateDocsFile(parsed, {
        nodeId: ownerNode.id,
        nodeType: ownerNode.type,
      }).map((message) => ({ code: "invalid-v1-document", message }))
    );
    if (!isDocumentableNode(ownerNode)) {
      issues.push({
        code: "unsupported-owner",
        message: `Owner node "${ownerNode.id}" не поддерживает документацию.`,
      });
    }
  }
  const stale = ownerNode?.file
    ? await isStale(parsed, params.projectRoot, ownerNode.file)
    : false;
  if (stale) {
    issues.push({
      code: "stale-source",
      message: `Изменился source-файл: ${ownerNode!.file}`,
    });
  }
  return {
    path: params.docsPath,
    format: "structured",
    ownerNodeId,
    ownerNodeName: ownerNode?.name,
    stale,
    reviewed: parsed.frontmatter.reviewed === true,
    invalid: issues.some((issue) =>
      issue.code !== "stale-source" && issue.code !== "missing-owner-node"
    ),
    orphaned,
    issues,
  };
}

function buildNodeCoverage(
  node: ProjectMapNode,
  documentByPath: Map<string, DocsAuditDocument>
): DocsCoverageNode {
  const expectedPath = resolveV2DocsPathForNode(node)!;
  const document = resolveDocsReadPathsForNode(node)
    .map((docsPath) => documentByPath.get(docsPath))
    .find((entry): entry is DocsAuditDocument => Boolean(entry));
  if (!document) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      expectedPath,
      documented: false,
      fresh: false,
      reviewed: false,
      issues: [],
    };
  }

  const ownerMatches = document.ownerNodeId === node.id;
  const usable = ownerMatches && !document.invalid && !document.orphaned;
  const issues = [...document.issues];
  if (!ownerMatches) {
    issues.unshift({
      code: "owner-mismatch",
      message: document.ownerNodeId
        ? `Файл документирует "${document.ownerNodeId}", а не "${node.id}".`
        : "Файл не содержит canonical owner.",
    });
  }
  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    expectedPath,
    documentPath: document.path,
    documentFormat: document.format,
    documented: usable,
    fresh: usable && !document.stale,
    reviewed: usable && document.reviewed,
    issues,
  };
}

function isDocumentableNode(
  node: ProjectMapNode
): node is ProjectMapNode & { file: string } {
  return Boolean(node.file) && DOCUMENTABLE_NODE_TYPES.has(node.type);
}
