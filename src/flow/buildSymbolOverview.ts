import type {
  SymbolContract,
  SymbolContractOriginEdge,
  SymbolContractStep,
  SymbolContractValue,
} from "./queries.js";
import type { FlowValueSemantics } from "./types.js";

export type SymbolValueRole = "pass-through" | "derived" | "combined" | "constant" | "unknown";
export type SymbolConsumerLevel = "direct" | "downstream";

export type SymbolOverviewValue = {
  id: string;
  flowId: string;
  flowNodeId: string;
  name: string;
  valueType?: string;
  role: SymbolValueRole;
  transformation?: FlowValueSemantics["transformation"];
  inputs: SymbolContractStep[];
  origin: SymbolContractStep[];
  originEdges: SymbolContractOriginEdge[];
  originSummary: SymbolContractStep[];
  directConsumers: SymbolContractStep[];
  downstreamConsumers: SymbolContractStep[];
  issueCount: number;
  traced: boolean;
};

export type SymbolFlowStory = {
  id: string;
  consumerId?: string;
  consumerName?: string;
  sources: SymbolContractStep[];
  outputs: SymbolOverviewValue[];
  directConsumers: SymbolContractStep[];
  downstreamConsumers: SymbolContractStep[];
  issueCount: number;
  traced: boolean;
};

export type SymbolConsumerUsage = {
  id: string;
  valueId: string;
  valueName: string;
  flowId: string;
  target: SymbolContractStep;
};

export type SymbolConsumerGroup = {
  id: string;
  name: string;
  level: SymbolConsumerLevel;
  usages: SymbolConsumerUsage[];
};

export type SymbolOverview = {
  symbolId: string;
  symbolName: string;
  symbolType: SymbolContract["symbol"]["type"];
  behavior: "read-only" | "effectful";
  stats: {
    dependenciesCount: number;
    resultsCount: number;
    consumersCount: number;
    effectsCount: number;
    issueCount: number;
    tracedResultsCount: number;
  };
  stories: SymbolFlowStory[];
  values: SymbolOverviewValue[];
  consumerGroups: SymbolConsumerGroup[];
};

/** Build the answer-oriented symbol projection without changing canonical flow facts. */
export function buildSymbolOverview(contract: SymbolContract): SymbolOverview {
  const valuesByGroup = new Map(contract.groups.map((group) => [group.key, group.values]));
  const resultValues = valuesByGroup.get("results") ?? [];
  const values = resultValues.map(overviewValue);
  const consumerGroups = buildConsumerGroups(resultValues);
  const stories = buildStories(values);

  return {
    symbolId: contract.symbol.id,
    symbolName: contract.symbol.name,
    symbolType: contract.symbol.type,
    behavior: contract.effects.length > 0 ? "effectful" : "read-only",
    stats: {
      dependenciesCount:
        (valuesByGroup.get("inputs")?.length ?? 0) +
        (valuesByGroup.get("reads")?.length ?? 0),
      resultsCount: resultValues.length,
      consumersCount: new Set(consumerGroups.flatMap((group) =>
        group.usages.map((usage) => usage.target.id)
      )).size,
      effectsCount: contract.effects.length,
      issueCount: contract.stats.issueCount,
      tracedResultsCount: values.filter((value) => value.traced).length,
    },
    stories,
    values,
    consumerGroups,
  };
}

function overviewValue(value: SymbolContractValue): SymbolOverviewValue {
  return {
    id: value.id,
    flowId: value.flowId,
    flowNodeId: value.flowNodeId,
    name: value.name,
    valueType: value.valueSemantics?.type,
    role: valueRole(value),
    transformation: value.valueSemantics?.transformation,
    inputs: value.derivationInputs,
    origin: value.origin,
    originEdges: value.originEdges,
    originSummary: summarizeOrigin(value.origin),
    directConsumers: value.directConsumers,
    downstreamConsumers: value.downstreamConsumers,
    issueCount: value.issues.length,
    traced: (
      value.coverage.origin === "proven" || value.coverage.origin === "boundary"
    ) && value.issues.length === 0,
  };
}

/** Keep the default answer compact while preserving the full evidence path. */
function summarizeOrigin(origin: SymbolContractStep[]): SymbolContractStep[] {
  if (origin.length <= 2) return origin;

  const initial = origin.find((step) => step.kind === "api")
    ?? origin.find((step) => step.kind === "async-operation")
    ?? origin[0];
  const stateField = origin.find((step) => step.kind === "state-field");
  const summary = uniqueSteps([initial, stateField].filter((step): step is SymbolContractStep => Boolean(step)));

  if (summary.length === 1) {
    const last = origin.at(-1);
    if (last && last.id !== summary[0]?.id) summary.push(last);
  }
  return summary;
}

