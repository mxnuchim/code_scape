/**
 * Server-side access to the local repository for the Next.js API routes.
 *
 * The repository is fixed by the CODESCAPE_ROOT environment variable when the
 * viewer starts (`codescape view`, or open_in_codescape from the MCP server).
 * Requests can never choose a different root.
 */
import { LocalWorkspace } from "./workspace";

const globalKey = Symbol.for("codescape.localWorkspace");
type Holder = { [globalKey]?: Promise<LocalWorkspace> };

export function configuredRoot(): string | null {
  return process.env.CODESCAPE_ROOT?.trim() || null;
}

/** One workspace per server process (kept on globalThis so dev reloads reuse it). */
export function serverWorkspace(): Promise<LocalWorkspace> | null {
  const root = configuredRoot();
  if (!root) return null;
  const holder = globalThis as Holder;
  if (!holder[globalKey]) {
    holder[globalKey] = LocalWorkspace.open(root).catch((err) => {
      delete holder[globalKey];
      throw err;
    });
  }
  return holder[globalKey]!;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Reject anything that isn't a same-origin request to a loopback host. This
 * blocks DNS-rebinding (Host is checked) and cross-site reads (Sec-Fetch-Site
 * and Origin are checked). No CORS headers are ever sent.
 */
export function rejectNonLocal(request: Request): Response | null {
  const host = request.headers.get("host") ?? "";
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (!LOCAL_HOSTS.has(hostname)) return Response.json({ error: "CodeScape's local API only answers on 127.0.0.1 / localhost." }, { status: 403 });
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== host) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
    } catch {
      return Response.json({ error: "Bad Origin header." }, { status: 403 });
    }
  }
  return null;
}

export const NO_ROOT_MESSAGE =
  "No local repository is configured. Start the viewer with `codescape view --root <folder>` (or open_in_codescape from Claude Code).";
