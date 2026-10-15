# Execution log

Every meaningful step taken on this repository, oldest first. Append; never rewrite history.
Format: `## YYYY-MM-DD HH:MM TZ — short title` then bullets of what was run/changed and the outcome.

## 2026-10-15 14:06 WAT — Baseline (M1)
- Read README, package.json, analysis/layout/state/UI code (three parallel exploration passes).
- `pnpm test` under Node 21.7.3 fails (`ERR_INVALID_ARG_VALUE` inside vitest 5). Under Node 22.15.0 (per `.nvmrc`): 5 files, 84 tests pass.
- `pnpm typecheck` and `pnpm lint` pass.
- `.claude/launch.json` now starts `pnpm dev` itself (was attach-only). Dev server came up on :3001; landing page and `/pallets/flask` city render.
- Created EXECUTION.md, LEARNINGS.md, INTERFACE.md and the work-log hook (`.claude/hooks/work-log.mjs`).

## 2026-10-15 14:29 WAT — Shared analysis engine (M2)
- Added deps: web-tree-sitter 0.27.1 and the official grammar packages (typescript 0.23.2, javascript/python/go 0.25.0), zod 4.6.7, @modelcontextprotocol/server 2.3.1, ignore 7.
- Spike: all five grammars (ts, tsx, js, python, go) load in Node from their npm `.wasm` files. Kept tree-sitter as the parser.
- New `src/lib/analysis/code/`:
  - extractors for JS/TS (symbols, imports with bindings, exports, calls, Express-style and Next.js routes, JSX references), Python (Flask/FastAPI decorators, `__main__`) and Go (net/http routes, `func main`);
  - `buildIndex` with a resolver that follows bindings and re-exports;
  - `overview`, `journeys`, `onboarding` and `queries`.
- `src/lib/analysis/workspace.ts`: `analyzeRepository()` is the single entry point. `traceImports` is now a thin adapter over it, so GitHub mode uses the same engine.
- New `src/lib/local/`: `safety` (path containment, sensitive files, redaction), `revision` (reads .git files, never runs git), `walk` (.gitignore, excluded dirs, symlinks), `workspace` (cache, freshness, excerpts, content search), `wasm` (locator).
- Fixed pipeline defects:
  - The root folder is now detected as a package.
  - The comment on the `build`/`out`/`target` exclusion now matches the code.
  - `RepoModel.origin` and `ExclusionSummary.skippedDirs` were added.
- Fixtures in `test/fixtures/`: ts-express-api, py-flask, next-app, go-service. Hostile cases are generated at test time.
- Tests: `code.test.ts` (extraction lines, edges, journeys, overview, queries) and `local.test.ts` (traversal, symlinks, secrets, redaction, gitignore, caps, freshness, revision). 111 tests pass; lint and typecheck are clean.
- Measured:
  - this repo: 144 files, 118 parsed, about 0.26 s;
  - three.js `src`: 1,257 files, 1,244 parsed, about 3.0 s, about 350 MB RSS including vitest, 4 MB of analysis JSON.

## 2026-10-15 14:52 WAT — MCP server, CLI and viewer (M3)
- Read the installed SDK's typings to confirm the v2 API: `registerTool`/`registerPrompt` take `z.object` schemas, `McpServer` accepts `instructions`, and `InMemoryTransport.createLinkedPair` exists.
- `src/mcp/`:
  - `server.ts`: instructions under 4 kB, the `codescape://overview` resource, and the `onboard` and `investigate` prompts.
  - `context.ts`: result bounding at 24k chars, guarded errors.
  - `targets.ts`: path / symbol id / name resolution.
  - Seven tools in `tools/`.
- `src/cli/`: `codescape mcp|view|analyze`. The root comes from `--root`, then CODESCAPE_ROOT, then CLAUDE_PROJECT_DIR, then cwd. `viewer.ts` spawns `next start -H 127.0.0.1` with CODESCAPE_ROOT, probes `/api/workspace/status`, reuses a matching viewer and kills its child on exit.
- `scripts/build-cli.mjs` (esbuild) produces `dist/cli.mjs` plus `dist/wasm/`. `scripts/wasm-files.mjs` also feeds `public/wasm` via predev, prebuild and postinstall.
- Next API routes `/api/workspace`, `/api/workspace/file` and `/api/workspace/status` run behind a loopback Host check plus Sec-Fetch-Site and Origin checks. Verified with curl:
  - a `..` path → 403;
  - Host evil.example.com → 403;
  - a cross-site request → 403.
