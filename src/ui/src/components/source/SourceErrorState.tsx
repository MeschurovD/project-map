import { AlertTriangle } from "lucide-react";

export function SourceErrorState(props: { message: string }) {
  return (
    <div className="source-error">
      <AlertTriangle size={18} aria-hidden="true" />
      <span>{props.message}</span>
    </div>
  );
}
