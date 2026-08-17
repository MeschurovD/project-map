import { classifyUsageRole } from "./classifyUsageRole.js";
import type { DataFlowTargetGroup, DataFlowUsage, DataFlowUsageRole } from "./valueFlowTypes.js";

const ROLE_ORDER: DataFlowUsageRole[] = [
  "data",
  "loading",
  "error",
  "availability",
  "visibility",
  "text",
  "handler",
  "event",
  "unknown",
];

export function groupUsagesByTarget(usages: DataFlowUsage[]): DataFlowTargetGroup[] {
  const groups = new Map<string, DataFlowTargetGroup>();

  for (const usage of usages) {
    const key =
      usage.targetNodeId ??
      usage.targetName ??
      `${usage.usageKind}:unknown`;

    if (!groups.has(key)) {
      groups.set(key, {
        id: `target:${key}`,
        targetName: usage.targetName ?? "unknown",
        targetNodeId: usage.targetNodeId,
        targetType: usage.targetType ?? "unknown",
        usages: [],
        roles: createEmptyRoles(),
        stats: createEmptyStats(),
      });
    }

    const group = groups.get(key)!;
    group.usages.push(usage);

    const role = classifyUsageRole(usage);
    group.roles[role].push(usage);
    group.stats.total += 1;
    group.stats[role] += 1;
  }

  return [...groups.values()].sort(sortTargetGroups);
}

export function createEmptyRoles(): Record<DataFlowUsageRole, DataFlowUsage[]> {
  return {
    data: [],
    loading: [],
    error: [],
    availability: [],
    visibility: [],
    text: [],
    handler: [],
    event: [],
    unknown: [],
  };
}

export function createEmptyStats(): DataFlowTargetGroup["stats"] {
  return {
    total: 0,
    data: 0,
    loading: 0,
    error: 0,
    availability: 0,
    visibility: 0,
    text: 0,
    handler: 0,
    event: 0,
    unknown: 0,
  };
}

function sortTargetGroups(a: DataFlowTargetGroup, b: DataFlowTargetGroup) {
  const byType = targetTypeRank(a.targetType) - targetTypeRank(b.targetType);
  if (byType !== 0) return byType;

  const byUsageCount = b.stats.total - a.stats.total;
  if (byUsageCount !== 0) return byUsageCount;

  return a.targetName.localeCompare(b.targetName);
}

function targetTypeRank(type: DataFlowTargetGroup["targetType"]) {
  if (type === "component") return 0;
  if (type === "hook") return 1;
  if (type === "function") return 2;
  if (type === "action") return 3;
  if (type === "condition") return 4;
  return 5;
}
