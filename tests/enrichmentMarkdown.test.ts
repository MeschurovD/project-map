import { describe, expect, it } from "vitest";
import { parseEnrichmentMarkdown } from "../src/ui/src/components/details/enrichmentMarkdownParser.js";

describe("parseEnrichmentMarkdown", () => {
  it("parses a bullet list and extracts trailing identifier tags", () => {
    const blocks = parseEnrichmentMarkdown(
      [
        "- Кнопка скрыта, пока запись не подтверждена. [showButton, selectCanDelete]",
        "- Удаление необратимо. [handleDelete]",
      ].join("\n")
    );

    expect(blocks).toEqual([
      {
        type: "list",
        items: [
          {
            spans: [{ kind: "text", text: "Кнопка скрыта, пока запись не подтверждена." }],
            tags: ["showButton", "selectCanDelete"],
          },
          {
            spans: [{ kind: "text", text: "Удаление необратимо." }],
            tags: ["handleDelete"],
          },
        ],
      },
    ]);
  });

  it("parses paragraphs and separates them from lists by blank lines", () => {
    const blocks = parseEnrichmentMarkdown("Первый абзац.\n\n- пункт\n\nВторой абзац.");

    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "list", "paragraph"]);
  });

  it("joins soft-wrapped paragraph lines with a space", () => {
    const blocks = parseEnrichmentMarkdown("одна строка\nвторая строка");

    expect(blocks).toEqual([
      { type: "paragraph", spans: [{ kind: "text", text: "одна строка вторая строка" }] },
    ]);
  });

  it("parses inline strong, em and code spans", () => {
    const blocks = parseEnrichmentMarkdown("До **жирный** и `код` и *курсив* после");

    expect(blocks).toEqual([
      {
        type: "paragraph",
        spans: [
          { kind: "text", text: "До " },
          { kind: "strong", text: "жирный" },
          { kind: "text", text: " и " },
          { kind: "code", text: "код" },
          { kind: "text", text: " и " },
          { kind: "em", text: "курсив" },
          { kind: "text", text: " после" },
        ],
      },
    ]);
  });

  it("returns no blocks for empty or whitespace-only input", () => {
    expect(parseEnrichmentMarkdown("")).toEqual([]);
    expect(parseEnrichmentMarkdown("\n  \n")).toEqual([]);
  });

  it("keeps list items without tags as plain items", () => {
    const blocks = parseEnrichmentMarkdown("* просто пункт без тегов");

    expect(blocks).toEqual([
      {
        type: "list",
        items: [{ spans: [{ kind: "text", text: "просто пункт без тегов" }], tags: [] }],
      },
    ]);
  });
});
