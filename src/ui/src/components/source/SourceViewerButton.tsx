import { FileCode2 } from "lucide-react";
import { useT } from "../../i18n.js";

export function SourceViewerButton(props: {
  label?: string;
  disabled?: boolean;
  title?: string;
  size?: "default" | "small";
  onClick: () => void;
}) {
  const t = useT();

  return (
    <button
      className={props.size === "small" ? "source-button small" : "source-button"}
      type="button"
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
    >
      <FileCode2 size={props.size === "small" ? 13 : 15} aria-hidden="true" />
      <span>{props.label ?? t.btnViewSource}</span>
    </button>
  );
}
