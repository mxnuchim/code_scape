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

## 2026-10-15 17:56 WAT — Rust and Java analysis
- Spike (scratchpad): `tree-sitter-rust@0.24.0` and `tree-sitter-java@0.23.5` are MIT, ship `.wasm` at the package root (ABI 14), load via `Language.load(bytes)` in web-tree-sitter 0.27.1 on Node 22, and parse axum/actix/Spring samples without errors. Added both, pinned exactly, to `scripts/wasm-files.mjs`, `src/lib/local/wasm.ts` and `GRAMMAR_FILES`/`codeLanguageFor`.
- New `extract-rust.ts` (items, `impl`/trait methods as `Type.method`, flattened `use` trees, `mod x;`, typed receivers from params/lets/struct fields, actix/Rocket `#[get]`, axum `.route(get(a).post(b))`, `fn main` in binary roots; test-only routes skipped) and `extract-java.ts` (types incl. nested and records, methods/constructors with param counts, typed fields/locals/params, single/wildcard/static imports, Spring `@RequestMapping` + `@GetMapping`…, `public static void main`).
- New `imports/resolveRust.ts` (Cargo crates incl. workspaces, crate roots, `a.rs`/`a/mod.rs`, `crate::`/`self::`/`super::`, uniform child paths) and `imports/resolveJava.ts` (source roots derived from `package` declarations). `SymbolResolver` got Rust/Java branches: declared receiver types, `pub use` re-exports, globs, same-package Java types, overloads by arg count (ambiguous ⇒ no edge). `CodeIndex.rustCrates` carries crate info to journeys.
- Journeys: generic `main` starts; a call to an interface/trait method adds a "chosen at runtime" gap; field-call gaps are skipped when the declared type resolved.
- Overview: `Cargo.toml`, `pom.xml`, `build.gradle(.kts)` technologies with line evidence, cargo/mvn/gradle commands, Rust/Java project types; Rust and Java removed from "No code parser yet".
- Fixes found on the way: `NON_PRODUCT_DIR` matched Java package folders (`com/example/demo`) and hid every Spring Initializr project's entry points (new `isNonProductPath`); GitHub mode's `planTrace` only counted JS/TS/Python, so pure Go (and now Rust/Java) repos were "unsupported" in the browser (now uses `isParseable`); the JS regex fallback ran on non-JS languages.
- UI copy now comes from `PARSED_LANGUAGES` in `languages.ts`. Docs: README, MCP, ARCHITECTURE, CONTRIBUTING, STRATEGY, fixtures README.
- Fixtures `test/fixtures/rust-axum` (Cargo workspace) and `test/fixtures/java-spring`; tests in `code.test.ts` and `mcp.test.ts`. 137 unit tests pass (was 117); lint (scoped, see LEARNINGS), typecheck, build, build:cli pass. e2e: 8/9 in the full run, the reduced-motion timing spec failed under CPU load and passed alone (16 s of 30 s). A temporary headless Playwright run on java-spring played POST /users to step 5/6 with the interface gap shown.
- Real repos (not committed): spring-petclinic 50/50 files in 0.2 s, "Java web application (Spring Boot)", route journeys; tokio-rs/axum 307 files in 0.9 s, "Rust library"; actix/examples 170 files in 0.5 s, 22 HTTP journeys (e.g. DELETE /file/{s3_key} → Client.delete_file → aws_sdk_s3).

