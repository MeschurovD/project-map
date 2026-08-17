import { docsUiModule } from "./docs/ui/index.js";
import { e2eUiModule } from "./e2e/ui/index.js";
import type { ProjectMapUiModule } from "./types.js";

// UI-only registry: imported by the browser bundle (React). Keep this free of
// any server/node imports. The matching server half is registered separately
// in ./registry.ts — add new modules to both.
export const projectMapUiModules: ProjectMapUiModule[] = [
  docsUiModule,
  e2eUiModule,
];
