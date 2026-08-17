import { Project, type SourceFile } from "ts-morph";
import { describe, expect, it } from "vitest";
import { analyzeReact } from "../src/analyzers/react/analyzeReact.js";

describe("JSX occurrence facts", () => {
  it("preserves fragments, repeated callsites and JSX prop slots", () => {
    const facts = analyze(`
      export function ExamplePage() {
        return (
          <>
            <InfoCard value="first" />
            <InfoCard
              value="second"
              addon={<EditAction title="Edit" />}
            />
          </>
        );
      }
    `);
    const occurrences = facts.filter((fact) => fact.type === "jsxOccurrence");

    expect(occurrences).toHaveLength(4);
    const fragment = occurrences.find((fact) => fact.kind === "fragment");
    const cards = occurrences.filter((fact) => fact.tagName === "InfoCard");
    const action = occurrences.find((fact) => fact.tagName === "EditAction");

    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((fact) => fact.occurrenceId)).size).toBe(2);
    expect(cards.every((fact) => fact.parentOccurrenceId === fragment?.occurrenceId)).toBe(true);
    expect(action).toMatchObject({
      parentOccurrenceId: cards[1]?.occurrenceId,
      slotName: "addon",
    });
  });
});

function analyze(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile: SourceFile = project.createSourceFile("/project/src/pages/example/ExamplePage.tsx", code);
  return analyzeReact(sourceFile, "/project");
}
