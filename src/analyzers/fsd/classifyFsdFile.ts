import type { ResolvedProjectMapConfig } from "../../config/types.js";
import type { FsdInfo } from "../../scanner/facts.js";

export function classifyFsdFile(filePath: string, config: ResolvedProjectMapConfig): FsdInfo {
  const parts = filePath.split("/").filter(Boolean);
  const sourceRootIndex = parts.indexOf(config.sourceRoot);
  const startIndex = sourceRootIndex >= 0 ? sourceRootIndex + 1 : 0;
  const layerIndex = parts.findIndex(
    (part, index) => index >= startIndex && config.fsd.layers.includes(part)
  );

  if (layerIndex < 0) {
    return {
      layer: "unknown",
      slice: null,
      segment: null,
    };
  }

  const layer = parts[layerIndex] ?? "unknown";

  if (layer === "app") {
    return {
      layer,
      slice: null,
      segment: parts[layerIndex + 1] ?? null,
    };
  }

  if (layer === "shared") {
    return {
      layer,
      slice: parts[layerIndex + 1] ?? null,
      segment: parts[layerIndex + 2] ?? null,
    };
  }

  return {
    layer,
    slice: parts[layerIndex + 1] ?? null,
    segment: parts[layerIndex + 2] ?? null,
  };
}
