import { docsServerModule } from "./docs/server/index.js";
import { e2eServerModule } from "./e2e/server/index.js";
import type { ProjectMapServerModule } from "./types.js";

// Server-only registry: imported by the Node dev server. Keep this free of any
// React/UI imports so the CLI bundle stays server-only. The matching UI half
// is registered separately in ./uiRegistry.ts — add new modules to both.
export const projectMapServerModules: ProjectMapServerModule[] = [
  docsServerModule,
  e2eServerModule,
];
