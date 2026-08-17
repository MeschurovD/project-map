# Project Map

Static semantic project map for React / [Feature-Sliced Design](https://feature-sliced.design/) / Redux codebases.

Project Map scans a TypeScript codebase with [ts-morph](https://ts-morph.com/), extracts raw
facts (components, hooks, JSX usage, selectors, dispatches, RTK Query calls, imports, FSD layers),
normalizes them into a graph of nodes and edges, and serves a local visual explorer for browsing
the result. Every edge carries a `confidence` level and `evidence` (file + line), so the map is
honest about what was inferred versus what is certain.

> Technical documentation is indexed in [`docs/README.md`](./docs/README.md)
> (in Russian).

## Product direction

The current development focus is not a larger all-project graph. It is a reliable,
evidence-backed answer to a concrete developer question: where a UI value comes from and
what it affects.

Target flow:

```text
API → thunk → state field → selector → hook return → component value → prop / UI effect
```

## Quick start

```bash
npm install
npm run build
node dist/cli/index.js open /path/to/react-project
```

Requires Node 20+. When the package binary is available, the user-facing command
is simply:

```bash
project-map open /path/to/react-project
```

`open` checks the existing analysis, scans automatically when artifacts are
missing, stale, or incompatible, starts the local explorer, and opens the
browser. Use `--no-open` in a remote/headless environment and `--no-scan` only
when diagnosing existing artifacts.

During Project Map development, run the same workflow from source:

```bash
npm run explorer -- /path/to/react-project
```

The explorer starts from pages, then follows the product route:

```text
page → component or hook → value → source-to-UI trace → evidence / impact
```

## Advanced CLI usage

### `project-map open`

```bash
project-map open [project-root]
                 [--host <host>] [--port <port>]
                 [--no-open] [--no-scan]
```

### `project-map scan`

Scans a project and writes the `.project-map/` artifacts.

```bash
project-map scan [-p, --project-root <path>]   # default: current directory
```

### `project-map dev`

Starts the local visual explorer without checking or repairing its artifacts.
Prefer `project-map open` for normal use.

```bash
project-map dev [-p, --project-root <path>]   # default: current directory
                [--host <host>]               # default: 127.0.0.1
                [--port <port>]               # default: 3000
```

### Pipeline

```text
React/FSD/Redux project
  → scan (automatic through `open`)
  → ts-morph parse
  → graph.json + flows.json + evidence
  → local explorer
```

## Configuration

Configuration is optional. Place a `.project-map/config.json` in the project root; any subset of
keys is deep-merged over the defaults. A `tsconfig.json` in the project root is picked up
automatically (used to resolve path aliases).

```json
{
  "sourceRoot": "src",
  "fsd": {
    "layers": ["app", "pages", "widgets", "features", "entities", "shared"],
    "segments": ["ui", "model", "api", "lib", "config", "types", "consts"]
  },
  "redux": {
    "selectorHooks": ["useSelector", "useAppSelector"],
    "dispatchHooks": ["useDispatch", "useAppDispatch"]
  },
  "ignore": ["node_modules", "dist", "build", ".next", ".turbo"],
  "outputDir": ".project-map",
  "docs": {
    "enabled": true,
    "mode": "colocated",
    "fileSuffix": ".docs.md",
    "generator": { "type": "opencode", "command": "opencode", "args": ["run"] }
  },
  "e2e": {
    "enabled": true,
    "generator": { "type": "opencode", "command": "opencode", "args": ["run"] }
  }
}
```

`docs` and `e2e` configure the optional generation modules (documentation and Playwright-style
Page Object / e2e coverage). They drive an external generator command (`opencode` by default).

## Artifacts

`scan` writes these files into `outputDir` (default `.project-map/`):

| File               | Contents                                                        |
| ------------------ | --------------------------------------------------------------- |
| `graph.json`       | Normalized nodes + edges (with confidence and evidence)         |
| `flows.json`       | Canonical value traces, confidence, consumers, and gaps          |
| `facts.json`       | Raw extracted facts                                             |
| `unresolved.json`  | Facts that could not be resolved (unknown imports/hooks/JSX)    |
| `stats.json`       | Counts (files, facts, unresolved, nodes, edges)                |
| `config.json`      | The normalized configuration that produced the run             |
| `manifest.json`    | Run identity, schema versions, freshness, and artifact digests   |

The dev server serves these at `/api/graph`, `/api/facts`, `/api/unresolved`, `/api/stats`, plus
`/api/source/*` for source snippets and module endpoints under `/api/docs/*` and `/api/e2e/*`.

## Scripts

| Script              | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `npm run explorer`  | Analyze if needed and open the explorer  |
| `npm run scan`      | Run a scan from source (`tsx`)           |
| `npm run dev`       | Show/run low-level CLI commands          |
| `npm run build`     | Build the CLI bundle and copy the UI     |
| `npm run typecheck` | `tsc --noEmit`                           |
| `npm run test`      | Run the Vitest suite                     |

## License

MIT
