/**
 * `codescape` command line.
 *
 *   codescape view    [--root DIR] [--port N] [--open] local web viewer for a repository
 *   codescape analyze [--root DIR] [--json]            print the analysis summary
 *
 * The repository root defaults to $CODESCAPE_ROOT, then the current directory.
 */
import { resolve } from "node:path";
import { LocalWorkspace } from "../lib/local/workspace";
import { createViewerLauncher, buildDeepLink } from "./viewer";

export const VERSION = "0.2.0";

interface Args {
  command: string;
  root: string;
  port?: number;
  open: boolean;
  json: boolean;
}

const HELP = `CodeScape ${VERSION} — understand any codebase, find your way around.

Usage:
  codescape view    [--root DIR] [--port N] [--open]  Open the 3D viewer for a local repository
  codescape analyze [--root DIR] [--json]             Print what CodeScape found

The repository defaults to $CODESCAPE_ROOT, then the current folder.
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
  args.root = resolve(root ?? env.CODESCAPE_ROOT ?? process.cwd());
  if (args.port !== undefined && !(args.port > 0 && args.port < 65536)) throw new Error("--port must be a port number");
  return args;
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
    case "view":
      return runView(args);
    case "analyze":
      return runAnalyze(args);
    case "--version":
    case "version":
      console.log(VERSION);
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
