# Security

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's private vulnerability reporting instead (the "Report a vulnerability" button on the repository's Security tab). Include steps to reproduce and the impact. You'll get an acknowledgement as soon as the maintainer sees it, and a fix or mitigation plan after triage.

## Security model

CodeScape analyses code you point it at, and treats that code as **untrusted input**.

**What runs**

- CodeScape parses files with tree-sitter (WASM). It never executes repository code, installs its dependencies or runs its scripts.
- It never runs `git` either. Repository-local git configuration such as `core.fsmonitor` or hooks can execute commands, so CodeScape reads branch and commit directly from `.git/HEAD`, refs and packed-refs.

**What it reads (local mode and MCP)**

- **Only inside the configured root.** Every path is normalised. Absolute paths, `..`, backslashes and NUL bytes are rejected. Paths are resolved with `realpath` and must stay inside the root, so a symlink pointing outside is never followed.
- **No likely secrets.** Files that look like secrets are listed in the map but never read: `.env*` (except `.example`/`.sample`/`.template`), keys and certificates, `id_*`, `.npmrc`, `.netrc`, `credentials*`, `*secret*` and similar.
- **No binaries or very large files.** Binary files and files over 512 KB are not read.
- **Bounded work.** The walk stops at 100,000 entries, and parsing at 4,000 files or 40 MB, under a time budget.

**What it returns**

- Source excerpts, search snippets and MCP results pass through secret redaction: private keys, common token formats, and `password = "…"`-style assignments.
- MCP tool results are capped at 24,000 characters.

**The hosted MCP endpoint** (`/api/mcp/<owner>/<repo>` on a deployed site)

- It reads **public** GitHub repositories only: the REST API for metadata and the tree, `raw.githubusercontent.com` for contents, with the same limits on likely secrets, size, file count (600) and time as above. It never executes code.
- `owner`, `repo` and `ref` are validated against GitHub's naming rules before any request is made.
- The analysis and the files it read are kept in memory for 15 minutes per server instance, then dropped. Nothing is written to disk or logged beyond platform request logs.
- `GITHUB_TOKEN`, when set, is sent to `api.github.com` only, never to raw file requests or to MCP clients. Use a fine-grained token with read-only access to public repositories.
- Anyone who can reach the site can make it analyse a public repository. Rate-limit `/api/mcp/*` at the platform (see docs/DEPLOY.md).
- `open_in_codescape` only builds a link to the website when hosted; it never starts a process or opens a browser on the server.

**Where it listens**

- The local MCP server speaks JSON-RPC on stdio only.
- The local viewer binds to `127.0.0.1`. Its API rejects requests whose `Host` isn't a loopback name (which blocks DNS rebinding), and rejects cross-site requests (`Sec-Fetch-Site`, `Origin`). It sends no CORS headers.
- The repository root comes from `CODESCAPE_ROOT` when the viewer starts. No request can change it.

**What leaves your machine**

- In local mode and with the local MCP server: nothing. No telemetry, and no network requests.
- With the hosted MCP endpoint, your MCP client sends tool calls (questions about the repository, not your code) to the site, and the site reads the public repository from GitHub.
- In GitHub mode, the browser calls `api.github.com` and `raw.githubusercontent.com` for the repository you entered, and nothing else.

## Known limitations

- Redaction is pattern-based. It catches common formats, not every possible secret. Don't point CodeScape at folders whose secrets are stored in ordinary-looking source files.
- `.gitignore` handling approximates "tracked files" without running git. Untracked, un-ignored files in the working tree are included, which is intentional so that new work shows up.
