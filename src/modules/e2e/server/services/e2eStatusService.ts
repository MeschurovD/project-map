import type { ProjectMapGraph, ProjectMapNode } from "../../../../graph/types.js";
import { getGraphNode } from "../../../server/graphNode.js";
import type { E2eFileStatus, E2ePageObjectDependency, E2eStatusResponse } from "../../shared/apiTypes.js";
import { e2eFileExists, e2eFileStat } from "./e2eFileService.js";
import { resolveComponentE2eTargets } from "./e2ePathResolver.js";

export { getGraphNode };

export async function getE2eStatusForNode(params: {
  graph: ProjectMapGraph;
  nodeId: string;
  projectRoot: string;
}): Promise<E2eStatusResponse> {
  const node = getGraphNode(params.graph, params.nodeId);

  if (node.type === "page" && node.file) {
    const dependentPageObjects = await getDependentPageObjects(params.graph, node, params.projectRoot);
    const existing = dependentPageObjects.filter((entry) => entry.status === "exists").length;
    return {
      nodeId: params.nodeId,
      status: "page",
      page: {
        id: node.id,
        name: node.name,
        file: node.file,
      },
      dependentPageObjects,
      coverage: {
        existing,
        total: dependentPageObjects.length,
      },
      businessFlow: {
        status: "experimental",
        reason: "Будет добавлено после MVP Page Object coverage.",
      },
    };
  }

  const targets = resolveComponentE2eTargets(node);
  if (!targets || !node.file) {
    return {
      nodeId: params.nodeId,
      status: "unsupported",
      reason: node.file
        ? "Page Object coverage is available only for component nodes."
        : "Page Object недоступен: у узла нет исходного файла.",
    };
  }

  return {
    nodeId: params.nodeId,
    status: "component",
    component: {
      id: node.id,
      name: node.name,
      file: node.file,
    },
    pageObject: await fileStatus(params.projectRoot, "page-object", targets.pageObjectPath),
    poSpec: await fileStatus(params.projectRoot, "po-spec", targets.poSpecPath),
    businessFlow: {
      status: "experimental",
      reason: "Будет добавлено после MVP Page Object coverage.",
    },
  };
}

async function fileStatus(projectRoot: string, target: E2eFileStatus["target"], expectedPath: string): Promise<E2eFileStatus> {
  try {
    const stat = await e2eFileStat(projectRoot, expectedPath);
    return {
      target,
      status: "exists",
      expectedPath,
      path: expectedPath,
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        target,
        status: "missing",
        expectedPath,
      };
    }
    throw error;
  }
}

async function getDependentPageObjects(graph: ProjectMapGraph, page: ProjectMapNode, projectRoot: string): Promise<E2ePageObjectDependency[]> {
  const renderedComponents = graph.edges
    .filter((edge) => edge.from === page.id && edge.type === "renders")
    .map((edge) => getGraphNode(graph, edge.to))
    .filter((node) => node.type === "component" && Boolean(node.file));

  const dependencies: E2ePageObjectDependency[] = [];
  for (const component of renderedComponents) {
    const targets = resolveComponentE2eTargets(component);
    if (!targets || !component.file) continue;
    dependencies.push({
      nodeId: component.id,
      name: component.name,
      file: component.file,
      pageObjectPath: targets.pageObjectPath,
      status: await e2eFileExists(projectRoot, targets.pageObjectPath) ? "exists" : "missing",
    });
  }

  return dependencies;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
