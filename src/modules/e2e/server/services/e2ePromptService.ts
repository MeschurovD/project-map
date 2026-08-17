import { readProjectFile } from "../../../../dev/services/sourceFileService.js";
import type { ProjectMapNode } from "../../../../graph/types.js";
import type { E2eContextItem, E2eGenerationTarget } from "../../shared/apiTypes.js";

export async function buildE2ePrompt(params: {
  node: ProjectMapNode;
  target: E2eGenerationTarget;
  pageObjectPath: string;
  poSpecPath: string;
  targetPath: string;
  userComment?: string;
  selectedContext: E2eContextItem[];
  graphSummary?: string;
  projectRoot: string;
}): Promise<string> {
  const sourceFiles = await sourceFilesBlock(params.projectRoot, params.selectedContext);
  return params.target === "page-object"
    ? buildPageObjectPrompt(params, sourceFiles)
    : buildPoSpecPrompt(params, sourceFiles);
}

function buildPageObjectPrompt(params: {
  node: ProjectMapNode;
  pageObjectPath: string;
  targetPath: string;
  userComment?: string;
  graphSummary?: string;
}, sourceFiles: string) {
  return `# Task

Create a Page Object for the selected React component.

## Component

- Name: ${params.node.name}
- Type: ${params.node.type}
- Source file: ${params.node.file ?? "none"}
- Page Object file to create or update: ${params.pageObjectPath}

## Hard requirements

1. Create or update only this file: ${params.pageObjectPath}.
2. Do not modify the source component.
3. Do not add data-testid attributes to the source component in this MVP.
4. Use existing test selectors/data-testid values when they exist.
5. If stable selectors are missing, document practical selector assumptions inside the Page Object.
6. The Page Object must be useful for e2e or component tests.
7. Methods should reflect public UI behavior, not internal implementation details.
8. For complex components, separate locators, actions, and assertions.
9. Use clear method names.
10. If related child Page Objects are present in context, use them as dependencies.

${params.userComment?.trim() ? `## User comment

${params.userComment.trim()}
` : ""}
## Graph context

${params.graphSummary ?? "No graph context was provided."}

## Context files

${sourceFiles}
`;
}

function buildPoSpecPrompt(params: {
  node: ProjectMapNode;
  pageObjectPath: string;
  poSpecPath: string;
  targetPath: string;
  userComment?: string;
  graphSummary?: string;
}, sourceFiles: string) {
  return `# Task

Create a spec file that verifies the Page Object for the selected React component.

## Component

- Name: ${params.node.name}
- Type: ${params.node.type}
- Source file: ${params.node.file ?? "none"}
- Page Object file: ${params.pageObjectPath}
- Spec file to create or update: ${params.poSpecPath}

## Hard requirements

1. Create or update only this file: ${params.poSpecPath}.
2. Do not modify the source component.
3. Do not modify the Page Object unless absolutely necessary.
4. Verify that the Page Object finds the main elements.
5. Verify basic actions exposed by the Page Object.
6. Verify important visible states.
7. Use existing test utilities from the project when they are present in context.
8. If mocks/stubs are required, add minimal local mocks inside the spec.
9. Do not implement a full business flow.
10. The goal is to verify the Page Object and the basic component contract.

## Spec should

- mount/render the component in the test environment;
- use the generated Page Object;
- verify important locators;
- verify basic interactions;
- verify visible states;
- avoid deep business-flow testing.

${params.userComment?.trim() ? `## User comment

${params.userComment.trim()}
` : ""}
## Graph context

${params.graphSummary ?? "No graph context was provided."}

## Context files

${sourceFiles}
`;
}

async function sourceFilesBlock(projectRoot: string, selectedContext: E2eContextItem[]) {
  const files = unique(selectedContext.map((entry) => entry.file).filter((entry): entry is string => Boolean(entry)));
  const blocks: string[] = [];
  const extraItems = selectedContext.filter((entry) => !entry.file);

  for (const file of files) {
    const { content } = await readProjectFile({ projectRoot, relativePath: file });
    blocks.push(`### ${file}

\`\`\`${languageFence(file)}
${content}
\`\`\``);
  }

  for (const item of extraItems) {
    blocks.push(`### ${item.label}

${item.reason}`);
  }

  return blocks.join("\n\n") || "No context files were selected.";
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function languageFence(file: string) {
  if (file.endsWith(".tsx") || file.endsWith(".ts")) return "ts";
  if (file.endsWith(".jsx") || file.endsWith(".js")) return "js";
  if (file.endsWith(".json")) return "json";
  if (file.endsWith(".md")) return "md";
  return "";
}
