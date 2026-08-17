import type { Lang } from "../i18n.js";

export function LangToggle(props: { lang: Lang; setLang: (lang: Lang) => void }) {
  return (
    <div className="lang-toggle">
      <button
        type="button"
        className={props.lang === "en" ? "lang-button active" : "lang-button"}
        onClick={() => props.setLang("en")}
      >
        EN
      </button>
      <button
        type="button"
        className={props.lang === "ru" ? "lang-button active" : "lang-button"}
        onClick={() => props.setLang("ru")}
      >
        RU
      </button>
    </div>
  );
}

export function BooleanToggle(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-row">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

export function Metric(props: { label: string; value?: number }) {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value ?? 0}</strong>
    </div>
  );
}

export function KeyValues(props: { values: Array<[string, string | null | undefined]> }) {
  return (
    <dl className="key-values">
      {props.values
        .filter(([, value]) => Boolean(value))
        .map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}
