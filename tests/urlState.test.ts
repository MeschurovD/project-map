import { describe, expect, it } from "vitest";
import { parseUrlState, serializeUrlState } from "../src/ui/src/urlState.js";

describe("urlState", () => {
  it("round-trips a full page-focus state", () => {
    const state = {
      mode: "page-focus" as const,
      selectedPageId: "page:record-info-page",
      selectedUnitId: "component:src/widgets/record/ui/RecordInfo#RecordInfo",
      inspectedNodeId: "component:src/widgets/record/ui/RecordInfo#RecordInfo",
      pageFocusTab: "dossier" as const,
      selectedNodeId: "selector:src/entities/feature/model/selectors#selectFeature",
      query: "record",
    };

    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });

  it("serializes the default state to an empty string", () => {
    expect(serializeUrlState({ mode: "pages-overview", pageFocusTab: "structure", pagesView: "table" })).toBe("");
    expect(serializeUrlState({})).toBe("");
  });

  it("keeps the cards pages view in the hash and drops the default table view", () => {
    expect(serializeUrlState({ pagesView: "cards" })).toBe("#pages=cards");
    expect(serializeUrlState({ pagesView: "table" })).toBe("");
    expect(parseUrlState("#pages=table")).toEqual({ pagesView: "table" });
    expect(parseUrlState("#pages=bogus")).toEqual({});
  });

  it("omits default mode and tab but keeps the rest", () => {
    const serialized = serializeUrlState({
      mode: "pages-overview",
      pageFocusTab: "structure",
      query: "user",
    });
    expect(serialized).toBe("#q=user");
  });

  it("ignores unknown mode and tab values when parsing", () => {
    expect(parseUrlState("#mode=bogus&tab=nope&q=user")).toEqual({ query: "user" });
  });

  it("parses a hash with or without the leading #", () => {
    expect(parseUrlState("mode=full-debug")).toEqual({ mode: "full-debug" });
    expect(parseUrlState("#mode=full-debug")).toEqual({ mode: "full-debug" });
  });

  it("round-trips an open single-flow trace and the aggregate toggle", () => {
    const trace = {
      mode: "page-focus" as const,
      selectedPageId: "page:example-page",
      selectedFlowId: "flow:src/pages/pool/ui#profile.name",
      traceView: "evidence" as const,
    };
    expect(parseUrlState(serializeUrlState(trace))).toEqual(trace);

    // The default list view is omitted; only the aggregate toggle is serialized.
    expect(serializeUrlState({ flowsView: "list" })).toBe("");
    expect(serializeUrlState({ flowsView: "aggregate" })).toBe("#flows=aggregate");
    expect(parseUrlState("#flows=aggregate")).toEqual({ flowsView: "aggregate" });
    expect(parseUrlState("#flows=bogus")).toEqual({});
    expect(parseUrlState("#trace=bogus")).toEqual({});
  });

  it("round-trips the page actions destination", () => {
    const state = { mode: "page-focus" as const, selectedPageId: "page:orders", pageFocusTab: "actions" as const };
    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });

  it("round-trips the page impact destination", () => {
    const state = { mode: "page-focus" as const, selectedPageId: "page:orders", pageFocusTab: "impact" as const };
    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });

  it("round-trips the page quality destination", () => {
    const state = { mode: "page-focus" as const, selectedPageId: "page:orders", pageFocusTab: "quality" as const };
    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });

  it("round-trips the impact mode with its target", () => {
    const state = { mode: "impact" as const, impactNodeId: "selector:src/entities/user/model/selectors#selectUser" };
    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });

  it("round-trips a selected business rule", () => {
    const state = { mode: "business-logic" as const, selectedBusinessAnnotationId: "docs:component:user:owner-rule" };
    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });

  it("survives node ids with special characters", () => {
    const state = { selectedNodeId: "component:src/pages/user/ui/UserPage#UserPage" };
    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });
});
