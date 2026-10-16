# Contributing to CodeScape

Thank you for helping people understand code faster. This guide explains how to get set up, how the project is organised and what a good change looks like.

## Setup

```bash
nvm use            # Node 22 (Vitest needs 22; Node 20.9+ runs the app)
pnpm install       # also copies the tree-sitter WASM files to public/wasm
pnpm dev           # http://localhost:3000
```

To work on local mode, point the dev server at a fixture and open `/local`:

```bash
CODESCAPE_ROOT=test/fixtures/ts-express-api pnpm dev
```

Before opening a pull request, run:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e      # needs `pnpm build` and `pnpm exec playwright install chromium`
```

## Where things live

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the full picture. In short:

- **Analysis** belongs in `src/lib/analysis/`. It must stay pure, so that it runs in Node and in the browser. It never uses `fs` and never touches the DOM.
- **Filesystem access** goes through `src/lib/local/safety.ts` (`readRepoText`, `resolveInsideRoot`). Never read repository files any other way.
- **UI** follows [INTERFACE.md](INTERFACE.md). Read it before changing anything visual.

## Principles that reviews will check

1. **Never present a guess as a fact.** Every relationship and role carries a `basis`: `fact`, `static-analysis` or `heuristic`. If static analysis can't establish something, say so; a journey shows that as a gap.
2. **Never execute repository code.** That includes `git`: repository-local config can run commands. Read `.git` files instead.
3. **Keep results bounded.** Parsing has caps. Anything left out must be reported.
4. **One engine.** Don't reimplement analysis in a component. Add a query in `src/lib/analysis/code/queries.ts` and use it there.
5. **Test behaviour against fixtures.** Assert exact lines and edges in `test/fixtures/`. If you edit a fixture, update the tests that assert its line numbers.

## Adding a language

1. Spike first: check the grammar's licence and that its `.wasm` loads with the pinned `web-tree-sitter` in Node (see LEARNINGS.md). Pin the package version exactly.
2. Add the grammar's `.wasm` file to `scripts/wasm-files.mjs` and `src/lib/local/wasm.ts`, and to `GRAMMAR_FILES` and `codeLanguageFor` in `src/lib/analysis/code/parser.ts`.
3. Add `extract-<lang>.ts`, producing `ParsedFile`: symbols with ranges, imports with bindings, calls with the enclosing symbol, and routes or main blocks where it makes sense. Record a receiver's type only when the source declares it.
4. Teach `buildIndex.ts` (and a resolver in `src/lib/analysis/imports/` if the rules are involved) to resolve that language's imports to files, and `SymbolResolver` to resolve its calls. Only real bindings, never name similarity.
5. Read its manifest in `overview.ts` (technologies with line evidence, commands, project type) and remove it from the "No code parser yet" list.
6. Add it to `PARSED_LANGUAGES` in `src/lib/analysis/languages.ts`, which the UI copy uses, and update the README and docs limits.
7. Add a fixture under `test/fixtures/`, plus exact-line and journey tests in `src/lib/analysis/code/code.test.ts`.

## Work logs

For any large change (roughly five or more files), append timestamped entries to:

- [EXECUTION.md](EXECUTION.md): the steps you took and their outcomes;
- [LEARNINGS.md](LEARNINGS.md): problems you hit and how you solved them;
- [INTERFACE.md](INTERFACE.md): UI and design decisions.

A Claude Code hook (`.claude/hooks/work-log.mjs`) reminds agents to do this.

## Pull requests

- Keep each PR to one concern, and describe what you verified and how.
- Include screenshots or a short recording for UI changes.
- By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) and that you'll follow the [Code of Conduct](CODE_OF_CONDUCT.md).
