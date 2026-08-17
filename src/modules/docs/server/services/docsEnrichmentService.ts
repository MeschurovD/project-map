import type {
  EnrichmentAnnotation,
  EnrichmentBadge,
  EnrichmentSection,
  GraphEnrichment,
  NodeEnrichment,
} from "../../../enrichmentTypes.js";
import type { EnrichmentContext } from "../../../types.js";
import { findSection, parseDocsFile, type ParsedDocsFile } from "./docsFileFormat.js";
import {
  parseDocsV2File,
  isV2FullyReviewed,
  type DocsV2Block,
  type ParsedDocsV2File,
} from "./docsV2FileFormat.js";
import { readDocsFile } from "./docsFileService.js";
import { resolveDocsReadPathsForNode } from "./docsPathResolver.js";
import { getV2StaleReasons, isStale } from "./docsStatusService.js";

// Turns colocated .docs.md files into graph enrichment (docs/16). Structured
// files contribute the Summary as the card caption plus per-section panels;
// legacy files (no frontmatter) only get a "docs" badge and stay readable in
// the modal. Broken files must never break the overlay — they degrade to the
// legacy treatment.

type DocsFileInfo = {
  parsed: ParsedDocsFile;
  v2: ParsedDocsV2File | null;
  stale: boolean;
};

/** Section titles surfaced as NodeDetails panels, in display order. */
const SECTION_TITLES = ["Contract", "Business rules", "Scenarios", "User flows", "Roles / permissions", "Gotchas", "Open questions"];

export async function buildDocsEnrichment(context: EnrichmentContext): Promise<GraphEnrichment> {
  const docsPathsByNodeId = new Map<string, string[]>();
  const sourceFileByDocsPath = new Map<string, string>();
  for (const node of context.graph.nodes) {
    const docsPaths = resolveDocsReadPathsForNode(node);
    if (docsPaths.length === 0 || !node.file) continue;
    docsPathsByNodeId.set(node.id, docsPaths);
    for (const docsPath of docsPaths) {
      sourceFileByDocsPath.set(docsPath, node.file);
    }
  }

  // Many nodes share a source file (component + its hooks): read and parse
  // each docs file once.
  const infoByPath = new Map<string, DocsFileInfo>();
  for (const [docsPath, sourceFile] of sourceFileByDocsPath) {
    const content = await readDocsFileIfPresent(context.projectRoot, docsPath);
    if (content === null) continue;
    const parsed = parseDocsFile(content);
    const v2 = parseDocsV2File(content);
    infoByPath.set(docsPath, {
      parsed,
      v2,
      stale: v2
        ? (await getV2StaleReasons(v2, context.projectRoot)).length > 0
        : await isStale(parsed, context.projectRoot, sourceFile),
    });
  }

  const nodes: NodeEnrichment[] = [];
  const selectedPaths = new Set<string>();
  for (const [nodeId, docsPaths] of docsPathsByNodeId) {
    const docsPath = docsPaths.find((candidate) => infoByPath.has(candidate));
    if (!docsPath) continue;
    selectedPaths.add(docsPath);
    const info = infoByPath.get(docsPath);
    if (!info) continue;
    const enrichment = nodeEnrichment(nodeId, info);
    if (enrichment) nodes.push(enrichment);
  }

  const annotations = [...selectedPaths].flatMap((docsPath) => {
    const info = infoByPath.get(docsPath);
    if (!info) return [];
    return info.v2
      ? v2Annotations(info.v2, docsPath, info.stale)
      : v1Annotations(info.parsed, docsPath, info.stale);
  });

  return { nodes, annotations };
}

function nodeEnrichment(nodeId: string, info: DocsFileInfo): NodeEnrichment | null {
  if (info.v2) return v2NodeEnrichment(nodeId, info);

  const badges: EnrichmentBadge[] = [{ id: "docs", label: "docs", tone: "info" }];
  if (info.parsed.kind === "legacy") return { nodeId, badges };

  // File-level facts apply to every node sharing the source file…
  if (info.stale) badges.push({ id: "docs-stale", label: "stale", tone: "warn" });
  if (info.parsed.frontmatter.reviewed === true) {
    badges.push({ id: "docs-reviewed", label: "reviewed", tone: "ok" });
  }

  // …but the written content describes one specific node: summary, gotchas
  // and sections attach only to the node named in the frontmatter.
  if (info.parsed.frontmatter.node !== nodeId) return { nodeId, badges };

  const gotchas = findSection(info.parsed.sections, "Gotchas");
  if (gotchas && !gotchas.empty) {
    badges.push({ id: "docs-gotchas", label: "gotchas", tone: "warn" });
  }

  return {
    nodeId,
    badges,
    summary: info.parsed.summary ?? undefined,
    sections: enrichmentSections(info.parsed),
  };
}

