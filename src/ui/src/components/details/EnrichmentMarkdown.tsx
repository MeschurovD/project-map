import { parseEnrichmentMarkdown, type InlineSpan } from "./enrichmentMarkdownParser.js";

// Renders the markdown of an enrichment section as real lists/paragraphs
// instead of raw text. Identifier tags on Business-rule items become chips; when
// onTagClick is given they are buttons that jump into the data-flow trace for
// that identifier.
export function EnrichmentMarkdown(props: { markdown: string; onTagClick?: (tag: string) => void }) {
  const blocks = parseEnrichmentMarkdown(props.markdown);
  if (blocks.length === 0) return null;

  return (
    <div className="enrichment-markdown">
      {blocks.map((block, index) =>
        block.type === "list" ? (
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inline spans={item.spans} />
                {item.tags.map((tag) =>
                  props.onTagClick ? (
                    <button key={tag} type="button" className="enrichment-tag enrichment-tag-button" onClick={() => props.onTagClick!(tag)}>
                      {tag}
                    </button>
                  ) : (
                    <span key={tag} className="enrichment-tag">
                      {tag}
                    </span>
                  )
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            <Inline spans={block.spans} />
          </p>
        )
      )}
    </div>
  );
}

function Inline(props: { spans: InlineSpan[] }) {
  return (
    <>
      {props.spans.map((span, index) => {
        if (span.kind === "strong") return <strong key={index}>{span.text}</strong>;
        if (span.kind === "em") return <em key={index}>{span.text}</em>;
        if (span.kind === "code") return <code key={index}>{span.text}</code>;
        return <span key={index}>{span.text}</span>;
      })}
    </>
  );
}
