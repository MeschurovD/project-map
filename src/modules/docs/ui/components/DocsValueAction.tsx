import { useState } from "react";
import { BookOpen } from "lucide-react";
import type { ValueActionContext } from "../../../types.js";
import { DocumentationModal } from "./DocumentationModal.js";

export function DocsValueAction(props: ValueActionContext) {
  const [open, setOpen] = useState(false);
  const annotations = props.annotations.filter((annotation) =>
    annotation.moduleId === "docs"
  );

  return (
    <>
      <button
        type="button"
        className={`node-module-action${
          annotations.length > 0 ? " node-module-action-active" : ""
        }`}
        onClick={() => setOpen(true)}
        title={`${annotations.length > 0 ? "Открыть" : "Создать"} документацию значения ${props.valueLabel}`}
        aria-label={`${annotations.length > 0 ? "Открыть" : "Создать"} документацию значения: ${props.valueLabel}`}
        data-docs-flow-node={props.flowNodeId}
      >
        <BookOpen size={14} aria-hidden="true" />
        <span>Docs</span>
      </button>
      {open ? (
        <DocumentationModal
          node={props.ownerNode}
          annotations={annotations}
          target={{ type: "flow-node", id: props.flowNodeId }}
          targetLabel={props.valueLabel}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
