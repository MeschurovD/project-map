import path from "node:path";
import type { ProjectMapNode } from "../../../../graph/types.js";
import type { E2eGenerationTarget } from "../../shared/apiTypes.js";
import type { ComponentE2eTargets } from "./e2eTypes.js";

export function resolveComponentE2eTargets(node: Pick<ProjectMapNode, "type" | "file">): ComponentE2eTargets | null {
  if (node.type !== "component" || !node.file) return null;

  const parsed = path.posix.parse(node.file);
  const pageObjectPath = path.posix.join(parsed.dir, `${parsed.name}.po.ts`);
  return {
    pageObjectPath,
    poSpecPath: path.posix.join(parsed.dir, `${parsed.name}.po.spec.ts`),
  };
}

export function resolveE2eTargetPath(targets: ComponentE2eTargets, target: E2eGenerationTarget) {
  return target === "page-object" ? targets.pageObjectPath : targets.poSpecPath;
}
