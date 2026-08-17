import { projectMapUiModules } from "../../../modules/uiRegistry.js";

/** Renders every module's app-wide widgets once, independent of node selection. */
export function GlobalWidgetsSlot() {
  const widgets = projectMapUiModules.flatMap((module) => module.globalWidgets ?? []);

  return (
    <>
      {widgets.map((widget) => {
        const Widget = widget.Component;
        return <Widget key={widget.id} />;
      })}
    </>
  );
}
