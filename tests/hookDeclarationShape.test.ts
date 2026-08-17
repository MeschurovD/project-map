import { Project, type SourceFile } from "ts-morph";
import { describe, expect, it } from "vitest";
import { detectHookDeclarationShape } from "../src/analyzers/value-flow/detectHookDeclarationShape.js";

function analyze(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile: SourceFile = project.createSourceFile("/project/src/useRecord.ts", code);
  return detectHookDeclarationShape(sourceFile, "src/useRecord.ts");
}

describe("detectHookDeclarationShape", () => {
  it("describes the hook return rather than a nested callback return", () => {
    const [shape] = analyze(`
      const useRecord = () => {
        const fields = useMemo(() => {
          const availableFields = [];
          return availableFields;
        }, []);
        return { fields, isLoading: false };
      };
    `);

    expect(shape?.returnShape).toEqual({ kind: "object", fields: ["fields", "isLoading"] });
  });
});
