import { useEffect, useRef } from "react";
import { Editor } from "@monaco-editor/react";
import { Copy, X } from "lucide-react";
import { useT } from "../../i18n.js";
import { SourceErrorState } from "./SourceErrorState.js";

export type SourceCodeModalProps = {
  title: string;
  file?: string;
  language?: string;
  content: string;
  startLine?: number;
  endLine?: number;
  error?: string;
  compact?: boolean;
  focusLine?: number;
  onClose: () => void;
};

export function SourceCodeModal(props: SourceCodeModalProps) {
  const t = useT();

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
            <span>{sourceSubtitle(props)}</span>
          </div>
          <div className="source-modal-actions">
            <button type="button" onClick={() => void copyCode(props.content)} disabled={!props.content}>
              <Copy size={15} aria-hidden="true" />
              <span>{t.btnCopyCode}</span>
            </button>
            <button type="button" onClick={props.onClose}>
              <X size={15} aria-hidden="true" />
              <span>{t.btnClose}</span>
            </button>
          </div>
        </header>
        {props.error ? (
          <SourceErrorState message={props.error} />
        ) : props.compact ? (
          <PlainSourceCode
            content={props.content}
            startLine={props.startLine}
            focusLine={props.focusLine}
          />
        ) : (
          <Editor
            height={props.compact ? "34vh" : "70vh"}
            language={props.language ?? "plaintext"}
            value={props.content}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: "on",
              scrollBeyondLastLine: false,
              lineNumbers: props.startLine ? ((lineNumber: number) => String((props.startLine ?? 1) + lineNumber - 1)) : "on",
            }}
          />
        )}
      </section>
    </div>
  );
}

function sourceSubtitle(props: SourceCodeModalProps) {
  const lineRange = props.startLine && props.endLine ? `:${props.startLine}-${props.endLine}` : "";
  if (lineRange) return `${props.file ?? "source"}${lineRange}`;
  if (props.focusLine) return `${props.file ?? "source"}:${props.focusLine}`;
  return `${props.file ?? "source"}${lineRange}`;
}

function PlainSourceCode(props: { content: string; startLine?: number; focusLine?: number }) {
  const focusedLine = useRef<HTMLSpanElement>(null);
  const firstLine = props.startLine ?? 1;

  useEffect(() => {
    focusedLine.current?.scrollIntoView({ block: "center" });
  }, [props.content, props.focusLine]);

  return (
    <div className="source-code-snippet">
      <code>
        {props.content.split("\n").map((line, index) => {
          const lineNumber = firstLine + index;
          const focused = lineNumber === props.focusLine;
          return (
            <span
              key={lineNumber}
              ref={focused ? focusedLine : undefined}
              className={focused ? "is-focused" : undefined}
            >
              <b aria-hidden="true">{lineNumber}</b>
              <i>{line || " "}</i>
            </span>
          );
        })}
      </code>
    </div>
  );
}

async function copyCode(content: string) {
  await navigator.clipboard.writeText(content);
}
