import path from "node:path";
import type { SourceFile } from "ts-morph";
import type {
  ExportFact,
  ImportFact,
  ProjectFact,
  ResolvedImportFact,
  UnresolvedFact,
} from "../../scanner/facts.js";
import { toProjectRelative } from "../../utils/path.js";

export function collectImportExportFacts(
  sourceFile: SourceFile,
  projectRoot: string
): ProjectFact[] {
  const sourceFilePath = toProjectRelative(projectRoot, sourceFile.getFilePath());
  const facts: ProjectFact[] = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    const location = sourceFile.getLineAndColumnAtPos(declaration.getStart());
    const target = declaration.getModuleSpecifierValue();
    const resolvedSourceFile = declaration.getModuleSpecifierSourceFile();
    const targetFile = resolvedSourceFile
      ? toProjectRelative(projectRoot, resolvedSourceFile.getFilePath())
      : undefined;
    const external = !targetFile && isExternalSpecifier(target);
    const asset = !targetFile && isAssetSpecifier(target);

    const importFact: ImportFact = {
      type: "import",
      sourceFile: sourceFilePath,
      target,
      importedNames: declaration.getNamedImports().map((specifier) =>
        specifier.getAliasNode()?.getText() ?? specifier.getName()
      ),
      ...(declaration.getDefaultImport()?.getText()
        ? { defaultImportName: declaration.getDefaultImport()?.getText() }
        : {}),
      ...(declaration.getNamespaceImport()?.getText()
        ? { namespaceImportName: declaration.getNamespaceImport()?.getText() }
        : {}),
      isTypeOnly: declaration.isTypeOnly(),
      location,
    };
    facts.push(importFact);

    const resolvedFact: ResolvedImportFact = {
      type: "resolvedImport",
      sourceFile: sourceFilePath,
      target,
      ...(targetFile ? { targetFile } : {}),
      ...(external ? { packageName: parsePackageName(target) } : {}),
      resolved: Boolean(targetFile) || external || asset,
      external,
      location,
    };
    facts.push(resolvedFact);

    if (!resolvedFact.resolved) {
      const unresolved: UnresolvedFact = {
        type: "unresolvedImport",
        sourceFile: sourceFilePath,
        target,
        reason: "Cannot resolve import",
        location,
      };
      facts.push(unresolved);
    }
  }

  const exportedNames = sourceFile.getExportSymbols().map((symbol) => symbol.getName()).sort();
  const exportFact: ExportFact = {
    type: "export",
    sourceFile: sourceFilePath,
    exportedNames,
  };
  facts.push(exportFact);

  return facts;
}

function isAssetSpecifier(specifier: string) {
  return /\.(?:css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico)(?:\?.*)?$/i.test(specifier);
}

function isExternalSpecifier(specifier: string) {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("@/") &&
    !specifier.startsWith("~/") &&
    !specifier.startsWith("#/") &&
    !path.isAbsolute(specifier)
  );
}

function parsePackageName(specifier: string) {
  const parts = specifier.split("/").filter(Boolean);
  if (parts[0]?.startsWith("@")) {
    return parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
  }

  return parts[0];
}
