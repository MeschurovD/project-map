import { Editor } from "@monaco-editor/react";
import { Copy, X } from "lucide-react";

export function DocsModal(props: {
  title: string;
  path: string;
  content: string;
  onClose: () => void;
}) {
  return (
    <div className="source-modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="source-modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="source-modal-header">
          <div>
            <h2>{props.title}</h2>
            <span>{props.path}</span>
          </div>
          <div className="source-modal-actions">
            <button type="button" onClick={() => void navigator.clipboard.writeText(props.content)} disabled={!props.content}>
              <Copy size={15} aria-hidden="true" />
              <span>Copy</span>
            </button>
            <button type="button" onClick={props.onClose}>
              <X size={15} aria-hidden="true" />
              <span>Close</span>
            </button>
          </div>
        </header>
        <Editor
          height="70vh"
          language="markdown"
          value={props.content}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            wordWrap: "on",
            scrollBeyondLastLine: false,
          }}
        />
      </section>
    </div>
  );
}
