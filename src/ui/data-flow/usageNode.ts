import type { LocalVariableUsageKind } from "../../analyzers/value-flow/types.js";

// Human label + card type for "where a value goes" (a prop, a render condition,
// an event handler, an argument). Shared by the component and hook flow views.
export function usageNodeFor(usageKind: LocalVariableUsageKind, targetName?: string, propName?: string) {
  if (usageKind === "conditionalRender") {
    return { label: targetName ? `Controls render: ${targetName}` : "Controls conditional render", nodeType: "ui-effect" };
  }
  if (usageKind === "ternaryCondition") {
    return { label: targetName ? `Chooses render: ${targetName}` : "Controls ternary render", nodeType: "ui-effect" };
  }
  if (usageKind === "prop") {
    return { label: targetName ? `Passed to ${targetName}.${propName ?? "prop"}` : `Passed as ${propName ?? "prop"}`, nodeType: "ui-effect" };
  }
  if (usageKind === "eventHandler") {
    return { label: targetName ? `Handles ${targetName}.${propName ?? "event"}` : `Handles ${propName ?? "event"}`, nodeType: "ui-effect" };
  }
  if (usageKind === "renderedExpression") return { label: "Rendered expression", nodeType: "ui-effect" };
  if (usageKind === "hookArgument") return { label: targetName ? `Passed to ${targetName}` : "Hook argument", nodeType: "hook" };
  if (usageKind === "actionArgument") return { label: targetName ? `Passed to ${targetName}` : "Action argument", nodeType: "action" };
  if (usageKind === "functionArgument") return { label: targetName ? `Passed to ${targetName}` : "Function argument", nodeType: "function" };
  return { label: usageKind, nodeType: "ui-effect" };
}
