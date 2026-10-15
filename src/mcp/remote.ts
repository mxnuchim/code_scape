/**
 * The hosted CodeScape MCP server: one endpoint per public GitHub repository,
 * `/api/mcp/<owner>/<repo>` (optionally `?ref=<branch|tag|sha>`), served
 * statelessly over Streamable HTTP. Add it to Claude Code with
 *
 *   claude mcp add --transport http codescape-<repo> https://<site>/api/mcp/<owner>/<repo>
 *
 * The tools are the same as the local stdio server's; only the workspace
 * (GitHub instead of disk) and the viewer (the website instead of a local
 * process) differ.
 */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { DeepLink, ViewerLauncher } from "../cli/viewer";
import type { RepoRef } from "../lib/github/types";
import { repoPath } from "../lib/github/parseRepoUrl";
import { githubWorkspace, OWNER_RE, REPO_RE, type GitHubWorkspaceOptions } from "../lib/remote/githubWorkspace";
import { registerCodescape, remoteServerInstructions, SERVER_NAME, SERVER_VERSION } from "./server";

export interface RemoteMcpOptions extends Pick<GitHubWorkspaceOptions, "fetchImpl" | "token" | "cap" | "timeBudgetMs"> {
  /** Public base URL of the website, for map links. Defaults to the request's origin. */
  siteUrl?: string;
}

const REF_RE = /^[\w./-]{1,200}$/;

/** The repository an `/api/mcp/<owner>/<repo>` URL names, or null when it isn't a valid one. */
export function repoFromMcpUrl(url: URL): RepoRef | null {
  const m = /^\/api\/mcp\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return null;
  const owner = decodeURIComponent(m[1]);
  const repo = decodeURIComponent(m[2]).replace(/\.git$/, "");
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..") return null;
  const ref = url.searchParams.get("ref") ?? undefined;
  if (ref !== undefined && (!REF_RE.test(ref) || ref.includes(".."))) return null;
  return { owner, repo, ...(ref ? { ref } : {}) };
}

/** A link into the website's city for this repository. */
export function githubCityLink(site: string, ref: RepoRef, target: DeepLink): string {
  const url = new URL(repoPath(ref), site);
  if (target.path) url.searchParams.set("select", target.path);
  if (target.symbol) url.searchParams.set("symbol", target.symbol);
  if (target.journey) url.searchParams.set("journey", target.journey);
  return url.toString();
}

export function createRemoteMcpHandler(options: RemoteMcpOptions = {}) {
  const handler = createMcpHandler(({ requestInfo }) => {
    const url = new URL(requestInfo!.url);
    const ref = repoFromMcpUrl(url)!;
    const site = options.siteUrl ?? url.origin;
    const workspace = githubWorkspace(ref, options);
    const viewer: ViewerLauncher = {
      ensure: async () => ({ url: new URL(repoPath(ref), site).toString(), port: 0, started: false }),
      link: (_base, target) => githubCityLink(site, ref, target),
      stop: () => {},
    };
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION, title: `CodeScape: ${ref.owner}/${ref.repo}` },
      { instructions: remoteServerInstructions(`${ref.owner}/${ref.repo}${ref.ref ? ` at ${ref.ref}` : ""}`) },
    );
    registerCodescape(server, { workspace, viewer, mode: "github" });
    return server;
  });

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (!repoFromMcpUrl(url)) {
        return Response.json(
          { error: "Use /api/mcp/<owner>/<repo> for a public GitHub repository, e.g. /api/mcp/pallets/flask (optionally ?ref=<branch>)." },
          { status: 404 },
        );
      }
      return handler.fetch(request);
    },
  };
}
