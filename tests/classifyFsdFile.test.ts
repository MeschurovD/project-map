import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaultConfig.js";
import { classifyFsdFile } from "../src/analyzers/fsd/classifyFsdFile.js";
import type { ResolvedProjectMapConfig } from "../src/config/types.js";

const config: ResolvedProjectMapConfig = {
  ...defaultConfig,
  projectRoot: "/tmp/project",
  sourceRootAbs: "/tmp/project/src",
  outputDirAbs: "/tmp/project/.project-map",
  tsconfigPathAbs: null,
};

describe("classifyFsdFile", () => {
  it("classifies feature files", () => {
    expect(classifyFsdFile("src/features/user-edit/model/useUserEditForm.ts", config)).toEqual({
      layer: "features",
      slice: "user-edit",
      segment: "model",
    });
  });

  it("classifies shared files with shared-specific shape", () => {
    expect(classifyFsdFile("src/shared/ui/Button/Button.tsx", config)).toEqual({
      layer: "shared",
      slice: "ui",
      segment: "Button",
    });
  });
});