function v2NodeEnrichment(nodeId: string, info: DocsFileInfo): NodeEnrichment | null {
  const parsed = info.v2;
  if (!parsed || parsed.frontmatter.owner !== nodeId) return null;

  const badges: EnrichmentBadge[] = [{
    id: "docs",
    label: "docs",
    tone: "info",
  }];
  if (info.stale) {
    badges.push({ id: "docs-stale", label: "stale", tone: "warn" });
  }
  if (isV2FullyReviewed(parsed)) {
    badges.push({ id: "docs-reviewed", label: "reviewed", tone: "ok" });
  }
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    badges.push({ id: "docs-invalid", label: "invalid", tone: "warn" });
  }

  const nodeBlocks = parsed.blocks.filter((block) =>
    block.metadata.targets.some((target) => target.type === "node" && target.id === nodeId)
  );
  if (nodeBlocks.some((block) => block.metadata.kind === "gotcha")) {
    badges.push({ id: "docs-gotchas", label: "gotchas", tone: "warn" });
  }
  const summary = nodeBlocks.find((block) => block.metadata.kind === "summary");
  const sections = nodeBlocks
    .filter((block) => block.metadata.kind !== "summary")
    .map(v2Section);

  return {
    nodeId,
    badges,
    summary: summary?.markdown,
    sections: sections.length > 0 ? sections : undefined,
  };
}

function v2Annotations(
  parsed: ParsedDocsV2File,
  documentId: string,
  stale: boolean
): EnrichmentAnnotation[] {
  if (!parsed.frontmatter.owner) return [];
  return parsed.blocks.map((block) => ({
    id: `${documentId}:${block.metadata.id}`,
    ownerNodeId: parsed.frontmatter.owner!,
    kind: block.metadata.kind,
    targets: block.metadata.targets,
    summary: block.metadata.summary,
    valueCategory: block.metadata.valueCategory,
    markdown: block.markdown,
    confidence: block.metadata.confidence,
    review: (block.metadata.review ?? parsed.frontmatter.review) === "reviewed"
      ? "reviewed"
      : "generated",
    stale,
    documentId,
    propagation: docsPropagation(block.metadata.kind),
  }));
}

function docsPropagation(kind: string): EnrichmentAnnotation["propagation"] {
  if (kind === "value-meaning" || kind === "contract") return "identity";
  if (
    kind === "business-rule" ||
    kind === "role-rule" ||
    kind === "gotcha" ||
    kind === "open-question"
  ) {
    return "context";
  }
  return undefined;
}

/**
 * Read-only compatibility projection: fixed v1 sections become node-targeted
 * annotations. Identifier tags stay inside Markdown until a future resolver
 * can map them to canonical flow-node ids without ambiguity.
 */
function v1Annotations(
  parsed: ParsedDocsFile,
  documentId: string,
  stale: boolean
): EnrichmentAnnotation[] {
  if (parsed.kind !== "structured" || !parsed.frontmatter.node) return [];

  return parsed.sections.flatMap((section) => {
    if (section.empty || !section.markdown) return [];
    const sectionId = section.title
      .toLowerCase()
      .replace(/[^a-z]+/g, "-")
      .replace(/^-|-$/g, "");
    return [{
      id: `${documentId}:${sectionId}`,
      ownerNodeId: parsed.frontmatter.node!,
      kind: V1_SECTION_KINDS[section.title.toLowerCase()] ?? sectionId,
      targets: [{ type: "node", id: parsed.frontmatter.node! }],
      markdown: section.markdown,
      review: parsed.frontmatter.reviewed ? "reviewed" : "generated",
      stale,
      documentId,
    }];
  });
}

function v2Section(block: DocsV2Block): EnrichmentSection {
  return {
    id: block.metadata.id,
    title: V2_SECTION_TITLES[block.metadata.kind] ?? block.metadata.kind,
    markdown: block.markdown,
  };
}

const V2_SECTION_TITLES: Record<string, string> = {
  contract: "Contract",
  "business-rule": "Business rule",
  scenario: "Scenario",
  "user-flow": "User flow",
  "role-rule": "Role / permission",
  "value-meaning": "Value meaning",
  gotcha: "Gotcha",
  "open-question": "Open question",
};

const V1_SECTION_KINDS: Record<string, string> = {
  summary: "summary",
  contract: "contract",
  "business rules": "business-rule",
  scenarios: "scenario",
  "user flows": "user-flow",
  "roles / permissions": "role-rule",
  gotchas: "gotcha",
  "open questions": "open-question",
};

function enrichmentSections(parsed: ParsedDocsFile): EnrichmentSection[] | undefined {
  if (parsed.kind === "legacy") return undefined;

  const sections: EnrichmentSection[] = [];
  for (const title of SECTION_TITLES) {
    const section = findSection(parsed.sections, title);
    if (!section || section.empty || !section.markdown) continue;
    sections.push({
      id: title.toLowerCase().replace(/[^a-z]+/g, "-"),
      title,
      markdown: section.markdown,
    });
  }
  return sections.length > 0 ? sections : undefined;
}

async function readDocsFileIfPresent(projectRoot: string, docsPath: string) {
  try {
    return await readDocsFile(projectRoot, docsPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
