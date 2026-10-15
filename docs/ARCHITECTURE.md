# Architecture

CodeScape has one analysis engine and three surfaces: the browser (GitHub mode), the local viewer and the MCP server. All three call the same function, so the map and Claude always describe the code the same way.

```
                     ┌──────────────── src/lib/analysis (pure, isomorphic) ─────────────────┐
 RepoSnapshot ──────▶│ buildRepoModel → buildCodeIndex → overview · journeys · onboarding   │──▶ WorkspaceAnalysis
 (file tree)         │   (tree-sitter parse, import + call resolution, evidence lines)      │
 readText(path) ────▶│                                                                      │
                     └──────────────────────────────────────────────────────────────────────┘
        ▲                               ▲                                 ▲
  GitHub API + raw files         src/lib/local                      src/lib/local
  (browser, loader.ts)           (Next API routes, /local)          (MCP server, CLI)
        │                               │                                 │
        ▼                               ▼                                 ▼
  3D city + panels            3D city + panels (localhost)       7 tools · 1 resource · 2 prompts
```

## Layers

Dependencies point downward only: the UI depends on the engine, and the engine knows nothing about rendering, HTTP or MCP.

| Folder | Responsibility | Runs in |
|---|---|---|
| `src/lib/analysis/` | File classification, exclusions, the repository model and the building budget (`buildModel.ts`, `classify.ts`) | Node and browser |
| `src/lib/analysis/code/` | Parsing (`parser.ts`, `extract-*.ts`), the index and the resolver (`buildIndex.ts`), `overview.ts`, `journeys.ts`, `onboarding.ts` and `queries.ts` | Node and browser |
| `src/lib/analysis/workspace.ts` | `analyzeRepository()` / `analyzeModel()`: the single entry point, plus the `WorkspaceAnalysis` contract | Node and browser |
| `src/lib/layout/` | Deterministic city layout (squarified treemap). Plain numbers, no Three.js. | Node and browser |
| `src/lib/local/` | Safe filesystem access (`safety.ts`), the .gitignore-aware walk (`walk.ts`), the git revision read from files (`revision.ts`), `LocalWorkspace` (caching and freshness), WASM location | Node only |
| `src/mcp/` | MCP server, tools, target resolution and result bounding | Node only |
| `src/cli/` | The `codescape` command and the viewer launcher | Node only |
| `src/app/api/workspace/` | Localhost-only API for the viewer: analysis, excerpts, status | Next.js server |
| `src/state/` | zustand store, loaders (GitHub, bundled snapshot, local), deep links | Browser |
| `src/components/` | The React Three Fiber world and the interface | Browser |

## The engine

1. **Model.** `buildRepoModel(snapshot)` turns a list of paths and sizes into folders and files with classifications, landmarks and exclusions. Folders that would push the city over its 2,500-building budget are collapsed into blocks. The result is deterministic: entries are sorted, and ties break by path.
2. **Index.** `buildCodeIndex(model, { readText })` reads a prioritised, bounded set of files (entry points first, then source by depth, then tests). It parses each file with tree-sitter into symbols with line ranges, imports with their bindings, exports, call sites with the enclosing symbol, and route registrations. Then it resolves:
   - **Imports → files:** relative paths, tsconfig `paths`/`baseUrl`, Python packages and relative imports, and Go packages under `go.mod`.
   - **Calls → declarations:** only through real bindings. That means a same-file declaration, an imported binding (following re-exports up to 6 hops), `this.x()` / `self.x()` inside a class, an instance of a known class, or `pkg.Func` in Go.
   - **Calls into packages:** recorded as `external` references, which show where a journey leaves the repository.
   - Nothing is inferred from names that merely look alike.
3. **Overview.** Technologies and commands come from manifests, each with the line it was read from. Entry points come from manifest `main`/`bin`/`scripts`, route registrations, `__main__` / `func main` and framework conventions; naming conventions are only a fallback, labelled heuristic. Modules are workspace packages, or top-level folders with a dominant `src` expanded. Their roles come from route counts (static analysis) or folder names (heuristic). The overview ends with a list of limitations.
4. **Journeys.** Starts are HTTP routes (Express-style, Next.js app router and pages API, Flask/FastAPI decorators, Go `net/http` and routers), Next.js pages and `main` blocks. From each start, the walk follows call edges depth-first in source order, up to 30 steps and 6 levels deep. It skips same-file helpers that lead nowhere, adds package boundaries as external steps, and records gaps:
   - unresolved handlers;
   - calls through object fields (`this.repo.save()`);
   - the step and depth limits.
5. **Onboarding.** The README and the manifest come first, then the strongest entry points, then the steps of the representative journey. After those come the files most other code depends on (distinct non-test importers plus resolved callers) and a related test. Every item records its reason and basis.

