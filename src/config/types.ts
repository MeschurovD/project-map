export type ProjectMapConfig = {
  projectRoot?: string;
  sourceRoot: string;
  fsd: {
    layers: string[];
    segments: string[];
  };
  redux: {
    selectorHooks: string[];
    dispatchHooks: string[];
  };
  ignore: string[];
  outputDir: string;
  docs: DocsConfig;
  e2e: E2eConfig;
};

export type ResolvedProjectMapConfig = ProjectMapConfig & {
  projectRoot: string;
  sourceRootAbs: string;
  outputDirAbs: string;
  tsconfigPathAbs: string | null;
};

/** Shared generator settings used by every generation module (docs, e2e, ...). */
export type GeneratorConfig = {
  type: "opencode";
  command: string;
  args: string[];
};

/** Base contract for a module that generates files through a generator. */
export type GenerationModuleConfig = {
  enabled: boolean;
  generator: GeneratorConfig;
};

export type DocsConfig = GenerationModuleConfig & {
  mode: "colocated";
  fileSuffix: ".docs.md";
};

export type E2eConfig = GenerationModuleConfig;
