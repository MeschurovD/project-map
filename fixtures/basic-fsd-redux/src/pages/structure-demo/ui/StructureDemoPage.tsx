import { Fragment } from "react";
import { EditInfo } from "@/features/edit-info";
import { InfoPanel } from "@/shared/ui/info-panel";

export function StructureDemoPage() {
  return (
    <Fragment>
      <InfoPanel title="First" />
      <InfoPanel
        title="Second"
        addon={<EditInfo />}
      />
    </Fragment>
  );
}
