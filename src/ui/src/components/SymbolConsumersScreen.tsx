import { ArrowRight, ChevronRight } from "lucide-react";
import type {
  SymbolConsumerGroup,
  SymbolOverview,
} from "../../../flow/buildSymbolOverview.js";
import { useT, type T } from "../i18n.js";
import { symbolStepLabel } from "../symbolPresentation.js";

export function SymbolConsumersScreen(props: {
  overview: SymbolOverview;
  onOpenFlow: (flowId: string) => void;
}) {
  const t = useT();
  const direct = props.overview.consumerGroups.filter((group) => group.level === "direct");
  const downstream = props.overview.consumerGroups.filter((group) => group.level === "downstream");

  return (
    <div className="symbol-consumers-screen" data-symbol-tab="consumers">
      <ConsumerSection
        title={t.symbolDirectConsumers}
        hint={t.symbolDirectConsumersHint}
        groups={direct}
        empty={t.symbolNoDirectConsumers}
        onOpenFlow={props.onOpenFlow}
        t={t}
      />
      <ConsumerSection
        title={t.symbolDownstreamConsumers}
        hint={t.symbolDownstreamConsumersHint}
        groups={downstream}
        empty={t.symbolNoDownstreamConsumers}
        onOpenFlow={props.onOpenFlow}
        t={t}
      />
    </div>
  );
}

function ConsumerSection(props: {
  title: string;
  hint: string;
  groups: SymbolConsumerGroup[];
  empty: string;
  onOpenFlow: (flowId: string) => void;
  t: T;
}) {
  return (
    <section className="symbol-consumer-section">
      <div className="symbol-section-heading">
        <div><h2>{props.title}</h2><p>{props.hint}</p></div>
        <strong>{props.groups.length}</strong>
      </div>
      {props.groups.length > 0 ? (
        <div className="symbol-consumer-groups">
          {props.groups.map((group) => (
            <article key={group.id} className="symbol-consumer-group">
              <header><strong>{group.name}</strong><span>{group.usages.length}</span></header>
              <div>
                {group.usages.map((usage) => (
                  <div key={usage.id} className="symbol-consumer-usage">
                    <span><small>{props.t.symbolConsumerValue}</small><strong>{usage.valueName}</strong></span>
                    <ArrowRight size={15} aria-hidden="true" />
                    <span><small>{props.t.symbolConsumerTarget}</small><strong>{symbolStepLabel(usage.target, props.t)}</strong></span>
                    <button type="button" onClick={() => props.onOpenFlow(usage.flowId)}>
                      {props.t.unitTrace} <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : <div className="symbol-consumer-empty">{props.empty}</div>}
    </section>
  );
}
