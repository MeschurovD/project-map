import type { ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../../../graph/types.js";
import type { SourceCodeModalProps } from "../components/source/SourceCodeModal.js";

export type SourceResponse = {
  nodeId?: string;
  edgeId?: string;
  name?: string;
  type?: string;
  file?: string;
  language: string;
  content: string;
  startLine?: number;
  endLine?: number;
  mode: "full-file" | "snippet" | "evidence-code";
  evidence?: {
    line?: number;
    code?: string;
  };
};

export type SourceModalState = (SourceCodeModalProps & { content: string }) | null;

export async function fetchSource(url: string): Promise<SourceResponse> {
  const response = await fetch(url);
  const body = await response.json() as SourceResponse | { error?: string; message?: string };

  if (!response.ok) {
    const message = "message" in body && body.message ? body.message : "Cannot read source";
    throw new Error(message);
  }

  return body as SourceResponse;
}

export function sourceModalFromResponse(source: SourceResponse, fallbackTitle: string): SourceCodeModalProps & { content: string } {
  return {
    title: source.name ?? fallbackTitle,
    file: source.file,
    language: source.language,
    content: source.content,
    startLine: source.startLine,
    endLine: source.endLine,
    onClose: () => undefined,
  };
}

export function canViewNodeSource(graph: ProjectMapGraph, node: ProjectMapNode) {
  return Boolean(node.file) || graph.edges.some((edge) =>
    (edge.from === node.id || edge.to === node.id) &&
    edge.evidence.some((evidence) => Boolean(evidence.file || evidence.code))
  );
}

export function canViewEdgeUsage(edge: ProjectMapEdge) {
  return edge.evidence.some((evidence) => Boolean(evidence.file || evidence.code));
}
