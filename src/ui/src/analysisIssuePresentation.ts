import type { AnalysisIssuePosition } from "../../flow/buildAnalysisIssueSummary.js";
import type { T } from "./i18n.js";

export function analysisIssueReason(reasonCode: string, t: T) {
  switch (reasonCode) {
    case "selector-composed-cross-file":
      return { title: t.issueSelectorCrossFile, detail: t.issueSelectorCrossFileDetail };
    case "unsupported-state-read":
      return { title: t.issueUnsupportedStateRead, detail: t.issueUnsupportedStateReadDetail };
    case "selector-constant":
      return { title: t.issueSelectorConstant, detail: t.issueSelectorConstantDetail };
    case "selector-source-not-recorded":
      return { title: t.issueSelectorSourceMissing, detail: t.issueSelectorSourceMissingDetail };
    case "hook-return-source-not-recorded":
      return { title: t.issueHookReturnMissing, detail: t.issueHookReturnMissingDetail };
    default:
      return { title: humanizeReasonCode(reasonCode), detail: t.issueUnknownDetail };
  }
}

export function analysisIssuePosition(position: AnalysisIssuePosition, t: T) {
  if (position === "origin") return t.issuePositionOrigin;
  if (position === "continuation") return t.issuePositionContinuation;
  if (position === "both") return t.issuePositionBoth;
  return t.issuePositionUnknown;
}

function humanizeReasonCode(reasonCode: string) {
  return reasonCode
    .split("-")
    .filter(Boolean)
    .map((part, index) => index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
    .join(" ");
}
