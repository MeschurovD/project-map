import { DocsPanel } from "./components/DocsPanel.js";
import { DocsNodeAction } from "./components/DocsNodeAction.js";
import { DocsValueAction } from "./components/DocsValueAction.js";
import { DocsValueDetails } from "./components/DocsValueDetails.js";
import { DocsCoverageWidget } from "./components/DocsCoverageWidget.js";
import { DocsQueueWidget } from "./queue/DocsQueueWidget.js";
import type { ProjectMapUiModule } from "../../types.js";

export const docsUiModule: ProjectMapUiModule = {
  id: "docs",
  nodeDetailsPanels: [
    {
      id: "docs.node-details",
      order: 20,
      supportsNode: ({ node }) => Boolean(node.file),
      Component: ({ node }) => <DocsPanel node={node} />,
    },
  ],
  nodeActions: [
    {
      id: "docs.node-action",
      order: 20,
      supportsNode: ({ node }) =>
        Boolean(node.file) &&
        (node.type === "page" || node.type === "component" || node.type === "hook"),
      Component: DocsNodeAction,
    },
  ],
  valueActions: [
    {
      id: "docs.value-action",
      order: 20,
      supportsValue: ({ ownerNode }) => Boolean(ownerNode.file),
      Component: DocsValueAction,
    },
  ],
  valueDetails: [
    {
      id: "docs.value-details",
      order: 20,
      supportsValue: ({ annotations }) => annotations.some((annotation) =>
        annotation.moduleId === "docs" &&
        ["value-meaning", "contract", "business-rule", "role-rule", "gotcha", "open-question"]
          .includes(annotation.kind)
      ),
      Component: DocsValueDetails,
    },
  ],
  sidebarWidgets: [
    {
      id: "docs.coverage-summary",
      order: 20,
      Component: DocsCoverageWidget,
    },
  ],
  globalWidgets: [
    {
      id: "docs.queue",
      Component: DocsQueueWidget,
    },
  ],
};
