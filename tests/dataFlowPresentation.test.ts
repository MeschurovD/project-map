import { describe, expect, it } from "vitest";
import type { ProjectMapNode } from "../src/graph/types.js";
import { classifyUsageRole } from "../src/ui/data-flow/classifyUsageRole.js";
import { groupUsagesByTarget } from "../src/ui/data-flow/groupUsagesByTarget.js";
import type { DataFlowTargetGroup, DataFlowUsage } from "../src/ui/data-flow/valueFlowTypes.js";

describe("classifyUsageRole", () => {
  it.each([
    [{ sourceName: "isBaseInfoLoading", propName: "isLoading", usageKind: "prop" }, "loading"],
    [{ sourceName: "handleModalClose", propName: "onClose", usageKind: "eventHandler" }, "handler"],
    [{ sourceName: "shouldShowAdvancedFields", usageKind: "conditionalRender" }, "visibility"],
    [{ sourceName: "buttonText", propName: "children", usageKind: "renderedExpression" }, "text"],
    [{ sourceName: "errorMessage", propName: "errorMessage", usageKind: "prop" }, "error"],
    [{ sourceName: "isDisabled", propName: "disabled", usageKind: "prop" }, "availability"],
    [{ sourceName: "primaryProfileData", propName: "values", usageKind: "prop" }, "data"],
  ] as const)("classifies %s as %s", (partialUsage, role) => {
    expect(classifyUsageRole(usage(partialUsage))).toBe(role);
  });
});

describe("groupUsagesByTarget", () => {
  it("groups hook return usages by consumer target", () => {
    const groups = groupUsagesByTarget([
      usage({
        sourceName: "primaryProfileData",
        usageKind: "prop",
        targetName: "ProfileForm",
        targetType: "component",
        propName: "values",
      }),
      usage({
        sourceName: "isBaseInfoLoading",
        usageKind: "prop",
        targetName: "ProfileForm",
        targetType: "component",
        propName: "isLoading",
      }),
      usage({
        sourceName: "secondaryProfileData",
        usageKind: "prop",
        targetName: "ExpandableProfileForm",
        targetType: "component",
        propName: "map",
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      targetName: "ProfileForm",
      stats: {
        total: 2,
        data: 1,
        loading: 1,
      },
    });
    expect(groups[0]?.usages.map((entry) => entry.sourceName)).toEqual([
      "primaryProfileData",
      "isBaseInfoLoading",
    ]);
    expect(groups[1]).toMatchObject({
      targetName: "ExpandableProfileForm",
      stats: {
        total: 1,
        data: 1,
      },
    });
  });
});

function usage(overrides: Partial<DataFlowUsage>): DataFlowUsage {
  return {
    sourceName: "value",
    sourceKind: "hookReturn",
    usageKind: "prop",
    ...overrides,
  };
}
