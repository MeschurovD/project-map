import { describe, expect, it, vi } from "vitest";
import type { MergedNodeEnrichment } from "../src/modules/enrichmentTypes.js";
import {
  notifyEnrichmentChanged,
  subscribeEnrichmentChanges,
} from "../src/modules/ui/enrichmentEvents.js";
import { nodeEnrichmentPresentation } from "../src/ui/src/enrichmentPresentation.js";

describe("nodeEnrichmentPresentation", () => {
  it("selects the first available summary and combines module badges", () => {
    const entries: MergedNodeEnrichment[] = [
      {
        moduleId: "docs",
        nodeId: "component:a",
        summary: "Business purpose",
        badges: [{ id: "docs", label: "docs", tone: "info" }],
      },
      {
        moduleId: "e2e",
        nodeId: "component:a",
        badges: [{ id: "e2e-covered", label: "e2e", tone: "ok" }],
      },
    ];

    expect(nodeEnrichmentPresentation(entries)).toEqual({
      summary: "Business purpose",
      badges: [
        { id: "docs", label: "docs", tone: "info" },
        { id: "e2e-covered", label: "e2e", tone: "ok" },
      ],
    });
  });

  it("returns an empty presentation when a node has no overlays", () => {
    expect(nodeEnrichmentPresentation(undefined)).toEqual({ badges: [] });
  });
});

describe("enrichment invalidation events", () => {
  it("notifies active subscribers and honors unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEnrichmentChanges(listener);

    notifyEnrichmentChanged();
    unsubscribe();
    notifyEnrichmentChanged();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
