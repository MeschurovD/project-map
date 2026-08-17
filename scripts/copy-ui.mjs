import fs from "node:fs/promises";
import path from "node:path";

// The UI is served as TypeScript source through vite, so every directory it
// value-imports (type-only imports are erased) must exist next to dist/ui.
const copies = [
  ["src/ui", "dist/ui"],
  ["src/modules", "dist/modules"],
  ["src/flow", "dist/flow"],
];

for (const [source, target] of copies) {
  await fs.rm(path.resolve(target), { recursive: true, force: true });
  await fs.cp(path.resolve(source), path.resolve(target), { recursive: true });
}
