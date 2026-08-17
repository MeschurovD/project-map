import { Project, type SourceFile } from "ts-morph";
import { describe, expect, it } from "vitest";
import { detectHookReturnDependencies } from "../src/analyzers/value-flow/detectHookReturnDependencies.js";

function analyze(code: string) {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strictNullChecks: true } });
  const sourceFile: SourceFile = project.createSourceFile("/project/src/features/record/model/useRecord.ts", code);
  return detectHookReturnDependencies(sourceFile, "src/features/record/model/useRecord.ts");
}

describe("detectHookReturnDependencies", () => {
  it("maps a shorthand return field to the local it names", () => {
    const facts = analyze(`
      function useRecord() {
        const data = useAppSelector(selectData);
        const isLoading = useAppSelector(selectLoading);
        return { data, isLoading };
      }
    `);

    expect(facts).toContainEqual(expect.objectContaining({ hookName: "useRecord", field: "data", dependsOn: ["data"] }));
    expect(facts).toContainEqual(expect.objectContaining({ hookName: "useRecord", field: "isLoading", dependsOn: ["isLoading"] }));
  });

  it("grades a shorthand single-source return as high confidence", () => {
    const facts = analyze(`
      function useRecord() {
        const data = useAppSelector(selectData);
        return { data };
      }
    `);

    expect(facts).toContainEqual(
      expect.objectContaining({ field: "data", dependsOn: ["data"], confidence: "high" })
    );
  });

  it("grades a direct property read of a single local as high confidence", () => {
    const facts = analyze(`
      function useRecord() {
        const user = useAppSelector(selectUser);
        return { name: user?.name };
      }
    `);

    expect(facts).toContainEqual(
      expect.objectContaining({ field: "name", dependsOn: ["user"], confidence: "high" })
    );
  });

  it("grades a two-hop unambiguous chain as medium confidence", () => {
    const facts = analyze(`
      function useRecord() {
        const a = useAppSelector(selectA);
        const b = a.y;
        return { z: b };
      }
    `);

    const z = facts.find((fact) => fact.field === "z");
    expect(z?.dependsOn.sort()).toEqual(["a", "b"]);
    expect(z?.confidence).toBe("medium");
  });

  it("keeps every directly referenced input and grades a multi-input expression as medium", () => {
    const facts = analyze(`
      function useRecord() {
        const x = useAppSelector(selectX);
        const y = useAppSelector(selectY);
        return { z: x ?? y };
      }
    `);

    const z = facts.find((fact) => fact.field === "z");
    expect(z?.dependsOn.sort()).toEqual(["x", "y"]);
    expect(z?.confidence).toBe("medium");
  });

  it("records the TypeScript type and a proven collection transformation", () => {
    const facts = analyze(`
      type Company = { id: string; name: string };
      type CompanyList = { find(predicate: (company: Company) => boolean): Company | undefined };
      declare const selectCompanies: () => CompanyList;
      declare const selectCompanyId: () => string;
      declare function useAppSelector<T>(selector: () => T): T;

      function useRecord() {
        const companies = useAppSelector(selectCompanies);
        const companyId = useAppSelector(selectCompanyId);
        const company = companies.find((item) => item.id === companyId);
        return { company };
      }
    `);

    expect(facts.find((fact) => fact.field === "company")?.valueSemantics).toEqual({
      type: "Company | undefined",
      transformation: {
        kind: "find",
        inputPaths: ["companies", "companyId"],
        expression: "companies.find((item) => item.id === companyId)",
        code: "const company = companies.find((item) => item.id === companyId);",
        operation: "find",
        file: "src/features/record/model/useRecord.ts",
        line: 11,
        endLine: 11,
        expressionLine: 11,
      },
    });
  });

  it("grades each returned field independently in a single pass", () => {
    const facts = analyze(`
      function useRecord() {
        const user = useAppSelector(selectUser);
        const flag = useAppSelector(selectFlag);
        const derived = user.id;
        const label = derived;
        return {
          direct: user,
          chained: label,
          ambiguous: user ?? flag,
        };
      }
    `);

    expect(facts.find((fact) => fact.field === "direct")?.confidence).toBe("high");
    expect(facts.find((fact) => fact.field === "chained")?.confidence).toBe("medium");
    expect(facts.find((fact) => fact.field === "ambiguous")?.confidence).toBe("medium");
  });

  it("follows a derived value transitively to its source locals", () => {
    const facts = analyze(`
      const useRecord = () => {
        const data = useAppSelector(selectData);
        const flag = useAppSelector(selectFlag);
        const summary = useMemo(() => build(data, flag), [data, flag]);
        return { summary };
      };
    `);

    const summary = facts.find((fact) => fact.field === "summary");
    expect(summary?.dependsOn.sort()).toEqual(["data", "flag", "summary"]);
  });

  it("records a literal return as an explicit boundary", () => {
    const facts = analyze(`
      function useRecord() {
        return { constantFlag: true };
      }
    `);
    expect(facts).toEqual([
      expect.objectContaining({
        field: "constantFlag",
        dependsOn: [],
        boundarySources: [expect.objectContaining({ name: "true", kind: "literal" })],
        valueSemantics: expect.objectContaining({
          type: "true",
          transformation: expect.objectContaining({ kind: "constant" }),
        }),
      }),
    ]);
  });

  it("classifies parameters, local state, callbacks and direct imports as boundaries", () => {
    const facts = analyze(`
      import { STATIC_FIELDS } from "./constants";
      const useRecord = ({ initialOpen }) => {
        const [open, setOpen] = useState(initialOpen);
        const close = () => setOpen(false);
        return { open, close, fields: STATIC_FIELDS };
      };
    `);

    expect(facts.find((fact) => fact.field === "open")?.boundarySources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "open", kind: "local-state" }),
    ]));
    expect(facts.find((fact) => fact.field === "close")?.boundarySources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "close", kind: "local-callback" }),
    ]));
    expect(facts.find((fact) => fact.field === "fields")?.boundarySources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "STATIC_FIELDS", kind: "import" }),
    ]));
  });

  it("opens an imported constant at its actual declaration", () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strictNullChecks: true } });
    project.createSourceFile(
      "/project/src/features/record/model/constants.ts",
      `export const STATIC_FIELDS = { name: true, phone: true } as const;`
    );
    const sourceFile = project.createSourceFile(
      "/project/src/features/record/model/useRecord.ts",
      `
        import { STATIC_FIELDS } from "./constants";
        export function useRecord() {
          return { fields: STATIC_FIELDS };
        }
      `
    );

    const fields = detectHookReturnDependencies(
      sourceFile,
      "src/features/record/model/useRecord.ts"
    ).find((fact) => fact.field === "fields");

    expect(fields?.valueSemantics?.transformation).toMatchObject({
      kind: "constant",
      expression: "STATIC_FIELDS",
      code: "export const STATIC_FIELDS = { name: true, phone: true } as const;",
      file: "src/features/record/model/constants.ts",
      line: 1,
      endLine: 1,
      expressionLine: 1,
    });
  });

  it("classifies a memoized callback as a local callback boundary", () => {
    const facts = analyze(`
      const useRecord = () => {
        const dispatch = useAppDispatch();
        const submit = useCallback(() => dispatch(saveRecord()), [dispatch]);
        return { submit };
      };
    `);

    expect(facts.find((fact) => fact.field === "submit")?.boundarySources).toEqual([
      expect.objectContaining({ name: "submit", kind: "local-callback" }),
    ]);
    expect(facts.find((fact) => fact.field === "submit")?.hookSources).toEqual([]);
    expect(facts.find((fact) => fact.field === "submit")).toMatchObject({
      dependsOn: [],
      confidence: "high",
    });
  });

  it("does not treat values captured by a returned callback as origins of the function object", () => {
    const facts = analyze(`
      const useRecord = () => {
        const record = useAppSelector(selectRecord);
        const submit = useCallback(() => saveRecord(record), [record]);
        return { submit };
      };
    `);

    expect(facts.find((fact) => fact.field === "submit")).toMatchObject({
      dependsOn: [],
      boundarySources: [expect.objectContaining({ name: "submit", kind: "local-callback" })],
      confidence: "high",
    });
  });

  it("classifies imported member values and inline returned callbacks as boundaries", () => {
    const facts = analyze(`
      import { GROUPS } from "./groups";
      const useRecord = () => ({
        title: GROUPS.record.title,
        reset: () => clearRecord(),
      });
    `);

    expect(facts.find((fact) => fact.field === "title")?.boundarySources).toEqual([
      expect.objectContaining({ name: "GROUPS", kind: "import" }),
    ]);
    expect(facts.find((fact) => fact.field === "reset")?.boundarySources).toEqual([
      expect.objectContaining({ name: "inline callback", kind: "local-callback" }),
    ]);
  });

  it("connects an identifier returned by a nested custom hook", () => {
    const facts = analyze(`
      const useNavigate = () => {
        const navigate = useCallback(() => openPage(), []);
        return navigate;
      };
      const useRecord = () => {
        const navigate = useNavigate();
        const query = useRecordQuery();
        return { navigate, queryName: query.data?.name };
      };
    `);

    expect(facts.find((fact) => fact.hookName === "useNavigate")).toMatchObject({
      field: "$return",
      boundarySources: [expect.objectContaining({ name: "navigate", kind: "local-callback" })],
    });
    expect(facts.find((fact) => fact.hookName === "useRecord")).toMatchObject({
      field: "navigate",
      hookSources: [{ localName: "navigate", hookName: "useNavigate", field: "$return" }],
    });
    expect(facts.find((fact) => fact.field === "queryName")?.hookSources ?? []).toEqual([]);
  });

  it("follows a computed local to destructured hook parameters", () => {
    const facts = analyze(`
      const useRecord = ({ record, fallback }) => {
        const title = record?.title ?? fallback;
        return { title };
      };
    `);

    expect(facts.find((fact) => fact.field === "title")?.boundarySources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "record", kind: "parameter" }),
      expect.objectContaining({ name: "fallback", kind: "parameter" }),
    ]));
  });

  it("does not hide unresolved custom-hook composition behind a boundary", () => {
    const facts = analyze(`
      import { useRemoteRecord } from "./useRemoteRecord";
      const useRecord = () => {
        const remote = useRemoteRecord();
        return { remote, direct: useRemoteRecord() };
      };
    `);

    expect(facts.find((fact) => fact.field === "remote")?.boundarySources ?? []).toEqual([]);
    expect(facts.some((fact) => fact.field === "direct")).toBe(false);
  });

  it("records a destructured nested hook field as an origin candidate", () => {
    const facts = analyze(`
      function useRecord() {
        const { data: recordData } = useRecordQuery();
        return { data: recordData };
      }
    `);

    expect(facts).toContainEqual(expect.objectContaining({
      hookName: "useRecord",
      field: "data",
      dependsOn: ["recordData"],
      hookSources: [{
        localName: "recordData",
        hookName: "useRecordQuery",
        field: "data",
      }],
    }));
  });

  it("ignores returns from nested hook callbacks when reading the public hook return", () => {
    const facts = analyze(`
      const useRecord = () => {
        const isLoading = useAppSelector(selectLoading);
        const fields = useMemo(() => {
          const availableFields = [];
          return availableFields;
        }, []);
        return { fields, isLoading };
      };
    `);

    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fields", dependsOn: expect.arrayContaining(["fields"]) }),
      expect.objectContaining({ field: "isLoading", dependsOn: ["isLoading"] }),
    ]));
    expect(facts.some((fact) => fact.field === "availableFields")).toBe(false);
  });
});
