import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { detectHookReturnSpreads } from "../src/analyzers/value-flow/detectHookReturnSpreads.js";

describe("detectHookReturnSpreads", () => {
  it("records an object spread sourced from another custom hook", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile("/project/src/useRecord.ts", `
      const useRecord = () => {
        const controls = useRecordControls();
        return { ...controls, ready: true };
      };
    `);

    expect(detectHookReturnSpreads(sourceFile, "src/useRecord.ts")).toEqual([
      expect.objectContaining({
        hookName: "useRecord",
        sourceLocalName: "controls",
        sourceHookName: "useRecordControls",
      }),
    ]);
  });
});
