import { Project, type SourceFile } from "ts-morph";
import { describe, expect, it } from "vitest";
import { analyzeRedux } from "../src/analyzers/redux/analyzeRedux.js";
import { defaultConfig } from "../src/config/defaultConfig.js";
import type { ResolvedProjectMapConfig } from "../src/config/types.js";

describe("analyzeRedux thunks and extraReducers", () => {
  it("detects createAsyncThunk definitions", () => {
    const facts = analyze(`
      import { createAsyncThunk } from "@reduxjs/toolkit";
      export const fetchRecord = createAsyncThunk("records/fetchRecord", async (id: string) => {
        return await api.get(id);
      });
    `);

    expect(facts).toContainEqual(expect.objectContaining({
      type: "reduxThunk",
      name: "fetchRecord",
      typePrefix: "records/fetchRecord",
    }));
  });

  it("extracts URL-literal HTTP calls from the payload creator", () => {
    const facts = analyze(`
      import { createAsyncThunk } from "@reduxjs/toolkit";
      export const fetchRecord = createAsyncThunk("records/fetchRecord", async (id: string) => {
        const res = await api.get(\`/records/\${id}\`);
        return res.data;
      });
      export const saveRecord = createAsyncThunk("records/saveRecord", async (record) => {
        return fetch("/api/records", { method: "POST", body: JSON.stringify(record) });
      });
      export const reset = createAsyncThunk("records/reset", async (id) => store.get(id));
    `);

    expect(facts.find((fact) => fact.type === "reduxThunk" && fact.name === "fetchRecord")).toMatchObject({
      apiCalls: [{ method: "GET", url: "/records/${id}" }],
    });
    expect(facts.find((fact) => fact.type === "reduxThunk" && fact.name === "saveRecord")).toMatchObject({
      apiCalls: [{ method: "POST", url: "/api/records" }],
    });
    // store.get(id) is not an HTTP call (no URL-like string) -> no apiCalls.
    expect(facts.find((fact) => fact.type === "reduxThunk" && fact.name === "reset")).not.toHaveProperty("apiCalls");
  });

  it("keeps imported API/service calls when the endpoint is hidden by a client", () => {
    const facts = analyze(`
      import { createAsyncThunk } from "@reduxjs/toolkit";
      import { recordsApi } from "../api/recordsApi";
      import saveRecordRequest from "../services/saveRecord";
      import { normalizeRecord } from "../lib/normalizeRecord";
      export const fetchRecord = createAsyncThunk("records/fetchRecord", async (id: string) => {
        const record = await recordsApi.getRecord(id);
        await saveRecordRequest(record);
        return normalizeRecord(record);
      });
    `);

    expect(facts.find((fact) => fact.type === "reduxThunk" && fact.name === "fetchRecord")).toMatchObject({
      apiCalls: [
        { kind: "service", method: "CALL", url: "recordsApi.getRecord" },
        { kind: "service", method: "CALL", url: "saveRecordRequest" },
      ],
    });
  });

  it("finds API clients injected through thunk extra and unwraps request guards", () => {
    const facts = analyze(`
      import { createAsyncThunk } from "@reduxjs/toolkit";
      import { withRequestGuard } from "~/shared/lib/request-guard";
      export const loadRecords = createAsyncThunk(
        "records/loadRecords",
        async ({ workspaceId }, { extra: { serviceClient }, rejectWithValue }) => {
          const records = await withRequestGuard(() =>
            serviceClient.records.list({ workspaceId })
          );
          return records ?? rejectWithValue({ error: true });
        }
      );
    `);

    expect(facts.find((fact) => fact.type === "reduxThunk" && fact.name === "loadRecords")).toMatchObject({
      apiCalls: [
        {
          kind: "service",
          method: "CALL",
          url: "serviceClient.records.list",
          code: `const records = await withRequestGuard(() =>
            serviceClient.records.list({ workspaceId })
          );`,
          codeStartLine: 7,
          line: 8,
        },
      ],
    });
  });

  it("keeps the complete statement around API calls and focuses each exact call", () => {
    const facts = analyze(`
      import { createAsyncThunk } from "@reduxjs/toolkit";
      import { recordsApi } from "../api/recordsApi";
      export const loadRecords = createAsyncThunk("records/loadRecords", async () => {
        const [active, archived] = await Promise.all([
          recordsApi.getActive(),
          recordsApi.getArchived(),
        ]);
        return { active, archived };
      });
    `);

    const thunk = facts.find((fact) => fact.type === "reduxThunk" && fact.name === "loadRecords");
    expect(thunk).toMatchObject({
      apiCalls: [
        {
          url: "recordsApi.getActive",
          codeStartLine: 5,
          line: 6,
          code: `const [active, archived] = await Promise.all([
          recordsApi.getActive(),
          recordsApi.getArchived(),
        ]);`,
        },
        {
          url: "recordsApi.getArchived",
          codeStartLine: 5,
          line: 7,
        },
      ],
    });
  });

  it("detects dispatch through a parameter, store property and inline dispatch hook", () => {
    const facts = analyze(`
      export function useRecordActions(dispatch) {
        dispatch(fetchRecord());
        appStore.dispatch(resetRecord());
        useAppDispatch()(saveRecord());
      }
    `);

    expect(facts.filter((fact) => fact.type === "dispatchCall").map((fact) => fact.actionName)).toEqual([
      "fetchRecord",
      "resetRecord",
      "saveRecord",
    ]);
  });

  it("attributes dispatch in a nested callback to its containing hook", () => {
    const facts = analyze(`
      export const useEditRecord = () => {
        const dispatch = useAppDispatch();
        const onSubmit = async () => {
          await dispatch(saveRecord()).unwrap();
        };
        return { onSubmit };
      };
    `);

    expect(facts.find((fact) => fact.type === "dispatchCall")).toMatchObject({
      owner: "useEditRecord",
      actionName: "saveRecord",
    });
  });

  it("detects slice writes from builder-style extraReducers", () => {
    const facts = analyze(`
      import { createSlice } from "@reduxjs/toolkit";
      export const recordSlice = createSlice({
        name: "record",
        initialState: {},
        reducers: {},
        extraReducers: (builder) => {
          builder
            .addCase(fetchRecord.fulfilled, (state, action) => {
              state.current = action.payload.data;
              state.status = "ready";
            })
            .addCase(fetchRecord.rejected, (state) => {
              state.current = null;
              state.status = "failed";
            })
            .addCase(fetchSummary.fulfilled, (state, { payload: summary }) => {
              state.summary = summary;
            })
            .addCase(resetAll, (state) => state);
        },
      });
    `);

    const writes = facts.filter((fact) => fact.type === "sliceWrite");
    expect(writes).toHaveLength(4);
    expect(writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ sliceName: "record", writerName: "fetchRecord", writerState: "fulfilled" }),
      expect.objectContaining({ sliceName: "record", writerName: "fetchRecord", writerState: "rejected" }),
      expect.objectContaining({ sliceName: "record", writerName: "resetAll", writerState: null }),
    ]));
    expect(writes.find((fact) =>
      fact.writerName === "fetchRecord" && fact.writerState === "fulfilled"
    )).toMatchObject({
      codeStartLine: 9,
      location: { line: 9 },
      code: `addCase(fetchRecord.fulfilled, (state, action) => {
              state.current = action.payload.data;
              state.status = "ready";
            })`,
      writes: [
        {
          statePath: "current",
          valueOrigin: "payload",
          payloadPath: "data",
          code: "state.current = action.payload.data",
        },
        {
          statePath: "status",
          valueOrigin: "literal",
          code: "state.status = \"ready\"",
        },
      ],
    });
    expect(writes.find((fact) =>
      fact.writerName === "fetchRecord" && fact.writerState === "rejected"
    )).toMatchObject({
      code: `addCase(fetchRecord.rejected, (state) => {
              state.current = null;
              state.status = "failed";
            })`,
      writes: [
        expect.objectContaining({ statePath: "current", valueOrigin: "reset" }),
        expect.objectContaining({ statePath: "status", valueOrigin: "literal" }),
      ],
    });
    expect(writes.find((fact) =>
      fact.writerName === "fetchSummary" && fact.writerState === "fulfilled"
    )).toMatchObject({
      writes: [
        expect.objectContaining({ statePath: "summary", valueOrigin: "payload" }),
      ],
    });
  });

  it("captures exact writes from synchronous slice reducers", () => {
    const facts = analyze(`
      import { createSlice } from "@reduxjs/toolkit";
      export const recordSlice = createSlice({
        name: "record",
        initialState: { error: true },
        reducers: {
          resetError: (state) => {
            state.error = false;
          },
        },
      });
    `);

    expect(facts.find((fact) => fact.type === "reduxAction" && fact.name === "resetError")).toMatchObject({
      sliceName: "record",
      writes: [{ statePath: "error", valueOrigin: "literal", code: "state.error = false" }],
    });
  });

  it("recognizes destructured payload writes and derived values", () => {
    const facts = analyze(`
      import { createSlice } from "@reduxjs/toolkit";
      export const recordSlice = createSlice({
        name: "record",
        initialState: {},
        reducers: {},
        extraReducers: (builder) => {
          builder.addCase(fetchRecord.fulfilled, (state, { payload }) => {
            state.current = payload.data;
            state.count = payload.items.length;
          });
        },
      });
    `);

    expect(facts.find((fact) =>
      fact.type === "sliceWrite" && fact.writerName === "fetchRecord"
    )).toMatchObject({
      writes: [
        expect.objectContaining({
          statePath: "current",
          valueOrigin: "payload",
          payloadPath: "data",
        }),
        expect.objectContaining({
          statePath: "count",
          valueOrigin: "payload",
          payloadPath: "items.length",
        }),
      ],
    });
  });

  it("follows local payload aliases into exact reducer writes", () => {
    const facts = analyze(`
      import { createSlice } from "@reduxjs/toolkit";
      export const recordSlice = createSlice({
        name: "record",
        initialState: {},
        reducers: {},
        extraReducers: (builder) => {
          builder.addCase(fetchRecord.fulfilled, (state, { payload, meta }) => {
            const { data: records, status } = payload;
            const count = records.length;
            state.current = records;
            state.status = status;
            state.count = count;
            state.requestId = meta.requestId;
          });
        },
      });
    `);

    expect(facts.find((fact) =>
      fact.type === "sliceWrite" && fact.writerName === "fetchRecord"
    )).toMatchObject({
      writes: [
        expect.objectContaining({ statePath: "current", valueOrigin: "payload", payloadPath: "data" }),
        expect.objectContaining({ statePath: "status", valueOrigin: "payload", payloadPath: "status" }),
        expect.objectContaining({ statePath: "count", valueOrigin: "payload", payloadPath: "data.length" }),
        expect.objectContaining({ statePath: "requestId", valueOrigin: "derived" }),
      ],
    });
  });

  it("keeps a payload-derived optional-chain alias explicit", () => {
    const facts = analyze(`
      import { createSlice } from "@reduxjs/toolkit";
      export const recordSlice = createSlice({
        name: "record",
        initialState: {},
        reducers: {},
        extraReducers: (builder) => {
          builder.addCase(fetchRecord.rejected, (state, { payload }) => {
            const message = payload?.response?.error?.message;
            state.error = message;
          });
        },
      });
    `);

    expect(facts.find((fact) => fact.type === "sliceWrite")).toMatchObject({
      writes: [expect.objectContaining({ statePath: "error", valueOrigin: "payload" })],
    });
  });

  it("classifies a direct imported constant write as derived", () => {
    const facts = analyze(`
      import { createSlice } from "@reduxjs/toolkit";
      import { RecordStatus } from "./types";
      export const recordSlice = createSlice({
        name: "record",
        initialState: {},
        reducers: {},
        extraReducers: (builder) => {
          builder.addCase(fetchRecord.pending, (state) => {
            state.status = RecordStatus.Pending;
          });
        },
      });
    `);

    expect(facts.find((fact) => fact.type === "sliceWrite")).toMatchObject({
      writes: [expect.objectContaining({ statePath: "status", valueOrigin: "derived" })],
    });
  });

  it("detects slice writes from object-map extraReducers", () => {
    const facts = analyze(`
      import { createSlice } from "@reduxjs/toolkit";
      export const recordSlice = createSlice({
        name: "record",
        initialState: {},
        reducers: {},
        extraReducers: {
          [fetchRecord.pending]: (state) => state,
        },
      });
    `);

    expect(facts.filter((fact) => fact.type === "sliceWrite")).toEqual([
      expect.objectContaining({ sliceName: "record", writerName: "fetchRecord", writerState: "pending" }),
    ]);
  });
});

function analyze(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile: SourceFile = project.createSourceFile("/project/src/entities/record/model/slice.ts", code);
  return analyzeRedux(sourceFile, "/project", config());
}

function config(): ResolvedProjectMapConfig {
  return {
    ...defaultConfig,
    projectRoot: "/project",
    sourceRootAbs: "/project/src",
    outputDirAbs: "/project/.project-map",
    tsconfigPathAbs: null,
  };
}
