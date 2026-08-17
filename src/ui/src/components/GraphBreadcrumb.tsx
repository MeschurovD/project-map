import { ChevronRight } from "lucide-react";
export type BreadcrumbItem = {
  id: string;
  label: string;
  onClick?: () => void;
};

export function GraphBreadcrumb(props: { items: BreadcrumbItem[] }) {
  if (props.items.length === 0) return null;

  return (
    <nav className="graph-breadcrumb" aria-label="Graph breadcrumb">
      {props.items.map((item, index) => (
        <span key={item.id} className="breadcrumb-item">
          {index > 0 ? <ChevronRight size={14} aria-hidden="true" /> : null}
          {item.onClick ? (
            <button type="button" onClick={item.onClick}>{item.label}</button>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
