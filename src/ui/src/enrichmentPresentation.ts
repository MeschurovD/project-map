import type {
  EnrichmentBadge,
  MergedNodeEnrichment,
} from "../../modules/enrichmentTypes.js";

export type NodeEnrichmentPresentation = {
  summary?: string;
  badges: EnrichmentBadge[];
};

export function nodeEnrichmentPresentation(
  entries: MergedNodeEnrichment[] | undefined
): NodeEnrichmentPresentation {
  if (!entries || entries.length === 0) return { badges: [] };

  return {
    summary: entries.map((entry) => entry.summary).find(Boolean),
    badges: entries.flatMap((entry) => entry.badges ?? []),
  };
}
