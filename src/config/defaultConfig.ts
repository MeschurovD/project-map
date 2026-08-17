import type { ProjectMapConfig } from "./types.js";

export const defaultConfig: ProjectMapConfig = {
  sourceRoot: "src",
  fsd: {
    layers: ["app", "pages", "widgets", "features", "entities", "shared"],
    segments: ["ui", "model", "api", "lib", "config", "types", "consts"],
  },
  redux: {
    selectorHooks: ["useSelector", "useAppSelector"],
    dispatchHooks: ["useDispatch", "useAppDispatch"],
  },
  ignore: ["node_modules", "dist", "build", ".next", ".turbo"],
  outputDir: ".project-map",
  docs: {
    enabled: true,
    mode: "colocated",
    fileSuffix: ".docs.md",
    generator: {
      type: "opencode",
      command: "opencode",
      args: ["run"],
    },
  },
  e2e: {
    enabled: true,
    generator: {
      type: "opencode",
      command: "opencode",
      args: ["run"],
    },
  },
};
