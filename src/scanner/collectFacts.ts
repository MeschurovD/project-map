import path from "node:path";
import type { Project } from "ts-morph";
import { classifyFsdFile } from "../analyzers/fsd/classifyFsdFile.js";
import { collectImportExportFacts } from "../analyzers/imports/collectImportExportFacts.js";
import { analyzeReact } from "../analyzers/react/analyzeReact.js";
import { analyzeRedux } from "../analyzers/redux/analyzeRedux.js";
import { analyzeValueFlow } from "../analyzers/value-flow/analyzeValueFlow.js";
import type { ResolvedProjectMapConfig } from "../config/types.js";
import type { FileFact, FsdClassificationFact, ProjectFact } from "./facts.js";

export function collectFacts(
  project: Project,
  files: string[],
  config: ResolvedProjectMapConfig
): ProjectFact[] {
  const facts: ProjectFact[] = [];

  for (const file of files) {
    const sourceFile = project.getSourceFileOrThrow(path.join(config.projectRoot, file));
    const extension = file.endsWith(".tsx") ? ".tsx" : ".ts";
    const fileFact: FileFact = {
      type: "file",
      file,
      extension,
    };
    facts.push(fileFact);

    const fsd = classifyFsdFile(file, config);
    const fsdFact: FsdClassificationFact = {
      type: "fsdClassification",
      file,
      layer: fsd.layer,
      slice: fsd.slice,
      segment: fsd.segment,
    };
    facts.push(fsdFact);

    facts.push(...collectImportExportFacts(sourceFile, config.projectRoot));
    facts.push(...analyzeReact(sourceFile, config.projectRoot));
    facts.push(...analyzeRedux(sourceFile, config.projectRoot, config));
    facts.push(...analyzeValueFlow(sourceFile, config.projectRoot, config));
  }

  return facts;
}
