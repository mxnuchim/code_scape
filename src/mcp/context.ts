/**
 * What every tool needs: the workspace being analysed, the viewer launcher,
 * and helpers to shape bounded, predictable results.
 */
import * as z from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { LocalWorkspace, AnalysisState } from "../lib/local/workspace";
import { PathAccessError } from "../lib/local/safety";
import type { ViewerLauncher } from "../cli/viewer";

export interface ToolContext {
  workspace: LocalWorkspace;
  viewer: ViewerLauncher;
}

/** Hard ceiling for any single tool result, well under Claude Code's warning threshold. */
export const MAX_RESULT_CHARS = 24_000;

export const BasisSchema = z.enum(["fact", "static-analysis", "heuristic"]).describe(
  "fact: read from files/manifests; static-analysis: parsed and resolved from source; heuristic: inferred from names or structure, may be wrong",
);

export const WorkspaceInfoSchema = z.object({
  root: z.string().describe("Absolute path of the analysed repository"),
  name: z.string(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  analyzedAt: z.string().describe("ISO timestamp of the analysis these results come from"),
  fingerprint: z.string().nullable().describe("Changes whenever files are added, removed or modified"),
  refreshed: z.boolean().describe("True when files changed since the previous call and the analysis was rebuilt"),
});

export function workspaceInfo(ctx: ToolContext, state: AnalysisState): z.infer<typeof WorkspaceInfoSchema> {
  const origin = state.analysis.snapshot.origin;
  const revision = origin?.kind === "local" ? origin.revision : null;
  return {
    root: ctx.workspace.root,
    name: ctx.workspace.name,
    branch: revision?.branch ?? null,
    commit: revision?.commit ?? null,
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
