import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectFile, resolveProjectFilePath } from "../src/dev/services/sourceFileService.js";
import {
  getEnclosingFunctionSnippet,
  getSnippetAroundLine,
} from "../src/dev/services/snippetService.js";

describe("sourceFileService", () => {
  it("reads files inside the project root", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-source-"));
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "Widget.tsx"), "export function Widget() {}\n", "utf8");

    const source = await readProjectFile({
      projectRoot,
      relativePath: "src/Widget.tsx",
    });

    expect(source.content).toContain("Widget");
  });

  it("rejects paths outside the project root", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-source-"));

    expect(() => resolveProjectFilePath({
      projectRoot,
      relativePath: "../outside.ts",
    })).toThrow("Access outside project root is forbidden");
  });

  it("rejects absolute paths outside the project root", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-source-"));

    expect(() => resolveProjectFilePath({
      projectRoot,
      relativePath: "/etc/passwd",
    })).toThrow("Access outside project root is forbidden");
  });

  it("rejects node_modules by default", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-source-"));

    expect(() => resolveProjectFilePath({
      projectRoot,
      relativePath: "node_modules/react/index.js",
    })).toThrow("Reading node_modules is forbidden");
  });
});

describe("snippetService", () => {
  it("returns context around a one-based line number", () => {
    const snippet = getSnippetAroundLine([
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
    ].join("\n"), 3, 1);

    expect(snippet).toEqual({
      content: "line 2\nline 3\nline 4",
      startLine: 2,
      endLine: 4,
    });
  });

  it("returns the complete function containing a source line", () => {
    const snippet = getEnclosingFunctionSnippet([
      "import { dispatch } from './store';",
      "",
      "export function runExample() {",
      "  const inputId = '1';",
      "  executeTask({ inputId });",
      "  return inputId;",
      "}",
      "",
      "export const unrelated = true;",
    ].join("\n"), 5, "example.ts");

    expect(snippet).toEqual({
      content: [
        "export function runExample() {",
        "  const inputId = '1';",
        "  executeTask({ inputId });",
        "  return inputId;",
        "}",
      ].join("\n"),
      startLine: 3,
      endLine: 7,
    });
  });

  it("keeps the declaration around an arrow function", () => {
    const snippet = getEnclosingFunctionSnippet([
      "const before = true;",
      "export const runExample = () => {",
      "  executeTask({});",
      "  return null;",
      "};",
      "const after = true;",
    ].join("\n"), 3, "example.ts");

    expect(snippet).toMatchObject({
      content: [
        "export const runExample = () => {",
        "  executeTask({});",
        "  return null;",
        "};",
      ].join("\n"),
      startLine: 2,
      endLine: 5,
    });
  });
});
