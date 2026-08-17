import { docsRoutes } from "./routes.js";
import { buildDocsEnrichment } from "./services/docsEnrichmentService.js";
import type { ProjectMapServerModule } from "../../types.js";

export const docsServerModule: ProjectMapServerModule = {
  id: "docs",
  registerRoutes: ({ config }) => [docsRoutes(config)],
  buildEnrichment: buildDocsEnrichment,
};
