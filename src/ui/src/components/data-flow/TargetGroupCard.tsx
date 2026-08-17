import type { DataFlowTargetGroup, DataFlowUsage, DataFlowUsageRole } from "../../../data-flow/valueFlowTypes.js";
import { SourceViewerButton } from "../source/SourceViewerButton.js";

type TargetGroupCardProps = {
  group: DataFlowTargetGroup;
  selected?: boolean;
  onSelectTarget?: (targetId: string) => void;
  onViewUsage?: (usage: DataFlowUsage) => void;
  onOpenTarget?: (targetNodeId: string) => void;
};

const ROLE_ORDER: DataFlowUsageRole[] = [
  "data",
  "loading",
  "visibility",
  "text",
  "availability",
  "handler",
  "error",
  "event",
  "unknown",
];

const ROLE_LABELS: Record<DataFlowUsageRole, string> = {
  data: "Data",
  loading: "Loading",
  error: "Errors",
  availability: "Availability",
  visibility: "Visibility",
  text: "Text",
  handler: "Handlers",
  event: "Events",
  unknown: "Unknown",
};

export function TargetGroupCard(props: TargetGroupCardProps) {
  const { group } = props;

  return (
    <div
      className={props.selected ? "target-group-card selected" : "target-group-card"}
      role={props.onSelectTarget ? "button" : undefined}
      tabIndex={props.onSelectTarget ? 0 : undefined}
      onClick={() => props.onSelectTarget?.(group.id)}
      onKeyDown={(event) => {
        if (!props.onSelectTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelectTarget(group.id);
        }
      }}
    >
      <div className="target-group-header">
        <div className="target-group-title">
          <strong>{group.targetName}</strong>
          <span>{group.targetType} · receives {group.stats.total} {group.stats.total === 1 ? "value" : "values"}</span>
        </div>
        {group.targetNodeId ? (
          <span onClick={(event) => event.stopPropagation()}>
            <SourceViewerButton
              label="Open target"
              size="small"
              onClick={() => props.onOpenTarget?.(group.targetNodeId!)}
            />
          </span>
        ) : null}
      </div>
      <div className="target-group-roles">
        {ROLE_ORDER.map((role) => {
          const usages = group.roles[role];
          if (usages.length === 0) return null;

          return (
            <div key={role} className="target-group-role">
              <h5>{ROLE_LABELS[role]}</h5>
              {usages.map((usage, index) => (
                <div key={`${usage.sourceName}:${usage.propName ?? usage.usageKind}:${index}`} className="target-group-usage">
                  <span>{usageLabel(usage)}</span>
                  {usage.evidence ? (
                    <span onClick={(event) => event.stopPropagation()}>
                      <SourceViewerButton
                        label="View usage"
                        size="small"
                        onClick={() => props.onViewUsage?.(usage)}
                      />
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function usageLabel(usage: DataFlowUsage) {
  if (usage.propName) return `${usage.sourceName} -> ${usage.propName}`;
  if (usage.usageKind === "conditionalRender") return `${usage.sourceName} -> controls render`;
  if (usage.targetName) return `${usage.sourceName} -> ${usage.targetName}`;
  return `${usage.sourceName} -> ${usage.usageKind}`;
}