- Tests: `src/mcp/mcp.test.ts` (contract, validation, traversal, size ceiling, CLI args, raw stdio JSON-RPC against the built binary). `pretest` builds the CLI. 126 tests pass.
- `codescape view --root test/fixtures/py-flask`: the viewer serves the page and the analysis, and stops with the parent process.
- Real Claude Code (`claude -p --mcp-config … --strict-mcp-config`): the server **connected** and all 7 tools were listed. The model call failed with "OAuth session expired" because the CLI isn't logged in here, so the LLM half of the loop is unverified.
- Same flow over stdio with a scripted client: overview → trace "POST /users" (5 steps, file:line) → open_in_codescape → page 200, the viewer serves the right root and the journey id resolves. A second open reuses the viewer, which stops when the MCP server exits. About 1 s total.

## 2026-10-15 14:52 WAT — Web workflows (M4, first pass)
- Store: `analysis`, `journey` (`JourneyFocus`), `symbol`, and `panel: "guide"`; `playJourney` and `stepJourney`.
- Loader:
  - `loadLocalWorkspace()` for `/local`;
  - GitHub mode now runs `analyzeModel()` in the browser over the same 300-file bounded set (tree-sitter WASM from `/wasm`), so GitHub cities get symbols, journeys and the guide too.
- `src/state/deepLinks.ts`: `?select=&symbol=&journey=` is applied after assembly and written back with `replaceState`.
- UI:
  - `GuidePanel` (what this is, reading order, journeys, modules, run/test, questions, limits; auto-opens once per city on wide screens);
  - `JourneyBar` (`[` `]` Esc);
  - `CodeInspector` in InfoPanel (declarations, symbol excerpt, calls / called by / leaves the repo, routes, related tests, Trace from here);
  - `Evidence` (BasisBadge, LocLink, SourceExcerpt);
  - declarations in search (with a scope toggle);
  - a Guide button and the `G` key.
- 3D: `JourneyPath` (numbered stops, static violet arcs, dashed exits labelled with the package). Selection arcs became static with arrowheads; there are no marching dashes anymore.
- Local-mode chrome: a folder avatar (no request to github.com), a Local badge, a RepoPanel showing root, branch and commit, and editor links (`vscode://file…:line`).
- Verified in the browser pane:
  - `/local` loads the fixture city and opens the guide;
  - clicking the POST /users journey selects step 1 with an excerpt and updates the URL;
  - searching `findUser` and pressing Enter flies to client.ts with `Database.findUser` selected and a static arc.
- The cold deep-link check could not be finished: the browser pane was hidden, so `requestAnimationFrame` stopped firing (0 frames/s) and the city never assembled. This is moved to the Playwright e2e test.
- `pnpm build`: all routes compile; `/api/workspace*` are dynamic.

## 2026-10-15 15:29 WAT — Polish, end-to-end tests, product readiness (M5/M6)
- **Honesty and copy:**
  - static arcs with proportionate arrowheads;
  - "import flows" instead of "transit";
  - literal loading steps and error titles;
  - corrected copy for height and isolate;
  - the landing village is labelled illustrative;
  - Role-lens colours unified;
  - entry points show verified (manifest, route, main) versus naming-only.
- **Accessibility:**
  - `MotionConfig reducedMotion="user"`;
  - focus trap and `aria-modal` on Search and Help;
  - side sheets are `role=region`;
  - a keyboard `FileTree` (guide › Files);
  - the landing input got an accessible name (found by Playwright);
  - the live region announces journey steps;
  - panel text is selectable.
- **Layout:**
  - one sheet at a time on phones (`togglePanel`, `select`);
  - the journey bar stays clear of open panels;
  - the legend is hidden while a left panel is open.
- **Playwright** (`e2e/`, `playwright.config.ts`): runs headless Chromium with SwiftShader WebGL against `next start` serving the ts-express-api fixture. 9 specs pass:
  - guide;
  - journey play, step and cold deep link;
  - Escape;
  - search to source;
  - keyboard tree;
  - error recovery;
  - API guards;
  - landing validation;
  - reduced motion.
- **GitHub-mode regression** (live, not committed): pallets/flask (235 files, 83 parsed, 926 symbols, 540 calls, no fallback) and pmndrs/zustand (49 parsed, Library/package). This found and fixed a false "depends on Flask" caused by the project's own name; a regression test now covers it.
- **Docs and project files:**
  - README rewritten;
  - `docs/ARCHITECTURE.md`, `docs/MCP.md`, `docs/STRATEGY.md`;
  - CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1 by reference), SECURITY;
  - LICENSE (MIT, © 2026 mxnuchim); all runtime dependencies checked: MIT / Apache-2.0 / Zlib, plus OFL fonts;
  - `.github` issue and PR templates, CI (lint, typecheck, test, build, build:cli, CLI smoke test, then a Playwright e2e job), Dependabot.
- **Final verification:** `pnpm lint`, `typecheck`, `test` (127 tests), `build`, `build:cli`, `test:e2e` (9) all pass. Screenshots are in `docs/images/`.
