# Learnings

Problems we hit and how they were solved, so nobody solves them twice. Append newest last.
Format: `## YYYY-MM-DD HH:MM TZ — problem` then **Symptom**, **Cause**, **Fix / rule**.

## 2026-10-15 14:06 WAT — Tests fail on Node 21
- **Symptom:** `pnpm test` exits with `ERR_INVALID_ARG_VALUE` before running any test.
- **Cause:** vitest 5 needs Node ≥ 22 behaviour; the shell default was Node 21.7.3.
- **Fix / rule:** use Node 22 (`nvm use` reads `.nvmrc`). In agent shells: `export PATH=~/.nvm/versions/node/v22.15.0/bin:$PATH`.

## 2026-10-15 14:06 WAT — Tooling facts verified before building the MCP server
- The TypeScript MCP SDK's stable line is v2: `@modelcontextprotocol/server` (+ `/stdio`), needs `zod` ≥ 4.2 (import `zod/v4`), Node ≥ 20. `server.tool()` is gone; use `registerTool/registerResource/registerPrompt`.
- `typescript@latest` is 7.x (Go port) with no classic compiler API. Don't depend on it for parsing.
- Claude Code passes `CLAUDE_PROJECT_DIR` to stdio MCP servers; don't trust `process.cwd()`.
- Claude Code MCP output: warning above ~10k tokens, default max 25k tokens. Keep tool results small.
- Never execute `git` against an analyzed repo: repo-local config (`core.fsmonitor`, hooks) can run arbitrary commands. Read `.git/HEAD` and refs as files instead.

## 2026-10-15 14:29 WAT — tree-sitter in Node: what works
- **Symptom / question:** we needed a parser that runs in Node and the browser without a native build.
- **Answer:**
  - `web-tree-sitter@0.27.1` loads the grammar `.wasm` files shipped inside `tree-sitter-{typescript,javascript,python,go}`. TypeScript's grammar is ABI 14, the others ABI 15, and all of them work.
  - pnpm 10 blocks the grammar packages' native build scripts. That's fine: we only use the `.wasm` files.
  - Pass the bytes to `Parser.init({ wasmBinary })` and `Language.load(bytes)`, so that bundlers can't break `locateFile`.
- **Rule:** look up WASM files via `src/lib/local/wasm.ts` (in Node) and never through hard-coded paths.

## 2026-10-15 14:29 WAT — Analysis pitfalls found on real repos
- **Fixtures and examples skewed the overview.** Folders like `test/fixtures/*` with their own `package.json` made this repo look like a 4-package monorepo, and their routes became the main journeys. **Fix:** `NON_PRODUCT_DIR` in `overview.ts` keeps tests, fixtures, examples, samples, demos and templates out of package detection, entry points, journey starts and route-based module roles.
- **Depth-first journeys drown in helpers.** **Fix:** only show same-file calls that eventually lead to another file, and mark a node visited when it is pushed, not when it is expanded (the latter allowed duplicates at the depth limit).
- **Related tests matched across languages** (`store.go` for `store.ts`). **Fix:** stem matches also require the same language family.
- **Redaction double-counted** a token matched by both its own pattern and the `key = "…"` rule. **Fix:** skip values that are already `[REDACTED]`.
- **macOS temp dirs are symlinks** (`/var` → `/private/var`). Anything that checks containment must `realpath` the root first. LocalWorkspace does; tests must too.
- **eslint-config-next forbids a variable named `module`** (`@next/next/no-assign-module-variable`), even in non-Next code. Use `modulePath`, `pkg` and so on.
- **JSX component usage (`<Foo />`) isn't a call expression.** Without recording it, React apps produce no journeys. It is now recorded as a reference.

## 2026-10-15 14:52 WAT — MCP, Next and tooling gotchas
- **Next 16 allows one `next dev` per project directory.** A second one exits with "Another next dev server is already running". Stop the first (preview_stop) before starting another config.
- **`web-tree-sitter` doesn't export its `package.json`.** `require.resolve("web-tree-sitter/package.json")` throws ERR_PACKAGE_PATH_NOT_EXPORTED. The grammar packages are direct dependencies, so copy from `node_modules/<pkg>/…` (see `scripts/wasm-files.mjs`).
- **Never write to stdout in MCP mode.** `runMcp` reroutes `console.log` to stderr, and the viewer child's stdout is piped to our stderr. The raw-stdio test asserts every stdout line is JSON.
- **`claude -p` needs a logged-in CLI.** In this environment it fails with "OAuth session expired". The MCP handshake still succeeds and the init event lists the tools, so use the stream-json `init` message to verify registration even without auth.
- **The browser pane can be hidden.** Then `requestAnimationFrame` never fires (measure it with a 1 s rAF counter) and the R3F city never assembles. Don't misread that as an app bug; use headless Playwright for UI verification.
- **The browser tool's `type` doesn't fire keydown for "/".** Dispatch a `KeyboardEvent` to test single-key shortcuts.
- **macOS has no `timeout` command.** Use background processes and `pkill`, or a Node script with its own timeout.

## 2026-10-15 15:29 WAT — Headless UI testing and manifest parsing
- **Headless WebGL works with SwiftShader.** Use `--use-angle=swiftshader --enable-unsafe-swiftshader`. It renders only a few frames per second, so frame-driven exit animations ("Building the city" fading out) take tens of seconds. Wait on store state instead: `window.__codescape` is exposed only when `navigator.webdriver` is set. Run e2e with `reducedMotion: "reduce"`.
- **Don't render two heavy 3D pages at once in one test.** CPU contention makes the second one time out. Close the first page before opening a deep link.
- **`getByRole("alert")` also matches Next's hidden `__next-route-announcer__`.** Scope the locator, e.g. `section[role=alert]`.
- **A project's own name in `pyproject.toml` matched its dependency list.** `name = "flask"` made Flask "depend on Flask". Blank the name line before matching, and compute line numbers on that same blanked text.

## 2026-10-15 17:56 WAT — Rust and Java parsing pitfalls
- **`com/example/demo` is a package, not an example folder.** `NON_PRODUCT_DIR` hid every Spring Initializr app's routes and `main`. **Rule:** use `isNonProductPath()`, which only checks the part of a path up to a JVM source root (`src/main/java/`).
- **web-tree-sitter returns new `Node` wrappers on every access**, so `a === b` is false for the same node. Compare `node.id`.
- **Rust: `lastIndexOf("::")` is -1 without a separator**; `slice(-1 + 2)` silently drops the first character (`Service` → `ervice`).
- **axum builder chains are visited outermost-first** and the call node starts at `Router::new()`; take the line of the path literal and sort routes by line.
- **Routes inside `#[cfg(test)] mod tests` and `#[tokio::test]` fns** made the axum repo's journeys all "GET /". Skip them.
- **A workspace's crates depend on each other** (axum-extra → axum): ignore dependencies that are local crates, or a library looks like a service built on itself.
- **Spring Boot 4 renamed `spring-boot-starter-web` to `-webmvc`.** Match both, and treat Spring Boot plus route mappings as a web app.
- **`pnpm lint` also scans `.claude/worktrees/*`** (other sessions' checkouts, git-ignored), which fail lint on their own. Lint this tree with `pnpm exec eslint --ignore-pattern '.claude/**' .`.
- **A Playwright spec that imports from another spec runs that spec's tests too.** Inline helpers in one-off specs.
- **The user's own `next dev` blocks a second one.** For a fixture preview, use the production viewer (`node dist/cli.mjs view --root … --port 3200`, launch config `codescape-view-java-fixture`) after `pnpm build`.
