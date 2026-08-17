import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import type { ProjectMapNode } from "../../../graph/types.js";
import type { FlowIndex } from "../../../flow/types.js";
import type { MergedEnrichmentAnnotation } from "../../../modules/enrichmentTypes.js";
import { useT } from "../i18n.js";

const RESULT_LIMIT = 60;

// Cmd/Ctrl+K palette: fuzzy-jump to any node in the project (not just the
// current view). Selecting a node opens it in the details panel; pages also
// switch the explorer into their page-focus.
export function CommandPalette(props: {
  entries: PaletteEntry[];
  onSelect: (entry: PaletteEntry) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => filterPaletteEntries(props.entries, query), [props.entries, query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActiveIndex(0), [query]);

  const active = results[Math.min(activeIndex, results.length - 1)];

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      props.onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      props.onSelect(active);
    }
  }

  return (
    <div className="source-modal-backdrop palette-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t.paletteTitle}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <label className="palette-input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.palettePlaceholder}
          />
        </label>

        <ul className="palette-results">
          {results.length === 0 ? <li className="palette-empty">{t.paletteEmpty}</li> : null}
          {results.map((entry, index) => (
            <li key={entry.id}>
              <button
                type="button"
                className={index === activeIndex ? "palette-item active" : "palette-item"}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => props.onSelect(entry)}
              >
                <span className="palette-item-type">{entry.type}</span>
                <span className="palette-item-name">{entry.name}</span>
                <span className="palette-item-context">
                  {entry.matchedText ? (
                    <span className="palette-item-semantic">{entry.matchedText}</span>
                  ) : entry.file ? (
                    <span className="palette-item-file">{entry.file}</span>
                  ) : null}
                </span>
                {index === activeIndex ? <CornerDownLeft size={13} aria-hidden="true" className="palette-enter" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export type PaletteEntry = {
  id: string;
  kind: "node" | "value";
  type: string;
  name: string;
  file?: string;
  node: ProjectMapNode;
  flowNodeId?: string;
  flowId?: string;
  semanticTexts: string[];
  matchedText?: string;
};

export function buildPaletteEntries(params: {
  nodes: ProjectMapNode[];
  annotations: MergedEnrichmentAnnotation[];
  flowIndex?: FlowIndex;
}): PaletteEntry[] {
  const nodeEntries = new Map(params.nodes.map((node) => [node.id, {
    id: `node:${node.id}`,
    kind: "node" as const,
    type: node.type,
    name: node.name,
    file: node.file,
    node,
    semanticTexts: [] as string[],
  }]));
  const flowNodeById = new Map(params.flowIndex?.nodes.map((node) => [node.id, node]) ?? []);
  const flowByNodeId = new Map<string, string>();
  for (const flow of params.flowIndex?.flows ?? []) {
    for (const nodeId of flow.nodeIds) {
      if (!flowByNodeId.has(nodeId)) flowByNodeId.set(nodeId, flow.id);
    }
  }
  const valueEntries = new Map<string, PaletteEntry>();

  for (const annotation of params.annotations) {
    const semanticText = plainSemanticText(
      [annotation.summary, annotation.markdown].filter(Boolean).join(" ")
    );
    const ownerEntry = nodeEntries.get(annotation.ownerNodeId);
    if (ownerEntry && semanticText) ownerEntry.semanticTexts.push(semanticText);
    for (const target of annotation.targets) {
      if (target.type === "node") {
        const targetEntry = nodeEntries.get(target.id);
        if (targetEntry && targetEntry !== ownerEntry && semanticText) {
          targetEntry.semanticTexts.push(semanticText);
        }
        continue;
      }
      if (target.type !== "flow-node") continue;
      const flowNode = flowNodeById.get(target.id);
      const owner = flowNode?.ownerNodeId
        ? params.nodes.find((node) => node.id === flowNode.ownerNodeId)
        : ownerEntry?.node;
      if (!flowNode || !owner) continue;
      const existing = valueEntries.get(target.id);
      if (existing) {
        if (semanticText) existing.semanticTexts.push(semanticText);
      } else {
        valueEntries.set(target.id, {
          id: `value:${target.id}`,
          kind: "value",
          type: flowNode.kind,
          name: flowNode.path ?? flowNode.name,
          file: owner.file,
          node: owner,
          flowNodeId: target.id,
          flowId: flowByNodeId.get(target.id),
          semanticTexts: semanticText ? [semanticText] : [],
        });
      }
    }
  }
  return [...nodeEntries.values(), ...valueEntries.values()];
}

export function filterPaletteEntries(
  entries: PaletteEntry[],
  query: string,
  limit = RESULT_LIMIT
): PaletteEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries
      .filter((entry) => entry.kind === "node")
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, limit);
  }

  const scored: Array<{ rank: number; entry: PaletteEntry }> = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const structural = `${name} ${entry.file ?? ""} ${entry.node.id} ${entry.node.fsd?.layer ?? ""} ${entry.node.fsd?.slice ?? ""}`.toLowerCase();
    const matchedSemantic = entry.semanticTexts.find((text) =>
      text.toLowerCase().includes(normalized)
    );
    const result = matchedSemantic
      ? { ...entry, matchedText: semanticExcerpt(matchedSemantic, normalized) }
      : entry;
    if (name.startsWith(normalized)) scored.push({ rank: entry.kind === "value" ? 1 : 0, entry: result });
    else if (name.includes(normalized)) scored.push({ rank: entry.kind === "value" ? 2 : 1, entry: result });
    else if (structural.includes(normalized)) scored.push({ rank: 2, entry: result });
    else if (matchedSemantic) scored.push({ rank: 3, entry: result });
  }
  scored.sort((left, right) =>
    left.rank - right.rank || left.entry.name.localeCompare(right.entry.name)
  );
  return scored.slice(0, limit).map(({ entry }) => entry);
}

/** Rank nodes for the palette: name prefix first, then name substring, then any
 * field (file, id, FSD path). Pure so it can be unit-tested. */
export function filterNodesForPalette(nodes: ProjectMapNode[], query: string, limit = RESULT_LIMIT): ProjectMapNode[] {
  return filterPaletteEntries(buildPaletteEntries({ nodes, annotations: [] }), query, limit)
    .map((entry) => entry.node);
}

function plainSemanticText(markdown: string) {
  return markdown
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/[`*_#>[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticExcerpt(text: string, query: string) {
  const index = text.toLowerCase().indexOf(query);
  if (index < 0 || text.length <= 150) return text;
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + query.length + 85);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
