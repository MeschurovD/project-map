import { AlertTriangle, FileCode2, X } from "lucide-react";
import type { UnresolvedFact } from "../../../scanner/facts.js";
import { useT, type T } from "../i18n.js";

// "N unresolved" in the sidebar opens this list: every reference the scanner
// could not resolve, with its source location and a jump into the code. A
// visible, clickable backlog keeps the map honest instead of hiding the gaps.
export function UnresolvedPanel(props: {
  items: UnresolvedFact[];
  onClose: () => void;
  onOpenSource: (fact: UnresolvedFact) => void;
}) {
  const t = useT();
  const groups = groupByType(props.items);

  return (
    <div className="source-modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="source-modal unresolved-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t.unresolvedTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="source-modal-header">
          <div>
            <h2><AlertTriangle size={16} aria-hidden="true" /> {t.unresolvedTitle}</h2>
            <span>{props.items.length} {t.metricUnresolved}</span>
          </div>
          <div className="source-modal-actions">
            <button type="button" onClick={props.onClose}>
              <X size={15} aria-hidden="true" />
              <span>{t.btnClose}</span>
            </button>
          </div>
        </header>

        <div className="unresolved-body">
          {groups.map((group) => (
            <section key={group.type} className="unresolved-group">
              <h3>{labelForType(group.type, t)} · {group.items.length}</h3>
              <ul>
                {group.items.map((fact, index) => (
                  <li key={`${fact.sourceFile}:${fact.location?.line ?? index}:${fact.name ?? index}`}>
                    <div className="unresolved-row-head">
                      <code>{fact.name ?? fact.target ?? "—"}</code>
                      {fact.sourceFile ? (
                        <button type="button" className="unresolved-source" onClick={() => props.onOpenSource(fact)}>
                          <FileCode2 size={13} aria-hidden="true" />
                          <span>{fact.sourceFile}{fact.location ? `:${fact.location.line}` : ""}</span>
                        </button>
                      ) : null}
                    </div>
                    <p className="unresolved-reason">{fact.reason}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

function groupByType(items: UnresolvedFact[]) {
  const order: UnresolvedFact["type"][] = ["unresolvedImport", "unresolvedJsxComponent", "unresolvedHook"];
  return order
    .map((type) => ({ type, items: items.filter((item) => item.type === type) }))
    .filter((group) => group.items.length > 0);
}

function labelForType(type: UnresolvedFact["type"], t: T) {
  if (type === "unresolvedImport") return t.unresolvedImports;
  if (type === "unresolvedJsxComponent") return t.unresolvedJsx;
  return t.unresolvedHooks;
}
