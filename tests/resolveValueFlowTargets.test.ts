import { describe, expect, it } from "vitest";
import { resolveValueFlowTargets } from "../src/flow/resolveValueFlowTargets.js";
import type {
  HookReturnUsageFact,
  LocalVariableUsageFact,
} from "../src/analyzers/value-flow/types.js";
import type { ProjectMapGraph } from "../src/graph/types.js";

const ownerId = "component:src/widgets/Profile#Profile";
const primaryCardId = "component:src/entities/user/UserCard#UserCard";
const otherCardId = "component:src/shared/UserCard#UserCard";

const graph: ProjectMapGraph = {
  schemaVersion: "1.1.0",
  project: { name: "targets", root: "/targets", sourceRoot: "src" },
  nodes: [
    { id: ownerId, type: "component", name: "Profile" },
    { id: primaryCardId, type: "component", name: "UserCard" },
    { id: otherCardId, type: "component", name: "UserCard" },
    { id: "component:src/shared/Spinner#Spinner", type: "component", name: "Spinner" },
  ],
  edges: [{
    id: "edge:profile-renders-card",
    from: ownerId,
    to: primaryCardId,
    type: "renders",
    confidence: "high",
    evidence: [],
  }],
  stats: { nodesCount: 4, edgesCount: 1 },
};

describe("resolveValueFlowTargets", () => {
  it("uses the owner's rendered component to disambiguate duplicate names", () => {
    const [resolved] = resolveValueFlowTargets([usage("UserCard")], graph);

    expect(resolved).toMatchObject({ targetNodeId: primaryCardId });
  });

  it("uses a globally unique component when no render edge is available", () => {
    const [resolved] = resolveValueFlowTargets([
      { ...usage("Spinner"), ownerNodeId: "component:unknown:Owner" },
    ], graph);

    expect(resolved).toMatchObject({ targetNodeId: "component:src/shared/Spinner#Spinner" });
  });

  it("keeps an ambiguous placeholder when topology cannot prove the target", () => {
    const original = { ...usage("UserCard"), ownerNodeId: "component:unknown:Owner" };
    const [resolved] = resolveValueFlowTargets([original], graph);

    expect(resolved).toBe(original);
    expect(resolved).toMatchObject({ targetNodeId: "component:unknown:UserCard" });
  });

  it("does not reinterpret a function call as a same-named component", () => {
    const original: LocalVariableUsageFact = {
      type: "localVariableUsage",
      owner: "Profile",
      ownerNodeId: ownerId,
      variableName: "profile",
      usageKind: "functionArgument",
      targetName: "Spinner",
      file: "src/widgets/Profile.tsx",
      confidence: "medium",
    };
    const [resolved] = resolveValueFlowTargets([original], graph);

    expect(resolved).toBe(original);
    expect(resolved).not.toHaveProperty("targetNodeId");
  });
});

function usage(targetName: string): HookReturnUsageFact {
  return {
    type: "hookReturnUsage",
    owner: "Profile",
    ownerNodeId: ownerId,
    hookName: "useProfile",
    localName: "profile",
    sourceField: "name",
    usageKind: "prop",
    targetName,
    targetNodeId: `component:unknown:${targetName}`,
    propName: "name",
    file: "src/widgets/Profile.tsx",
    confidence: "high",
  };
}
