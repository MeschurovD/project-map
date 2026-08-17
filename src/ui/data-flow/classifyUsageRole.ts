import type { DataFlowUsage, DataFlowUsageRole } from "./valueFlowTypes.js";

export function classifyUsageRole(usage: DataFlowUsage): DataFlowUsageRole {
  const source = usage.sourceName.toLowerCase();
  const prop = usage.propName?.toLowerCase() ?? "";

  if (usage.usageKind === "conditionalRender") return "visibility";

  if (
    usage.usageKind === "eventHandler" ||
    source.startsWith("handle") ||
    source.startsWith("on") ||
    prop.startsWith("on")
  ) {
    return "handler";
  }

  if (
    source.includes("loading") ||
    source.includes("pending") ||
    prop.includes("loading") ||
    prop.includes("pending")
  ) {
    return "loading";
  }

  if (
    source.includes("error") ||
    source.includes("errored") ||
    prop.includes("error")
  ) {
    return "error";
  }

  if (
    source.includes("disabled") ||
    prop.includes("disabled") ||
    source.startsWith("can") ||
    source.startsWith("should")
  ) {
    return "availability";
  }

  if (
    source.includes("text") ||
    source.includes("title") ||
    source.includes("message") ||
    source.includes("label") ||
    prop.includes("text") ||
    prop.includes("title") ||
    prop.includes("message") ||
    prop.includes("label")
  ) {
    return "text";
  }

  return "data";
}
