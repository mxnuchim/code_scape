/**
 * Starts (or finds) the local CodeScape viewer for a repository: the built
 * Next.js app, served on 127.0.0.1 with CODESCAPE_ROOT pointing at the repo.
 *
 * The viewer is a child of the current process, so it stops when
 * `codescape view` stops. Its output goes to stderr.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_VIEWER_PORT = 4317;
const PORT_ATTEMPTS = 10;
const START_TIMEOUT_MS = 30_000;

export interface ViewerStatus {
  url: string;
  port: number;
  started: boolean;
}

export interface DeepLink {
  path?: string;
  symbol?: string;
  journey?: string;
}

export interface ViewerLauncher {
  /** Make sure a viewer for this root is running; resolves to its base URL. */
  ensure(): Promise<ViewerStatus>;
  link(base: string, target: DeepLink): string;
  stop(): void;
}

/** The CodeScape app folder (where package.json and .next live). */
export function findAppDir(): string | null {
  const candidates: string[] = [];
  if (process.env.CODESCAPE_APP_DIR) candidates.push(resolve(process.env.CODESCAPE_APP_DIR));
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) {
      candidates.push(dir);
      dir = dirname(dir);
    }
  } catch {
    // import.meta.url unavailable
  }
  candidates.push(process.cwd());
  for (const dir of candidates) {
    const pkg = join(dir, "package.json");
    if (!existsSync(pkg)) continue;
    try {
      if ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name === "codescape") return dir;
    } catch {
      // keep looking
    }
  }
  return null;
}

interface WorkspaceStatus {
  app: string;
  root: string | null;
}

async function probe(port: number): Promise<WorkspaceStatus | "free" | "other"> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspace/status`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return "other";
    const body = (await res.json()) as Partial<WorkspaceStatus>;
    return body.app === "codescape" ? { app: "codescape", root: body.root ?? null } : "other";
  } catch (err) {
    // Connection refused → nothing is listening.
    const code = (err as { cause?: { code?: string } }).cause?.code;
    return code === "ECONNREFUSED" ? "free" : "other";
  }
}

export function buildDeepLink(base: string, target: DeepLink): string {
  const url = new URL("/local", base);
  if (target.path) url.searchParams.set("select", target.path);
  if (target.symbol) url.searchParams.set("symbol", target.symbol);
  if (target.journey) url.searchParams.set("journey", target.journey);
  return url.toString();
}

export function createViewerLauncher(root: string, options: { port?: number; quiet?: boolean } = {}): ViewerLauncher {
  let child: ChildProcess | null = null;
  let current: Promise<ViewerStatus> | null = null;
  const firstPort = options.port ?? (Number(process.env.CODESCAPE_PORT) || DEFAULT_VIEWER_PORT);

  const start = async (): Promise<ViewerStatus> => {
    // Reuse a viewer that already serves this root (e.g. from an earlier session).
    let freePort: number | null = null;
    for (let port = firstPort; port < firstPort + PORT_ATTEMPTS; port++) {
      const status = await probe(port);
      if (typeof status === "object" && status.root === root) return { url: `http://127.0.0.1:${port}`, port, started: false };
      if (status === "free" && freePort === null) freePort = port;
    }
    if (freePort === null) throw new Error(`No free port between ${firstPort} and ${firstPort + PORT_ATTEMPTS - 1}. Set CODESCAPE_PORT to choose another.`);

    const appDir = findAppDir();
    if (!appDir) throw new Error("Could not find the CodeScape app folder. Set CODESCAPE_APP_DIR to the folder containing CodeScape's package.json.");
    if (!existsSync(join(appDir, ".next", "BUILD_ID"))) {
      throw new Error(`The CodeScape web app hasn't been built yet. Run \`pnpm build\` in ${appDir}, then try again.`);
    }
    const nextBin = join(appDir, "node_modules", "next", "dist", "bin", "next");
    if (!existsSync(nextBin)) throw new Error(`Next.js is not installed in ${appDir}. Run \`pnpm install\` there.`);

    const port = freePort;
    child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: appDir,
      env: { ...process.env, CODESCAPE_ROOT: root, NODE_ENV: "production", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const forward = (chunk: Buffer) => {
      if (!options.quiet) process.stderr.write(`[codescape viewer] ${chunk}`);
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);
    child.on("exit", () => {
      child = null;
      current = null;
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!child) throw new Error("The CodeScape viewer exited while starting. See the server log (stderr) for details.");
      const status = await probe(port);
      if (typeof status === "object" && status.root === root) return { url: `http://127.0.0.1:${port}`, port, started: true };
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`The CodeScape viewer did not start within ${START_TIMEOUT_MS / 1000}s.`);
  };

  const stop = () => {
    child?.kill("SIGTERM");
    child = null;
    current = null;
  };
  process.once("exit", stop);

  return {
    async ensure() {
      if (current) {
        // Check the viewer we know about is still alive and still serving this root.
        const known = await current.catch(() => null);
        if (known) {
          const status = await probe(known.port);
          if (typeof status === "object" && status.root === root) return { ...known, started: false };
        }
        current = null;
      }
      current = start().catch((err) => {
        current = null;
        throw err;
      });
      return current;
    },
    link: buildDeepLink,
    stop,
  };
}
