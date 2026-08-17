import { Project, type SourceFile } from "ts-morph";
import { describe, expect, it } from "vitest";
import { collectImportExportFacts } from "../src/analyzers/imports/collectImportExportFacts.js";

describe("collectImportExportFacts", () => {
  it("does not report style and asset imports as semantic unresolved references", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile: SourceFile = project.createSourceFile(
      "/project/src/ui/Card.tsx",
      `
        import styles from "./styles.module.css";
        import iconUrl from "./icon.svg";
        export const Card = () => <div className={styles.root}><img src={iconUrl} /></div>;
      `
    );

    const facts = collectImportExportFacts(sourceFile, "/project");

    expect(facts.filter((fact) => fact.type === "unresolvedImport")).toEqual([]);
    expect(facts.filter((fact) => fact.type === "resolvedImport")).toEqual([
      expect.objectContaining({ target: "./styles.module.css", resolved: true, external: false }),
      expect.objectContaining({ target: "./icon.svg", resolved: true, external: false }),
    ]);
  });
});
