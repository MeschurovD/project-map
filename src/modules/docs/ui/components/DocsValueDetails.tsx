import { useState } from "react";
import { AlertTriangle, BookOpen, ChevronDown, ChevronUp, GitMerge, Scale } from "lucide-react";
import type { MergedEnrichmentAnnotation } from "../../../enrichmentTypes.js";
import type { ValueActionContext } from "../../../types.js";
import { useT } from "../../../../ui/src/i18n.js";
import { EnrichmentMarkdown } from "../../../../ui/src/components/details/EnrichmentMarkdown.js";
import {
  docsValuePresentation,
  docsValueSummary,
  hasDocsValueDetails,
} from "../docsValuePresentation.js";

const VISIBLE_RULES = 2;

export function DocsValueDetails(props: ValueActionContext) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const presentation = docsValuePresentation(props.annotations);
  if (!hasDocsValueDetails(presentation)) return null;

  const compact = props.displayMode === "compact";
  const summary = docsValueSummary(presentation);
  const visibleRules = presentation.rules.slice(0, VISIBLE_RULES);
  const hiddenRulesCount = presentation.rules.length - visibleRules.length;

  return (
    <aside className="docs-value-details" data-docs-value-details={props.flowNodeId}>
      {compact ? <div className="docs-value-summary">
        <div className="docs-value-summary-heading">
          <span>
            <BookOpen size={13} aria-hidden="true" /> {t.docsValueMeaning}
            {presentation.meaning?.valueCategory ? (
              <em>{valueCategoryLabel(presentation.meaning.valueCategory)}</em>
            ) : null}
          </span>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t.docsValueDetailsHide : t.docsValueDetailsShow}
            {expanded
              ? <ChevronUp size={12} aria-hidden="true" />
              : <ChevronDown size={12} aria-hidden="true" />}
          </button>
        </div>
        {summary ? <p>{summary}</p> : null}
        {presentation.rules.length > 0 || presentation.cautions.length > 0 ? (
          <div className="docs-value-summary-meta">
            {presentation.rules.length > 0 ? (
              <span>{t.docsValueRulesCount.replace("{count}", String(presentation.rules.length))}</span>
            ) : null}
            {presentation.cautions.length > 0 ? (
              <span>{presentation.cautions.length} {t.docsCautions}</span>
            ) : null}
          </div>
        ) : null}
      </div> : null}
      {!compact || expanded ? (
        <div className="docs-value-expanded">
          {presentation.meaning ? (
            <div className="docs-value-meaning">
              <span><BookOpen size={13} aria-hidden="true" /> {compact ? t.docsValueDetailedMeaning : t.docsValueMeaning}</span>
              <EnrichmentMarkdown markdown={presentation.meaning.markdown} />
              <AnnotationAssociation annotation={presentation.meaning} />
            </div>
          ) : null}
          {visibleRules.length > 0 ? (
            <div className="docs-value-rules">
              <span><Scale size={13} aria-hidden="true" /> {t.docsBusinessRules}</span>
              {visibleRules.map((annotation) => (
                <div key={`${annotation.moduleId}:${annotation.id}`} className="docs-value-rule">
                  <EnrichmentMarkdown markdown={annotation.markdown} />
                  <AnnotationAssociation annotation={annotation} />
                </div>
              ))}
              {hiddenRulesCount > 0 ? <small>+{hiddenRulesCount} {t.docsMoreRules}</small> : null}
            </div>
          ) : null}
          {presentation.cautions.length > 0 ? (
            <div className="docs-value-cautions">
              <AlertTriangle size={13} aria-hidden="true" />
              <span>{presentation.cautions.length} {t.docsCautions}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );

  function AnnotationAssociation(props: { annotation: MergedEnrichmentAnnotation }) {
    const association = props.annotation.association;
    if (!association) return null;
    const source = association.sourceLabel ?? association.sourceTargetId;
    const relations = association.relations.map(relationLabel).join(" → ");
    return (
      <small className={`docs-value-association association-${association.kind}`}>
        <GitMerge size={11} aria-hidden="true" />
        <span>
          {association.kind === "inherited" ? t.docsInheritedFrom : t.docsRelatedFrom}{" "}
          <strong>{source}</strong>
          {relations ? ` · ${t.docsVia} ${relations}` : ""}
          {association.confidence ? ` · ${confidenceLabel(association.confidence)}` : ""}
        </span>
      </small>
    );
  }

  function relationLabel(relation: string) {
    return ({
      binds: t.flowRelationBinds,
      passes: t.flowRelationPasses,
      returns: t.flowRelationReturns,
      derives: t.flowRelationDerives,
      controls: t.flowRelationControls,
    } as Record<string, string>)[relation] ?? relation;
  }

  function confidenceLabel(confidence: "high" | "medium" | "low" | "unknown") {
    return ({
      high: t.flowConfidenceHigh,
      medium: t.flowConfidenceMedium,
      low: t.flowConfidenceLow,
      unknown: t.flowConfidenceUnknown,
    })[confidence];
  }

  function valueCategoryLabel(category: NonNullable<MergedEnrichmentAnnotation["valueCategory"]>) {
    return ({
      "domain-data": "domain data",
      decision: "decision",
      "ui-state": "UI state",
      "user-input": "user input",
      handler: "action",
      technical: "technical",
    })[category];
  }
}
