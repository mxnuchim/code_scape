/**
 * What every tool needs: the workspace being analysed, the viewer launcher,
 * and helpers to shape bounded, predictable results.
 *
 * The same tools serve two workspaces: a checkout on this machine
 * (`LocalWorkspace`, stdio server) and a public GitHub repository read over
 * HTTPS (`GitHubWorkspace`, the hosted /api/mcp endpoint).
 */
import * as z from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { RepoModel } from "../lib/analysis/types";
import type { WorkspaceAnalysis } from "../lib/analysis/workspace";
import { PathAccessError } from "../lib/local/safety";
import type { ViewerLauncher } from "../cli/viewer";

export interface WorkspaceState {
  analysis: WorkspaceAnalysis;
  model: RepoModel;
  /** True when this call re-analysed because files changed since the previous analysis. */
  refreshed: boolean;
}

export interface Excerpt {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  text: string;
  redactions: number;
}

/** A repository the tools can read: analysis, redacted excerpts and content search. */
export interface CodeWorkspace {
  /** Absolute path on this machine, or `github.com/owner/repo`. */
  readonly root: string;
  readonly name: string;
  get(): Promise<WorkspaceState>;
  excerpt(path: string, startLine?: number, endLine?: number, maxLines?: number): Promise<Excerpt>;
  searchContent(terms: string[], limit?: number): { path: string; line: number; text: string; matched: number }[];
}

export interface ToolContext {
  workspace: CodeWorkspace;
  viewer: ViewerLauncher;
  /** "local": a checkout on this machine. "github": a public repository read from GitHub by the hosted server. */
  mode: "local" | "github";
}

/** Hard ceiling for any single tool result, well under Claude Code's warning threshold. */
export const MAX_RESULT_CHARS = 24_000;

export const BasisSchema = z.enum(["fact", "static-analysis", "heuristic"]).describe(
  "fact: read from files/manifests; static-analysis: parsed and resolved from source; heuristic: inferred from names or structure, may be wrong",
);

export const WorkspaceInfoSchema = z.object({
  root: z.string().describe("Absolute path of the analysed repository, or github.com/owner/repo for the hosted server"),
  name: z.string(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  analyzedAt: z.string().describe("ISO timestamp of the analysis these results come from"),
  fingerprint: z.string().nullable().describe("Changes whenever files are added, removed or modified"),
  refreshed: z.boolean().describe("True when files changed since the previous call and the analysis was rebuilt"),
});

export function workspaceInfo(ctx: ToolContext, state: WorkspaceState): z.infer<typeof WorkspaceInfoSchema> {
  const { snapshot } = state.analysis;
  const origin = snapshot.origin;
  const revision = origin?.kind === "local" ? origin.revision : null;
  const githubRef = origin?.kind === "local" ? null : snapshot.ref;
  return {
    root: ctx.workspace.root,
    name: ctx.workspace.name,
    branch: revision?.branch ?? (githubRef && !/^[0-9a-f]{40}$/.test(githubRef) ? githubRef : null),
    commit: revision?.commit ?? (githubRef && /^[0-9a-f]{40}$/.test(githubRef) ? githubRef : null),
    analyzedAt: new Date(state.analysis.analyzedAt).toISOString(),
    fingerprint: state.analysis.fingerprint,
    refreshed: state.refreshed,
  };
}

/** `path:12` or `path:12-18`. */
export function loc(path: string, start?: number, end?: number): string {
  if (!start) return path;
  return end && end !== start ? `${path}:${start}-${end}` : `${path}:${start}`;
}

/**
 * Build a tool result: structured content plus a readable text rendering. If
 * the rendering is too long it is cut, and the cut is stated.
 */
export function result<T extends Record<string, unknown>>(structured: T, text: string): CallToolResult {
  let body = text;
  if (body.length > MAX_RESULT_CHARS) body = `${body.slice(0, MAX_RESULT_CHARS - 200)}\n\n[…output truncated at ${MAX_RESULT_CHARS} characters; narrow the request for more detail]`;
  return { content: [{ type: "text", text: body }], structuredContent: structured };
}

/** A tool-level error the model can act on (not a protocol error). */
export function failure(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Wrap a handler so expected failures become readable tool errors. */
export function guarded<A>(handler: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (err) {
      if (err instanceof PathAccessError) return failure(`${err.message} (${err.code})`);
      const message = err instanceof Error ? err.message : String(err);
      console.error("[codescape] tool failed:", err);
      return failure(`CodeScape could not complete this request: ${message}`);
    }
  };
}

export function header(info: z.infer<typeof WorkspaceInfoSchema>): string {
  const rev = info.branch ? `${info.branch}${info.commit ? ` @ ${info.commit.slice(0, 10)}` : ""}` : info.commit ? info.commit.slice(0, 10) : "no git metadata";
  return `Repository: ${info.name} (${rev}) — analysed ${info.analyzedAt}${info.refreshed ? " (re-analysed: files changed)" : ""}`;
}
