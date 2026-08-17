import type { ProjectMapGraph, ProjectMapNode } from "../../../graph/types.js";
import { useT } from "../i18n.js";
import { canViewNodeSource } from "../source/sourceClient.js";
import { SourceViewerButton } from "./source/SourceViewerButton.js";

export function NodeList(props: {
  title: string;
  nodes: ProjectMapNode[];
  graph: ProjectMapGraph;
  onViewNodeSource: (node: ProjectMapNode) => void;
}) {
  const t = useT();
  if (props.nodes.length === 0) return null;

  return (
    <section className="semantic-section">
      <h3>{props.title}</h3>
      <div className="semantic-list">
        {props.nodes.slice(0, 16).map((node) => (
          <div key={node.id} className="semantic-item">
            <div className="semantic-item-main">
              <strong>{node.name}</strong>
              <span>{node.type}{node.fsd?.layer ? ` / ${node.fsd.layer}` : ""}</span>
            </div>
            <SourceViewerButton
              label={t.btnView}
              size="small"
              disabled={!canViewNodeSource(props.graph, node)}
              title={canViewNodeSource(props.graph, node) ? undefined : t.tipNoSourceFile}
              onClick={() => props.onViewNodeSource(node)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
