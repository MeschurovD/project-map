import { projectMapUiModules } from "../../../modules/uiRegistry.js";
import type { NodeDetailsPanelContext, NodeDetailsPanelRegistration } from "../../../modules/types.js";

export function NodeDetailsSlot(props: NodeDetailsPanelContext) {
  const panels = projectMapUiModules
    .flatMap((module) => module.nodeDetailsPanels ?? [])
    .filter((panel) => supportsPanel(panel, props))
    .sort((a, b) => a.order - b.order);

  return (
    <>
      {panels.map((panel) => {
        const Panel = panel.Component;
        return <Panel key={panel.id} {...props} />;
      })}
    </>
  );
}

function supportsPanel(panel: NodeDetailsPanelRegistration, context: NodeDetailsPanelContext) {
  return panel.supportsNode ? panel.supportsNode(context) : true;
}