## 2026-10-15 18:31 WAT — Hosted MCP endpoint (npm publishing dropped)
- Decision (maintainer): no npm package. Public repositories connect through a hosted endpoint on the website; private code keeps the local stdio server from a clone.
- Tools now depend on a `CodeWorkspace` interface (`src/mcp/context.ts`); `registerCodescape()` in `server.ts` registers tools, the resource and prompts for any workspace. Tool copy no longer says "local" when hosted.
- New `src/lib/remote/githubWorkspace.ts`: reads one public repository (REST API with optional `GITHUB_TOKEN` for meta and tree, `raw.githubusercontent.com` for up to 600 files, 40 s budget, secrets withheld, redacted excerpts), friendly errors for private/missing/rate-limited, in-memory cache of 24 repositories for 15 minutes.
- New `src/mcp/remote.ts` (`createRemoteMcpHandler` on the SDK's stateless `createMcpHandler`, strict owner/repo/ref validation, website deep links, never spawns a browser) and `src/app/api/mcp/[owner]/[repo]/route.ts` (`maxDuration` 60). `next.config.ts` traces `public/wasm` into that function (confirmed in the route's `.nft.json`).
- UI: "Ask Claude about it" section in the repository panel for GitHub cities (`ClaudeConnect.tsx`) with copy buttons; shared `CopyButton` moved to `common.tsx`.
- Docs: `docs/DEPLOY.md` (Vercel, token, firewall, checks, rollback), `docs/MCP.md` restructured into hosted vs local, README, ARCHITECTURE, SECURITY and STRATEGY updated.
- Verified: `src/mcp/remote.test.ts` (5 tests: path validation, 404, the real MCP client over HTTP against a fake GitHub serving a fixture with all 7 tools and a traced journey, token sent to the API only, the DEPLOY.md curl handshake, private-repo error). Full suite 142 tests, lint, typecheck, build pass. Live run against `next start` on :3300 connected and listed tools; the live GitHub read was refused because this machine had used its 60 anonymous requests, and the tool returned the rate-limit message as designed. In the browser the repository panel shows the command; the unquoted `?ref=` URL broke zsh, so the command now quotes it.

## 2026-10-15 19:10 WAT — Repository library: famous codebases on the landing page
- Read `loader.ts` (`SAMPLE_REPOS`), `Landing.tsx`, `Sheet.tsx`, `useFocusTrap.ts`, `HelpPanel.tsx`, INTERFACE.md and LEARNINGS.md.
- Curated ~68 candidates; checked every one with `curl -L https://github.com/<repo>` (no API quota): all exist and none is archived. Two moved: `facebook/react` → `react/react`, `calcom/cal.com` → `calcom/cal.diy` (dropped). Kept 50 in five categories: Inside big tech, Infrastructure that runs the internet, AI in 2026, Apps you use, Languages and runtimes.
- Fetched each repo's recursive tree from the GitHub API (50 calls; the anonymous quota ran out after 45, the last five waited for the reset). Bundled a scratch script with esbuild (`alias: { "@": "./src" }`) that runs `buildRepoModel` + `planTrace` on the saved trees, so `files`, `sourceFiles` and the main language match what the city shows (moby: 13,289 tree blobs but 3,373 mapped files once `vendor/` is excluded). Facts found on the way and used in hooks: microsoft/TypeScript now holds a Go compiler in `tsc/`; oven-sh/bun's README says it's written in Rust (`src/` has 3,155 `.rs` files, no `.zig`).
- New `src/lib/repoLibrary.ts`: `LIBRARY` (categories → repos with title, hook, language, files, sourceFiles, truncated, keywords), `FEATURED` (5 landing picks), `analysisHint()` (full / partial / map, derived from counts and `PARSED_LANGUAGES`), `searchLibrary()` (every word must match). Tests in `src/lib/repoLibrary.test.ts` (10).
- New `src/components/ui/LibraryPanel.tsx`, mounted in `CodeScape.tsx`; `Panel` gained `"library"`. Landing: featured chips with avatars and a "Browse all 50" button. Removed `SAMPLE_REPOS` from `loader.ts`. `RepoAvatar` images are now `loading="lazy"`.
- Verified with headless Playwright against `next start` on :4620 (the in-app pane went hidden mid-check), at 1440×900 and 390×844: opens, focus, search, ↓/↑, category filter, empty state, focus trap, Esc, and a click navigates to `/owner/repo`. Fixed along the way: a phone slide inheriting a half-finished desktop fade (opacity stuck at 0.4), the scrim's backdrop blur breaking the panel's glass, `.row-btn` overriding `items-start`, focus lost after the breakpoint remount, search state surviving a reopen, a `<button>` nested in a `<label>`. Real loads from library clicks: karpathy/nanoGPT (26 files, 1 journey, 14 s) and moby/moby (3,373 files, 300 of 2,279 traced, 4 journeys, 31 s).
- `pnpm exec eslint --ignore-pattern '.claude/**' .`, `pnpm typecheck`, `pnpm test` (147) and `pnpm build` pass on Node 22. One earlier `pnpm test` run had a single failure that did not reproduce on the next two runs.
- Added an e2e spec, "the repository library opens, searches and closes" (`e2e/landing.spec.ts`); `pnpm exec playwright test e2e/landing.spec.ts -g "landing page|repository library"` passes (2/2).
