import { useState } from "react";
import { BookOpen } from "lucide-react";
import type { NodeActionContext } from "../../../types.js";
import { DocumentationModal } from "./DocumentationModal.js";

export function DocsNodeAction(props: NodeActionContext) {
  const [open, setOpen] = useState(false);
  const documented = props.enrichment.some((entry) =>
    entry.moduleId === "docs" &&
    entry.badges?.some((badge) => badge.id === "docs")
  ) || props.annotations.some((annotation) => annotation.moduleId === "docs");

  return (
    <>
      <button
        type="button"
        className={`node-module-action${documented ? " node-module-action-active" : ""}`}
        onClick={() => setOpen(true)}
        title={documented ? "Открыть документацию" : "Создать документацию"}
        aria-label={`${documented ? "Открыть" : "Создать"} документацию: ${props.node.name}`}
        data-docs-node={props.node.id}
      >
        <BookOpen size={15} aria-hidden="true" />
        <span>Docs</span>
      </button>
      {open ? (
        <DocumentationModal
          node={props.node}
          annotations={props.annotations.filter((annotation) => annotation.moduleId === "docs")}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
