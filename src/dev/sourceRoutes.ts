import type { ServerResponse } from "node:http";
import type { Connect } from "vite";
import { readGraph } from "./services/graphStore.js";
import { getLanguageByFile, readProjectFile } from "./services/sourceFileService.js";
import type { SourceResponse } from "./services/sourceTypes.js";
import {
  getEnclosingFunctionSnippet,
  getSnippetAroundLine,
} from "./services/snippetService.js";

type JsonBody = SourceResponse | { error: string; message?: string };
type EvidenceRequest = {
  file?: string;
  line?: number;
  code?: string;
  context?: "function";
};

export function sourceRoutes(projectRoot: string): Connect.NextHandleFunction {
  return async (request, response, next) => {
    if (!request.url?.startsWith("/api/source/")) {
      next();
      return;
    }

    if (
      request.method &&
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      !(request.method === "POST" && request.url.startsWith("/api/source/evidence"))
    ) {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const url = new URL(request.url, "http://project-map.local");

      if (url.pathname.startsWith("/api/source/node/")) {
        const nodeId = decodeRouteId(url.pathname, "/api/source/node/");
        sendJson(response, 200, await sourceForNode(projectRoot, nodeId));
        return;
      }

      if (url.pathname.startsWith("/api/source/edge/")) {
        const edgeId = decodeRouteId(url.pathname, "/api/source/edge/");
        sendJson(response, 200, await sourceForEdge(projectRoot, edgeId));
        return;
      }

      if (url.pathname === "/api/source/evidence") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }
        const evidence = await readJsonBody<EvidenceRequest>(request);
        sendJson(response, 200, await sourceForEvidence(projectRoot, evidence));
        return;
      }

      if (url.pathname === "/api/source/file") {
        const file = url.searchParams.get("path");
        if (!file) {
          sendJson(response, 400, { error: "Missing source file path" });
          return;
        }
        sendJson(response, 200, await sourceForFile(projectRoot, file));
        return;
      }

      next();
    } catch (error) {
      const statusCode = statusCodeForError(error);
      sendJson(response, statusCode, {
        error: statusCode === 404 ? "Source not found" : "Cannot read source",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

async function sourceForEvidence(projectRoot: string, evidence: EvidenceRequest): Promise<SourceResponse> {
  if (!evidence.file) {
    if (!evidence.code) {
      throw Object.assign(new Error("Evidence has no file or code"), { statusCode: 400 });
    }

    return {
      language: "plaintext",
      content: evidence.code,
      mode: "evidence-code",
      evidence: {
        ...(evidence.line ? { line: evidence.line } : {}),
        code: evidence.code,
      },
    };
  }

  const { content } = await readProjectFile({
    projectRoot,
    relativePath: evidence.file,
  });
  const snippet = evidence.context === "function"
    ? getEnclosingFunctionSnippet(content, evidence.line, evidence.file)
      ?? getSnippetAroundLine(content, evidence.line)
    : getSnippetAroundLine(content, evidence.line);

  return {
    file: evidence.file,
    language: getLanguageByFile(evidence.file),
    content: snippet.content,
    startLine: snippet.startLine,
    endLine: snippet.endLine,
    mode: evidence.line ? "snippet" : "full-file",
    evidence: {
      ...(evidence.line ? { line: evidence.line } : {}),
      ...(evidence.code ? { code: evidence.code } : {}),
    },
  };
}

async function sourceForNode(projectRoot: string, nodeId: string): Promise<SourceResponse> {
  const graph = await readGraph(projectRoot);
  const node = graph.nodes.find((entry) => entry.id === nodeId);

  if (!node) {
    throw Object.assign(new Error(`Node not found: ${nodeId}`), { statusCode: 404 });
  }

  const file = node.file ?? firstSourceFileForNode(graph, nodeId);

  if (!file) {
    throw Object.assign(new Error(`Node has no source file: ${nodeId}`), { statusCode: 400 });
  }

  const { content } = await readProjectFile({
    projectRoot,
    relativePath: file,
  });

  return {
    nodeId,
    name: node.name,
    type: node.type,
    file,
    language: getLanguageByFile(file),
    content,
    mode: "full-file",
  };
}

async function sourceForEdge(projectRoot: string, edgeId: string): Promise<SourceResponse> {
  const graph = await readGraph(projectRoot);
  const edge = graph.edges.find((entry) => entry.id === edgeId);

  if (!edge) {
    throw Object.assign(new Error(`Edge not found: ${edgeId}`), { statusCode: 404 });
  }

  const evidence = edge.evidence.find((entry) => entry.file) ?? edge.evidence[0];
  if (!evidence) {
    throw Object.assign(new Error(`Edge has no evidence: ${edgeId}`), { statusCode: 400 });
  }

  if (!evidence.file) {
    if (!evidence.code) {
      throw Object.assign(new Error(`Edge evidence has no file or code: ${edgeId}`), { statusCode: 400 });
    }

    return {
      edgeId,
      language: "plaintext",
      content: evidence.code,
      mode: "evidence-code",
      evidence: {
        ...(evidence.line ? { line: evidence.line } : {}),
        code: evidence.code,
      },
    };
  }

  const { content } = await readProjectFile({
    projectRoot,
    relativePath: evidence.file,
  });

  const snippet = getSnippetAroundLine(content, evidence.line);

  return {
    edgeId,
    file: evidence.file,
    language: getLanguageByFile(evidence.file),
    content: snippet.content,
    startLine: snippet.startLine,
    endLine: snippet.endLine,
    mode: evidence.line ? "snippet" : "full-file",
    evidence: {
      ...(evidence.line ? { line: evidence.line } : {}),
      ...(evidence.code ? { code: evidence.code } : {}),
    },
  };
}

async function sourceForFile(projectRoot: string, file: string): Promise<SourceResponse> {
  const { content } = await readProjectFile({
    projectRoot,
    relativePath: file,
  });

  return {
    file,
    language: getLanguageByFile(file),
    content,
    mode: "full-file",
  };
}

function decodeRouteId(pathname: string, prefix: string) {
  const encoded = pathname.slice(prefix.length);
  if (!encoded) throw Object.assign(new Error("Missing source id"), { statusCode: 400 });
  return decodeURIComponent(encoded);
}

function firstSourceFileForNode(graph: Awaited<ReturnType<typeof readGraph>>, nodeId: string) {
  for (const edge of graph.edges) {
    if (edge.from !== nodeId && edge.to !== nodeId) continue;

    const evidence = edge.evidence.find((entry) => entry.file);
    if (evidence?.file) return evidence.file;
  }

  return undefined;
}

function statusCodeForError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }

  return 400;
}

async function readJsonBody<T>(request: Connect.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {} as T;
  return JSON.parse(raw) as T;
}

function sendJson(response: ServerResponse, statusCode: number, body: JsonBody) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
