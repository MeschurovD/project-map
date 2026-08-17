import { GitPullRequestArrow, Search, Workflow } from "lucide-react";
import { useT } from "../i18n.js";

export function ExplorerHome(props: {
  onFindPage: () => void;
  onFindUnit: () => void;
  onCheckImpact: () => void;
  children: React.ReactNode;
}) {
  const t = useT();

  return (
    <div className="explorer-home">
      <header className="explorer-home-header">
        <p className="explorer-home-kicker">Project Map</p>
        <h1>{t.homeTitle}</h1>
        <p>{t.homeSubtitle}</p>
        <div className="intent-actions">
          <button type="button" onClick={props.onFindPage}>
            <Search size={16} aria-hidden="true" />
            <span>{t.intentPage}</span>
          </button>
          <button type="button" onClick={props.onFindUnit}>
            <Workflow size={16} aria-hidden="true" />
            <span>{t.intentUnit}</span>
          </button>
          <button type="button" onClick={props.onCheckImpact}>
            <GitPullRequestArrow size={16} aria-hidden="true" />
            <span>{t.intentImpact}</span>
          </button>
        </div>
      </header>
      {props.children}
    </div>
  );
}
