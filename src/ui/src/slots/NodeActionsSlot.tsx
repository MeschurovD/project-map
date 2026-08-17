import type {
  MergedEnrichmentAnnotation,
  MergedNodeEnrichment,
} from "../../../modules/enrichmentTypes.js";
import { projectMapUiModules } from "../../../modules/uiRegistry.js";
import type {
  NodeActionContext,
  NodeActionRegistration,
} from "../../../modules/types.js";

export function NodeActionsSlot(props: {
  node: NodeActionContext["node"];
  graph: NodeActionContext["graph"];
  enrichment?: MergedNodeEnrichment[];
  annotations?: MergedEnrichmentAnnotation[];
}) {
  const context: NodeActionContext = {
    node: props.node,
    graph: props.graph,
    enrichment: props.enrichment ?? [],
    annotations: props.annotations ?? [],
  };
  const actions = projectMapUiModules
    .flatMap((module) => module.nodeActions ?? [])
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

function supportsAction(action: NodeActionRegistration, context: NodeActionContext) {
  return action.supportsNode ? action.supportsNode(context) : true;
}
