# CodeScape in Claude Code (MCP)

CodeScape ships a local [MCP](https://modelcontextprotocol.io) server. Claude Code uses it to understand the repository you have open: what the project is, where things live, how a request flows, and what depends on what. Every answer comes with `path:line` evidence. Claude can also give you a link that opens the same location in CodeScape's 3D map.

- **Everything stays local.** The server reads the checked-out repository from disk, including uncommitted changes and private code. Nothing is uploaded, and the server makes no network requests.
- **It is read-only.** No repository code is ever run, and `git` isn't run either: branch and commit are read from `.git` files.

## Requirements

- Node.js 20.9 or later (22 recommended; see `.nvmrc`)
- pnpm 10
- Claude Code

## 1. Build CodeScape once

```bash
git clone <this repository> codescape
cd codescape
pnpm install
pnpm build        # the web viewer that open_in_codescape starts
pnpm build:cli    # dist/cli.mjs: the MCP server and the `codescape` command
```

Check that it can analyse a repository:

```bash
node dist/cli.mjs analyze --root /path/to/any/repo
```

## 2. Add the server to Claude Code

Run this **inside the repository you want to explore**, using the absolute path to your CodeScape checkout:

```bash
claude mcp add codescape -- node /absolute/path/to/codescape/dist/cli.mjs mcp
```

This uses Claude Code's default `local` scope, so the server is configured for that one project and only on your machine.

- **To make it available in every project**, add `--scope user`.
- **To share it with a team** through the repository, use `--scope project`. That writes `.mcp.json`:

```json
{
  "mcpServers": {
    "codescape": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/codescape/dist/cli.mjs", "mcp"]
    }
  }
}
```

Claude Code asks you to approve project-scoped servers the first time it sees them.

Restart Claude Code (or run `/mcp`) and check that `codescape` shows as connected.

## Which folder is analysed?

The MCP server analyses one folder, chosen in this order:

1. `--root <folder>` in the server's arguments
2. the `CODESCAPE_ROOT` environment variable
3. `CLAUDE_PROJECT_DIR`, which Claude Code sets to the project you opened
4. the server's working directory

With a plain `claude mcp add` as above, the analysed folder is the project Claude Code has open. To point at a different repository, pin it explicitly:

```bash
claude mcp add codescape-api -- node /absolute/path/to/codescape/dist/cli.mjs mcp --root /path/to/api-repo
```

Every tool result starts with the repository name, branch and commit, plus when it was analysed. That way you can always see what Claude is looking at.

## 3. Use it

Ask questions naturally; Claude chooses the tools. For example:

- *"I just joined this project. Give me an overview and tell me where to start reading."*
- *"How does a POST /orders request get to the database?"*
- *"What would break if I changed `src/lib/auth.ts`?"*
- *"Show me that journey in CodeScape."*

Two prompts are also available as slash commands:

- `/mcp__codescape__onboard [focus]`: a guided orientation. It covers the overview, a reading order, one code journey, and how to run and test the project.
- `/mcp__codescape__investigate <question>`: locates the code, traces it and checks its dependencies, then answers with citations.

You can attach the overview as context with `@codescape:codescape://overview`.

### Tools

| Tool | What it does |
|---|---|
| `get_codebase_overview` | Gives the project type, technologies (from manifests), modules and their likely roles, entry points, HTTP routes, run and test commands, test locations, module boundaries, detected journeys and the analysis limits. |
| `find_code` | Searches declarations, file and folder paths, and source text. Results are bounded, with `path:line` and redacted snippets. |
| `explain_module` | Gathers the evidence for a file, folder or declaration: what it declares, what it imports and what imports it, packages, routes, related tests, a short excerpt, and a role hypothesis labelled with its basis. |
| `get_dependencies` | Lists upstream and downstream relationships (imports and resolved calls), each with the line where it is written. `depth` 2–3 gives transitive impact. |
| `trace_code_path` | Follows an operation through resolved calls, in order, down to where it leaves the repository (for example, into a database package). Places it can't follow are listed as gaps. |
| `get_onboarding_guide` | Builds a reading order with a reason for every item, plus key components, how modules connect, a representative journey, run and test commands, and questions to explore next. It can focus on one folder. |
| `open_in_codescape` | Starts the local viewer if needed and returns a deep link to a file, declaration or journey in the 3D map. |

### How to read the answers

Every claim carries a **basis**:

- **fact**: read directly from the file tree or a manifest, such as `package.json` or `pyproject.toml`.
- **static-analysis**: established by parsing source and resolving imports and calls. This covers JavaScript, TypeScript, Python, Go, Rust and Java.
- **heuristic**: inferred from names or structure, such as "this folder is probably the data layer". Treat it as a hint.

Nothing is inferred from runtime behaviour, because CodeScape never runs your code. Calls made through dependency injection, dynamic dispatch, reflection or string-based routing can't be followed statically. `trace_code_path` reports those as gaps instead of guessing.

## The 3D viewer

`open_in_codescape` starts the production web app on `127.0.0.1`, on port 4317 or the next free port. The viewer:

- serves only the repository the MCP server analyses;
- is reused across calls;
- stops when Claude Code stops the MCP server.

The link it returns opens the city with the file selected, the declaration highlighted, or the journey playing.

You can also run the viewer yourself, without Claude Code:

```bash
node /absolute/path/to/codescape/dist/cli.mjs view --root /path/to/repo --open
```

## Limits

- **Parsing caps.** Up to 4,000 source files and 40 MB are parsed, entry points and source first. Files over 512 KB are skipped. The tree walk stops at 100,000 entries. Anything left out is reported in each overview's limitations.
- **Withheld files.** Files that look like secrets (`.env*`, keys, certificates, credentials, anything named `*secret*`) are listed but never read. Text that does get returned passes through secret redaction.
- **Unsupported languages.** Kotlin, C#, Ruby, PHP and other languages appear in the map without symbols or dependencies for now.
- **Staleness.** Every tool call checks file sizes and modification times. If anything changed, the analysis is rebuilt and only the changed files are re-parsed. When that happens, the result says `re-analysed: files changed`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `codescape` isn't listed in `/mcp` | Check the absolute path to `dist/cli.mjs`, and that you ran `pnpm build:cli`. Run the same command by hand: `node …/dist/cli.mjs mcp` should print `[codescape] MCP server ready for …` to stderr and then wait for input. |
| The wrong repository is analysed | Check the first line of any tool result. Pin the folder with `--root` (see [Which folder is analysed?](#which-folder-is-analysed)). |
| `open_in_codescape` says the web app hasn't been built | Run `pnpm build` in the CodeScape folder. |
| `open_in_codescape` reports no free port | Something else is using ports 4317–4326. Set `CODESCAPE_PORT` in the server's environment, e.g. `claude mcp add codescape -e CODESCAPE_PORT=5100 -- node …/dist/cli.mjs mcp`. |
| The server can't find the app folder | Set `CODESCAPE_APP_DIR` to the CodeScape checkout. |
| Results look partial | Read the overview's limitations. Large repositories hit the parse caps, and unsupported languages have no edges. |

Server diagnostics go to stderr. Claude Code shows them in its MCP logs, which `claude --debug` makes visible.
