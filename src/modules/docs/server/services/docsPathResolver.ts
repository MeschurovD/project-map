import path from "node:path";
import type { ProjectMapNode } from "../../../../graph/types.js";

/**
 * Legacy/v1 location. Kept as a compatibility fallback until an explicit
 * migration moves existing user-authored documents.
 */
export function resolveDocsPathForNode(node: Pick<ProjectMapNode, "file">): string | null {
  if (!node.file) return null;

  const parsed = path.posix.parse(node.file);
  return path.posix.join(parsed.dir, `${parsed.name}.docs.md`);
}

/**
 * Docs v2 location. A directory per source file avoids collisions when one
 * source owns several documentable graph nodes (for example a component and
 * its colocated hook).
 */
export function resolveV2DocsPathForNode(
  node: Pick<ProjectMapNode, "file" | "name">
): string | null {
  if (!node.file) return null;

  const parsed = path.posix.parse(node.file);
  const ownerName = sanitizeOwnerName(node.name);
  return path.posix.join(parsed.dir, `${parsed.name}.docs`, `${ownerName}.md`);
}

/** Read v2 first, then fall back to the existing colocated v1/legacy file. */
export function resolveDocsReadPathsForNode(
  node: Pick<ProjectMapNode, "file" | "name">
): string[] {
  const paths = [
    resolveV2DocsPathForNode(node),
    resolveDocsPathForNode(node),
  ].filter((docsPath): docsPath is string => Boolean(docsPath));

  return [...new Set(paths)];
}

function sanitizeOwnerName(name: string): string {
  const sanitized = name
    .normalize("NFKC")
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return sanitized || "node";
}
