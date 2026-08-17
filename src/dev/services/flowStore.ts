import fs from "node:fs/promises";
import path from "node:path";
import {
  FLOW_SCHEMA_VERSION,
  type FlowIndex,
} from "../../flow/types.js";

/** Read a compatible canonical FlowIndex without making it a hard dependency. */
export async function readFlowIndexIfPresent(
  projectRoot: string
): Promise<FlowIndex | undefined> {
  try {
    const raw = await fs.readFile(
      path.join(projectRoot, ".project-map", "flows.json"),
      "utf8"
    );
    const parsed = JSON.parse(raw) as FlowIndex;
    return parsed.schemaVersion === FLOW_SCHEMA_VERSION ? parsed : undefined;
  } catch {
    return undefined;
  }
}
