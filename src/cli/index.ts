/**
 * `codescape` command line.
 *
 *   codescape mcp     [--root DIR]                     stdio MCP server (for Claude Code)
 *   codescape view    [--root DIR] [--port N] [--open] local web viewer for a repository
 *   codescape analyze [--root DIR] [--json]            print the analysis summary
 *
 * The repository root defaults to $CODESCAPE_ROOT, then $CLAUDE_PROJECT_DIR
 * (set by Claude Code for MCP servers), then the current directory.
 */
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createCodescapeServer, SERVER_VERSION } from "../mcp/server";
import { LocalWorkspace } from "../lib/local/workspace";
import { createViewerLauncher, buildDeepLink } from "./viewer";

interface Args {
  command: string;
  root: string;
  port?: number;
  open: boolean;
  json: boolean;
}

const HELP = `CodeScape ${SERVER_VERSION} — understand any codebase, find your way around.

Usage:
  codescape mcp     [--root DIR]                      Run the MCP server over stdio (for Claude Code)
  codescape view    [--root DIR] [--port N] [--open]  Open the 3D viewer for a local repository
  codescape analyze [--root DIR] [--json]             Print what CodeScape found

The repository defaults to $CODESCAPE_ROOT, then $CLAUDE_PROJECT_DIR, then the current folder.

Add to Claude Code (run inside the repository you want to explore):
  claude mcp add codescape -- node ${process.argv[1] ?? "/path/to/codescape/dist/cli.mjs"} mcp
`;

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): Args {
  const args: Args = { command: argv[0] ?? "help", root: "", open: false, json: false };
  let root: string | undefined;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = argv[++i];
    else if (a.startsWith("--root=")) root = a.slice(7);
    else if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--open") args.open = true;
    else if (a === "--json") args.json = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  args.root = resolve(root ?? env.CODESCAPE_ROOT ?? env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (args.port !== undefined && !(args.port > 0 && args.port < 65536)) throw new Error("--port must be a port number");
  return args;
}

async function runMcp(args: Args) {
  // Stdout carries the protocol: every diagnostic goes to stderr.
  console.log = (...parts: unknown[]) => console.error(...parts);
  const { server, context } = await createCodescapeServer({ root: args.root });
  await server.connect(new StdioServerTransport());
  console.error(`[codescape] MCP server ready for ${context.workspace.root}`);
  // Warm the analysis so the first tool call is fast; errors surface on that call.
  context.workspace.get().catch(() => {});
  const shutdown = () => {
    context.viewer.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
}

async function runView(args: Args) {
  const ws = await LocalWorkspace.open(args.root);
  const viewer = createViewerLauncher(ws.root, { port: args.port });
  console.error(`Starting CodeScape for ${ws.root}…`);
  const status = await viewer.ensure();
  const url = buildDeepLink(status.url, {});
  console.log(`CodeScape is ${status.started ? "running" : "already running"} at ${url}`);
  if (args.open) {
    const { spawn } = await import("node:child_process");
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    spawn(cmd, process.platform === "win32" ? ["/c", "start", "", url] : [url], { stdio: "ignore", detached: true }).unref();
  }
  if (status.started) {
    console.error("Press Ctrl+C to stop.");
    const stop = () => {
      viewer.stop();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    await new Promise(() => {});
  }
}

async function runAnalyze(args: Args) {
  const ws = await LocalWorkspace.open(args.root);
  const started = Date.now();
  const { analysis } = await ws.get();
  if (args.json) {
    const { snapshot: _snapshot, index, ...rest } = analysis;
    void _snapshot;
    process.stdout.write(`${JSON.stringify({ ...rest, limits: index.limits, edges: { imports: index.importEdges.length, calls: index.callEdges.length } }, null, 2)}\n`);
    return;
  }
  const o = analysis.overview;
  const l = analysis.index.limits;
  const out = [
    `${o.name}: ${o.projectType.label} (${o.projectType.basis})`,
    o.description ? `  ${o.description.text}` : "",
    `Files: ${analysis.snapshot.entries.length} listed, ${l.parsed}/${l.eligible} source files parsed in ${Date.now() - started} ms`,
    `Edges: ${analysis.index.importEdges.length} imports, ${analysis.index.callEdges.length} resolved calls`,
    `Modules: ${o.modules.map((m) => m.path || "(root)").join(", ")}`,
    `Entry points: ${o.entryPoints.slice(0, 6).map((e) => e.path).join(", ") || "none detected"}`,
    `Journeys: ${analysis.journeys.slice(0, 6).map((j) => j.title).join(" | ") || "none detected"}`,
    "",
    "Reading order:",
    ...analysis.onboarding.readingOrder.map((r) => `  ${r.order}. ${r.path}${r.line ? `:${r.line}` : ""} — ${r.reason}`),
  ];
  console.log(out.filter(Boolean).join("\n"));
}

export async function main(argv = process.argv.slice(2)) {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    console.error(HELP);
    process.exit(2);
  }
  switch (args.command) {
    case "mcp":
      return runMcp(args);
    case "view":
      return runView(args);
    case "analyze":
      return runAnalyze(args);
    case "--version":
    case "version":
      console.log(SERVER_VERSION);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command: ${args.command}\n`);
      console.error(HELP);
      process.exit(2);
  }
}
