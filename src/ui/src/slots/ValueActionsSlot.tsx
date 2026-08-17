import type { MergedEnrichmentAnnotation } from "../../../modules/enrichmentTypes.js";
import { projectMapUiModules } from "../../../modules/uiRegistry.js";
import type {
  ValueActionContext,
  ValueActionRegistration,
} from "../../../modules/types.js";

export function ValueActionsSlot(props: {
  ownerNode: ValueActionContext["ownerNode"];
  graph: ValueActionContext["graph"];
  flowNodeId: string;
  valueLabel: string;
  annotations?: MergedEnrichmentAnnotation[];
}) {
  const context: ValueActionContext = {
    ownerNode: props.ownerNode,
    graph: props.graph,
    flowNodeId: props.flowNodeId,
    valueLabel: props.valueLabel,
    annotations: props.annotations ?? [],
  };
  const actions = projectMapUiModules
    .flatMap((module) => module.valueActions ?? [])
    .filter((action) => supportsAction(action, context))
    .sort((left, right) => left.order - right.order);

  if (actions.length === 0) return null;
  return (
    <>
      {actions.map((action) => {
        const Action = action.Component;
        return <Action key={action.id} {...context} />;
      })}
    </>
  );
}

function supportsAction(
  action: ValueActionRegistration,
  context: ValueActionContext
) {
  return action.supportsValue ? action.supportsValue(context) : true;
}
