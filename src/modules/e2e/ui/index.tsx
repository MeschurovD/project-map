import { E2eCoverageWidget } from "./components/E2eCoverageWidget.js";
import { E2ePanel } from "./components/E2ePanel.js";
import type { ProjectMapUiModule } from "../../types.js";

export const e2eUiModule: ProjectMapUiModule = {
  id: "e2e",
  nodeDetailsPanels: [
    {
      id: "e2e.node-details",
      order: 30,
      supportsNode: ({ node }) => node.type === "page" || node.type === "component",
      Component: ({ node }) => <E2ePanel node={node} />,
    },
  ],
  sidebarWidgets: [
    {
      id: "e2e.coverage-summary",
      order: 10,
      Component: E2eCoverageWidget,
    },
  ],
};
