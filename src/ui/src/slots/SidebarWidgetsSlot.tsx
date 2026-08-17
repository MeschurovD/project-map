import { projectMapUiModules } from "../../../modules/uiRegistry.js";

/** Renders every module's sidebar widgets (compact summary rows). */
export function SidebarWidgetsSlot() {
  const widgets = projectMapUiModules
    .flatMap((module) => module.sidebarWidgets ?? [])
    .sort((a, b) => a.order - b.order);

  return (
    <>
      {widgets.map((widget) => {
        const Widget = widget.Component;
        return <Widget key={widget.id} />;
      })}
    </>
  );
}
