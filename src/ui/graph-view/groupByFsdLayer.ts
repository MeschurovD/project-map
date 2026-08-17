import type { ProjectMapNode } from "../../graph/types.js";
import { FSD_FOCUS_GROUP_LAYERS, type FsdFocusGroupLayer } from "./viewTypes.js";

export type FsdLayerGroups = Record<FsdFocusGroupLayer, ProjectMapNode[]>;

export function groupByFsdLayer(nodes: ProjectMapNode[]): FsdLayerGroups {
  const groups: FsdLayerGroups = {
    widgets: [],
    features: [],
    entities: [],
    shared: [],
  };

  for (const node of nodes) {
    const layer = node.fsd?.layer;
    if (!isFocusGroupLayer(layer)) continue;
    groups[layer].push(node);
  }

  for (const layer of FSD_FOCUS_GROUP_LAYERS) {
    groups[layer].sort((left, right) => left.name.localeCompare(right.name));
  }

  return groups;
}

function isFocusGroupLayer(layer: string | undefined): layer is FsdFocusGroupLayer {
  return layer === "widgets" || layer === "features" || layer === "entities" || layer === "shared";
}