function valueRole(value: SymbolContractValue): SymbolValueRole {
  if (value.valueSemantics?.transformation.kind === "constant") return "constant";
  if (value.derivationInputs.length > 1) return "combined";
  if (value.valueSemantics?.transformation.kind === "direct") return "pass-through";
  if (value.valueSemantics) return "derived";
  if (value.derivationInputs.length === 0) return "unknown";
  const input = value.derivationInputs[0]!;
  return normalizeName(input.path ?? input.name) === normalizeName(value.path ?? value.name)
    ? "pass-through"
    : "derived";
}

function buildStories(values: SymbolOverviewValue[]): SymbolFlowStory[] {
  const stories = new Map<string, SymbolFlowStory>();
  for (const value of values) {
    const storyConsumers = value.downstreamConsumers.length > 0
      ? value.downstreamConsumers
      : value.directConsumers;
    const targets = storyConsumers.length > 0 ? storyConsumers : [undefined];

    for (const target of targets) {
      const consumerId = target?.ownerNodeId ?? target?.id;
      const consumerName = target?.ownerName ?? ownerFromQualifiedName(target?.path ?? target?.name);
      const key = consumerId ?? "unresolved";
      const current = stories.get(key) ?? {
        id: `story:${key}`,
        consumerId,
        consumerName,
        sources: [],
        outputs: [],
        directConsumers: [],
        downstreamConsumers: [],
        issueCount: 0,
        traced: true,
      };
      const isNewOutput = !current.outputs.some((output) => output.id === value.id);
      if (isNewOutput) current.outputs.push(target?.flowId ? { ...value, flowId: target.flowId } : value);
      current.sources = uniqueSteps([
        ...current.sources,
        ...(value.inputs.length > 0 ? value.inputs : nearestOrigins(value.origin)),
      ]);
      current.directConsumers = uniqueSteps([...current.directConsumers, ...value.directConsumers]);
      current.downstreamConsumers = uniqueSteps([
        ...current.downstreamConsumers,
        ...value.downstreamConsumers.filter((consumer) =>
          (consumer.ownerNodeId ?? consumer.id) === key
        ),
      ]);
      if (isNewOutput) {
        current.issueCount += value.issueCount;
        current.traced = current.traced && value.traced;
      }
      stories.set(key, current);
    }
  }

  return [...stories.values()]
    .map((story) => ({
      ...story,
      outputs: story.outputs.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) =>
      right.outputs.length - left.outputs.length ||
      (left.consumerName ?? "").localeCompare(right.consumerName ?? "")
    );
}

function buildConsumerGroups(values: SymbolContractValue[]): SymbolConsumerGroup[] {
  const groups = new Map<string, SymbolConsumerGroup>();
  for (const value of values) {
    addConsumerUsages(groups, value, "direct", value.directConsumers);
    addConsumerUsages(groups, value, "downstream", value.downstreamConsumers);
  }
  return [...groups.values()].sort((left, right) =>
    levelOrder(left.level) - levelOrder(right.level) || left.name.localeCompare(right.name)
  );
}

function addConsumerUsages(
  groups: Map<string, SymbolConsumerGroup>,
  value: SymbolContractValue,
  level: SymbolConsumerLevel,
  targets: SymbolContractStep[]
) {
  for (const target of targets) {
    const ownerId = target.ownerNodeId ?? target.id;
    const name = target.ownerName ?? ownerFromQualifiedName(target.path ?? target.name) ?? target.name;
    const id = `${level}:${ownerId}`;
    const group = groups.get(id) ?? { id, name, level, usages: [] };
    const usageId = `${value.id}:${target.id}`;
    if (!group.usages.some((usage) => usage.id === usageId)) {
      group.usages.push({
        id: usageId,
        valueId: value.id,
        valueName: value.name,
        flowId: target.flowId ?? value.flowId,
        target,
      });
    }
    groups.set(id, group);
  }
}

function nearestOrigins(origin: SymbolContractStep[]): SymbolContractStep[] {
  return origin.length > 0 ? [origin[origin.length - 1]!] : [];
}

function uniqueSteps(steps: SymbolContractStep[]): SymbolContractStep[] {
  return [...new Map(steps.map((step) => [step.id, step])).values()];
}

function ownerFromQualifiedName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(".");
  return separator > 0 ? value.slice(0, separator) : value;
}

function normalizeName(value: string): string {
  return value.split(".").at(-1)?.replace(/^is|^has|^should/, "").toLowerCase() ?? value.toLowerCase();
}

function levelOrder(level: SymbolConsumerLevel): number {
  return level === "direct" ? 0 : 1;
}
