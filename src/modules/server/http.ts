import type { IncomingMessage, ServerResponse } from "node:http";

export function splitNodeRoute(rest: string) {
  const slashIndex = rest.lastIndexOf("/");
  if (slashIndex === -1) return [rest, ""] as const;
  return [rest.slice(0, slashIndex), rest.slice(slashIndex + 1)] as const;
}

export function ensureMethod(request: IncomingMessage, method: string) {
  if (request.method !== method) {
    throw Object.assign(new Error("Method not allowed"), { statusCode: 405 });
  }
}

export function decodeRouteId(pathname: string, prefix: string) {
  const encoded = pathname.slice(prefix.length);
  if (!encoded) throw Object.assign(new Error("Missing route id"), { statusCode: 400 });
  return decodeURIComponent(encoded);
}

export async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function statusCodeForError(error: unknown) {
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
