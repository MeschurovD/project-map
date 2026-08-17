import { e2eRoutes } from "./routes.js";
import { buildE2eEnrichment } from "./services/e2eEnrichmentService.js";
import { e2eSummaryRoute } from "./summaryRoute.js";
import type { ProjectMapServerModule } from "../../types.js";

export const e2eServerModule: ProjectMapServerModule = {
  id: "e2e",
  registerRoutes: ({ config }) => [e2eSummaryRoute(config), e2eRoutes(config)],
  buildEnrichment: buildE2eEnrichment,
};
