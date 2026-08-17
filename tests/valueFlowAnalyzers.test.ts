import { Project, type SourceFile } from "ts-morph";
import { describe, expect, it } from "vitest";
import type { ResolvedProjectMapConfig } from "../src/config/types.js";
import { detectHookBindings } from "../src/analyzers/value-flow/detectHookBindings.js";
import { detectHookReturnUsages } from "../src/analyzers/value-flow/detectHookReturnUsages.js";
import { detectLocalVariableUsages } from "../src/analyzers/value-flow/detectLocalVariableUsages.js";
import { detectSelectorBindings } from "../src/analyzers/value-flow/detectSelectorBindings.js";
import { detectSelectorStateReads } from "../src/analyzers/value-flow/detectSelectorStateReads.js";
import type { HookBindingFact, SelectorBindingFact } from "../src/analyzers/value-flow/types.js";

describe("value-flow analyzers", () => {
  it("detects selector bindings", () => {
    const sourceFile = source(`
      function RecordInfoPage() {
        const featureActionVisible = useAppSelector(selectPrimaryActionVisible);
        return null;
      }
    `);

    const facts = detectSelectorBindings(sourceFile, "src/RecordInfoPage.tsx", config());

    expect(facts[0]).toMatchObject({
      selectorName: "selectPrimaryActionVisible",
      localName: "featureActionVisible",
      owner: "RecordInfoPage",
      confidence: "high",
    });
  });

  it("resolves a selector declaration through a barrel re-export", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/project/src/model/selectors.ts",
      "export const selectRecord = (state: RootState) => state.record.current;"
    );
    project.createSourceFile("/project/src/model/index.ts", "export { selectRecord } from './selectors';");
    const sourceFile = project.createSourceFile("/project/src/RecordInfoPage.tsx", `
      import { selectRecord } from "./model";
      function RecordInfoPage() {
        const record = useAppSelector(selectRecord);
        return null;
      }
    `);

    const facts = detectSelectorBindings(sourceFile, "src/RecordInfoPage.tsx", config());

    expect(facts[0]).toMatchObject({
      selectorName: "selectRecord",
      selectorFile: "src/model/selectors.ts",
    });
  });

  it("preserves a canonical state path for an inline selector binding", () => {
    const sourceFile = source(`
      function useUserProfile() {
        const status = useAppSelector((root) => root.user.status);
        return status;
      }
    `);

    const facts = detectSelectorBindings(sourceFile, "src/useUserProfile.ts", config());

    expect(facts[0]).toMatchObject({
      selectorName: "inlineSelector:state.user.status",
      statePath: "state.user.status",
      localName: "status",
      owner: "useUserProfile",
      confidence: "medium",
    });
  });

  it("creates selector bindings for destructured selector results", () => {
    const sourceFile = source(`
      function useRecords() {
        const { totalElements, pageSize: size } = useAppSelector(selectPagination);
        return { totalElements, size };
      }
    `);

    const facts = detectSelectorBindings(sourceFile, "src/useRecords.ts", config());

    expect(facts.map((fact) => fact.localName)).toEqual(["totalElements", "size"]);
    expect(facts.every((fact) => fact.selectorName === "selectPagination")).toBe(true);
  });

  it("detects selector state reads", () => {
    const sourceFile = source(`
      export const selectSomething = (state: RootState) => state.featureInfo.something;
      export function selectOther(state: RootState) {
        return state.featureInfo.other;
      }
    `);

    const facts = detectSelectorStateReads(sourceFile, "src/selectors.ts");

    expect(facts.map((fact) => [fact.selectorName, fact.statePath])).toEqual([
      ["selectSomething", "state.featureInfo.something"],
      ["selectOther", "state.featureInfo.other"],
    ]);
  });

  it("follows selector calls nested inside transformed expressions", () => {
    const sourceFile = source(`
      const selectFeature = (state: RootState) => state.feature;
      export const selectItems = (state: RootState) =>
        selectFeature(state).items?.map((item) => item.id) || [];
    `);

    const facts = detectSelectorStateReads(sourceFile, "src/selectors.ts");

    expect(facts).toContainEqual(expect.objectContaining({
      selectorName: "selectItems",
      derivedFromSelectors: ["selectFeature"],
    }));
  });

  it("follows selector calls assigned before a block return", () => {
    const sourceFile = source(`
      const selectFeature = (state: RootState) => state.feature;
      export const selectItemMap = (state: RootState) => {
        const items = selectFeature(state).items;
        return items.reduce((result, item) => ({ ...result, [item.id]: item }), {});
      };
    `);

    const facts = detectSelectorStateReads(sourceFile, "src/selectors.ts");

    expect(facts).toContainEqual(expect.objectContaining({
      selectorName: "selectItemMap",
      derivedFromSelectors: ["selectFeature"],
    }));
  });

  it("records every state source read by a block selector", () => {
    const sourceFile = source(`
      export const selectSummary = (state: RootState) => {
        const title = state.record.title;
        const status = state.record.status;
        return { title, status };
      };
    `);

    const facts = detectSelectorStateReads(sourceFile, "src/selectors.ts");

    expect(facts.filter((fact) => fact.selectorName === "selectSummary").map((fact) => fact.statePath)).toEqual([
      "state.record.title",
      "state.record.status",
    ]);
  });

  it("recognizes selector suffixes and the common selct prefix typo", () => {
    const sourceFile = source(`
      export const userInfoSelector = (state: RootState) => state.user.info;
      export const selctIsLoading = (state: RootState) => state.user.isLoading;
    `);

    const facts = detectSelectorStateReads(sourceFile, "src/selectors.ts");

    expect(facts.map((fact) => fact.selectorName)).toEqual(["userInfoSelector", "selctIsLoading"]);
  });

  it("recognizes a nonstandard selector name inside a selectors module", () => {
    const sourceFile = source(`
      export const getNotifications = (state: RootState) => state.notifications.items;
    `);

    const facts = detectSelectorStateReads(sourceFile, "src/model/selectors.ts");

    expect(facts).toContainEqual(expect.objectContaining({
      selectorName: "getNotifications",
      statePath: "state.notifications.items",
    }));
  });

  it("detects conditional render from a local variable", () => {
    const sourceFile = source(`
      function RecordInfoPage() {
        const featureActionVisible = useAppSelector(selectPrimaryActionVisible);
        return <>{featureActionVisible && <FeatureAction />}</>;
      }
    `);

    const facts = detectLocalVariableUsages(sourceFile, "src/RecordInfoPage.tsx", [selectorBinding()]);

    expect(facts).toContainEqual(expect.objectContaining({
      variableName: "featureActionVisible",
      usageKind: "conditionalRender",
      targetName: "FeatureAction",
    }));
  });

  it("detects prop passing from a local variable", () => {
    const sourceFile = source(`
      function RecordInfoPage() {
        const featureData = useAppSelector(selectFeatureData);
        return <DetailsPanel data={featureData} />;
      }
    `);

    const facts = detectLocalVariableUsages(sourceFile, "src/RecordInfoPage.tsx", [{
      ...selectorBinding(),
      selectorName: "selectFeatureData",
      localName: "featureData",
    }]);

    expect(facts).toContainEqual(expect.objectContaining({
      variableName: "featureData",
      usageKind: "prop",
      targetName: "DetailsPanel",
      propName: "data",
    }));
  });

  it("detects hook binding object destructuring", () => {
    const sourceFile = source(`
      function RecordInfoPage() {
        const { data, isLoading, refetch } = useRecordInfo(recordId);
        return null;
      }
    `);

    const facts = detectHookBindings(sourceFile, "src/RecordInfoPage.tsx", config());

    expect(facts[0]).toMatchObject({
      hookName: "useRecordInfo",
      arguments: ["recordId"],
      boundTo: {
        kind: "objectDestructure",
        fields: [
          { sourceName: "data", localName: "data" },
          { sourceName: "isLoading", localName: "isLoading" },
          { sourceName: "refetch", localName: "refetch" },
        ],
      },
    });
  });

  it("marks a hook resolved outside sourceRoot as an external boundary source", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/project/vendor/router.ts", "export const useParams = () => ({ recordId: '1' });");
    const sourceFile = project.createSourceFile("/project/src/RecordInfoPage.tsx", `
      import { useParams } from "../vendor/router";
      function RecordInfoPage() {
        const { recordId } = useParams();
        return <DetailsPanel recordId={recordId} />;
      }
    `);

    const bindings = detectHookBindings(sourceFile, "src/RecordInfoPage.tsx", config());
    const usages = detectHookReturnUsages(sourceFile, "src/RecordInfoPage.tsx", bindings);

    expect(bindings[0]).toMatchObject({ hookName: "useParams", externalModule: "../vendor/router" });
    expect(usages[0]).toMatchObject({ hookName: "useParams", externalModule: "../vendor/router" });
  });

  it("detects hook return usages", () => {
    const sourceFile = source(`
      function RecordInfoPage() {
        const { data, isLoading, refetch } = useRecordInfo();
        return (
          <>
            {isLoading && <Spinner />}
            <ProfileForm data={data} />
            <Button onClick={refetch} />
          </>
        );
      }
    `);
    const bindings = detectHookBindings(sourceFile, "src/RecordInfoPage.tsx", config());

    const facts = detectHookReturnUsages(sourceFile, "src/RecordInfoPage.tsx", bindings);

    expect(facts).toContainEqual(expect.objectContaining({
      localName: "isLoading",
      usageKind: "conditionalRender",
      targetName: "Spinner",
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      localName: "data",
      usageKind: "prop",
      targetName: "ProfileForm",
      propName: "data",
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      localName: "refetch",
      usageKind: "eventHandler",
      targetName: "Button",
      propName: "onClick",
    }));
  });

  it("detects a hook return used by an early render guard", () => {
    const sourceFile = source(`
      function RecordInfoPage() {
        const { shouldShowDetails } = useRecordInfo();
        if (!shouldShowDetails) {
          return null;
        }
        return <DetailsPanel />;
      }
    `);
    const bindings = detectHookBindings(sourceFile, "src/RecordInfoPage.tsx", config());

    const facts = detectHookReturnUsages(sourceFile, "src/RecordInfoPage.tsx", bindings);

    expect(facts).toContainEqual(expect.objectContaining({
      hookName: "useRecordInfo",
      localName: "shouldShowDetails",
      sourceField: "shouldShowDetails",
      usageKind: "conditionalRender",
      code: expect.stringContaining("if (!shouldShowDetails)"),
      confidence: "high",
    }));
  });

  it("preserves a property path after an identifier hook binding", () => {
    const sourceFile = source(`
      function UserProfileWidget() {
        const profile = useUserProfile();
        return <UserCard name={profile.name} />;
      }
    `);
    const bindings = detectHookBindings(sourceFile, "src/UserProfileWidget.tsx", config());

    const facts = detectHookReturnUsages(sourceFile, "src/UserProfileWidget.tsx", bindings);

    expect(facts).toContainEqual(expect.objectContaining({
      hookName: "useUserProfile",
      localName: "profile",
      sourceField: "name",
      usageKind: "prop",
      targetName: "UserCard",
      propName: "name",
    }));
  });
});

function source(code: string): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      jsx: 4,
    },
  });
  return project.createSourceFile("/project/src/RecordInfoPage.tsx", code);
}

function selectorBinding(): SelectorBindingFact {
  return {
    type: "selectorBinding",
    owner: "RecordInfoPage",
    ownerNodeId: "component:src/RecordInfoPage#RecordInfoPage",
    selectorName: "selectPrimaryActionVisible",
    localName: "featureActionVisible",
    file: "src/RecordInfoPage.tsx",
    confidence: "high",
  };
}

function config(): ResolvedProjectMapConfig {
  return {
    projectRoot: "/project",
    sourceRoot: "src",
    sourceRootAbs: "/project/src",
    outputDir: ".project-map",
    outputDirAbs: "/project/.project-map",
    tsconfigPathAbs: null,
    fsd: {
      layers: ["pages", "widgets", "features", "entities", "shared"],
      segments: ["ui", "model", "api", "lib"],
    },
    redux: {
      selectorHooks: ["useSelector", "useAppSelector"],
      dispatchHooks: ["useDispatch", "useAppDispatch"],
    },
    ignore: [],
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
}
