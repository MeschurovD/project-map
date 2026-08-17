import type { MergedEnrichmentAnnotation } from "../../../modules/enrichmentTypes.js";
import { projectMapUiModules } from "../../../modules/uiRegistry.js";
import type {
  ValueActionContext,
  ValueDetailsRegistration,
} from "../../../modules/types.js";

export function ValueDetailsSlot(props: {
  ownerNode: ValueActionContext["ownerNode"];
  graph: ValueActionContext["graph"];
  flowNodeId: string;
  valueLabel: string;
  displayMode?: ValueActionContext["displayMode"];
  annotations?: MergedEnrichmentAnnotation[];
}) {
  const context = valueDetailsContext(props);
  const details = supportedValueDetails(context);

  if (details.length === 0) return null;
  return (
    <>
      {details.map((detail) => {
        const Details = detail.Component;
        return <Details key={detail.id} {...context} />;
      })}
    </>
  );
}

export function hasValueDetails(props: {
  ownerNode: ValueActionContext["ownerNode"];
  graph: ValueActionContext["graph"];
  flowNodeId: string;
  valueLabel: string;
  displayMode?: ValueActionContext["displayMode"];
  annotations?: MergedEnrichmentAnnotation[];
}) {
  return supportedValueDetails(valueDetailsContext(props)).length > 0;
}

function valueDetailsContext(props: {
  ownerNode: ValueActionContext["ownerNode"];
  graph: ValueActionContext["graph"];
  flowNodeId: string;
  valueLabel: string;
  displayMode?: ValueActionContext["displayMode"];
  annotations?: MergedEnrichmentAnnotation[];
}): ValueActionContext {
  return {
    ownerNode: props.ownerNode,
    graph: props.graph,
    flowNodeId: props.flowNodeId,
    valueLabel: props.valueLabel,
    displayMode: props.displayMode,
    annotations: props.annotations ?? [],
  };
}

function supportedValueDetails(context: ValueActionContext) {
  return projectMapUiModules
    .flatMap((module) => module.valueDetails ?? [])
    .filter((detail) => supportsDetails(detail, context))
    .sort((left, right) => left.order - right.order);
}

function supportsDetails(
  detail: ValueDetailsRegistration,
  context: ValueActionContext
) {
  return detail.supportsValue ? detail.supportsValue(context) : true;
}