Every relationship carries a `basis`: `fact`, `static-analysis` or `heuristic`. Runtime behaviour is never represented.

### Identity and determinism

- Files are identified by their repository path.
- Symbols are `path#QualifiedName`; duplicates get a `@line` suffix.
- Journeys are `kind-slug-hash(startSymbolId)`.
- Layout is seeded by the repository name; buildings and plates are placed by sorting, not randomness.

The same snapshot always produces the same ids, edges, journeys and positions; `code.test.ts` checks this.

### Parsing

`web-tree-sitter` loads the official grammar `.wasm` files for TypeScript, TSX, JavaScript, Python and Go. The same code runs in Node and in the browser; only the WASM locator differs:

- `src/lib/local/wasm.ts` reads bytes from `dist/wasm/` or `node_modules`;
- the browser loads them from `/wasm/`, which `scripts/wasm-files.mjs` copies there.

If the runtime or a grammar fails to load, `fallback.ts` extracts imports with line numbers using regular expressions. It reports no symbols or calls, so nothing is fabricated.

## Local mode

`LocalWorkspace` (`src/lib/local/workspace.ts`) wraps the engine for a folder on disk:

- **Walk.** `.gitignore` files (root and nested) and `.git/info/exclude` are honoured. Excluded folders such as `node_modules` and build output are skipped without being descended into. Symlinks are followed only when they point to a file inside the root. The walk stops at 100,000 entries.
- **Reads.** All reads go through `readRepoText`: path normalisation, `realpath` containment, the sensitive-file policy, a 512 KB cap and binary detection.
- **Freshness.** On each `get()`, at most every 2 seconds, the tree is re-walked (stat calls only) and fingerprinted. If anything changed, the analysis is rebuilt, reusing cached parses for unchanged files (keyed by size and mtime).
- **Excerpts and content search.** Both read from the texts already loaded, and their output is redacted.

## The MCP server

`src/mcp/server.ts` registers seven read-only tools (`registerTool` with zod v4 input and output schemas), the `codescape://overview` resource, and the `onboard` and `investigate` prompts. Each tool is thin: it resolves its target (`targets.ts`), calls the engine's queries, and returns `structuredContent` together with a compact text rendering. Results are capped at 24,000 characters, and expected failures become `isError` results the model can act on.

The analysed root is chosen in this order: `--root`, then `CODESCAPE_ROOT`, then `CLAUDE_PROJECT_DIR`, then the working directory. Stdout carries only JSON-RPC; `console.log` is redirected to stderr.

`open_in_codescape` uses `src/cli/viewer.ts` to find or start the viewer, which is the production Next.js app run as `next start -H 127.0.0.1` with `CODESCAPE_ROOT` set. The launcher probes `/api/workspace/status` to reuse a viewer that already serves the same root. The viewer is a child process, so it stops with the MCP server.

## The web app

- `src/state/loader.ts`:
  - GitHub mode builds the model from the tree, renders it, and then runs `analyzeModel()` in the browser over raw files.
  - Local mode (`/local`) fetches a complete `WorkspaceAnalysis` from `/api/workspace` and builds the same model and layout from its snapshot.
  - Either way, the 3D city uses the existing deterministic layout.
- `src/state/deepLinks.ts` applies `?select=&symbol=&journey=` once the city has assembled, and keeps the URL in sync afterwards.
- `src/components/world/` holds the scene:
  - instanced buildings per archetype and kit part;
  - static arcs with arrowheads (`Connections.tsx`);
  - the journey overlay (`JourneyPath.tsx`).
- `src/components/ui/` holds the guide, inspector (`CodeInspector.tsx`), journey bar, search, file tree and evidence primitives (`Evidence.tsx`).

## Testing

| Suite | Covers |
|---|---|
| `src/lib/analysis/**/*.test.ts` | Classification, model, layout determinism; extraction with exact lines for TS, Python and Go; resolution through aliases and re-exports; journeys; overview; onboarding; queries |
| `src/lib/local/local.test.ts` | Traversal, symlink escapes, sensitive files, redaction, `.gitignore`, entry and parse caps, freshness and parse-cache reuse, git revision from files (loose refs, packed refs, detached HEAD, worktrees). Hostile repositories are generated in a temp dir. |
| `src/mcp/mcp.test.ts` | Tool list and schemas, every tool's output contract, traversal and validation errors, result size ceiling, CLI root resolution, and raw JSON-RPC over stdio against the built `dist/cli.mjs` |
| `e2e/*.spec.ts` (Playwright) | Guide, journeys and stepping, cold deep links, symbol search to source, the keyboard file tree, error recovery, API guards, reduced motion. Runs against the production build serving a fixture. |

The fixtures live in `test/fixtures/`. They are small hand-written repositories (Express, Flask, Next.js, Go) whose exact line numbers the tests assert.
