import type { Connect } from "vite";
import type { ResolvedProjectMapConfig } from "../../../config/types.js";
import { readGraph } from "../../../dev/services/graphStore.js";
import { ensureMethod, sendJson, statusCodeForError } from "../../server/http.js";
import { buildE2eCoverageSummary } from "./services/e2eEnrichmentService.js";

/** GET /api/e2e/summary — page coverage for the sidebar widget. */
export function e2eSummaryRoute(config: ResolvedProjectMapConfig): Connect.NextHandleFunction {
  return async (request, response, next) => {
    if (!request.url?.startsWith("/api/e2e/summary")) {
      next();
      return;
    }

    try {
      ensureMethod(request, "GET");
      const graph = await readGraph(config.projectRoot);
      sendJson(response, 200, await buildE2eCoverageSummary(graph, config.projectRoot));
    } catch (error) {
      sendJson(response, statusCodeForError(error), {
        error: "E2E summary failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
