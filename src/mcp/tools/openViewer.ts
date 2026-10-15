import * as z from "zod/v4";
import { spawn } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/server";
import { failure, guarded, result, type ToolContext } from "../context";
import { TargetError, resolveTarget, targetErrorText } from "../targets";

export const OpenOutput = z.object({
  url: z.string().describe("Deep link to the location in the CodeScape viewer"),
  started: z.boolean().describe("True if the viewer was started by this call"),
  target: z.string().nullable(),
  openedBrowser: z.boolean(),
});

function openInBrowser(url: string): boolean {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function registerOpenViewer(server: McpServer, ctx: ToolContext) {
  const hosted = ctx.mode === "github";
  server.registerTool(
    "open_in_codescape",
    {
      title: "Open in CodeScape",
      description: hosted
        ? "Get a link that shows a file, folder, declaration or code journey in the CodeScape 3D map of this repository on the CodeScape website. Give the link to the user."
        : "Show a file, folder, declaration or code journey in the CodeScape 3D map of this repository. Starts the local viewer (127.0.0.1) if needed and returns a deep link; give the link to the user. Set openBrowser to true only if the user asked to open it.",
      inputSchema: z.object({
        target: z.string().max(400).optional().describe("File or folder path, symbol id (path#Name) or declaration name to select"),
        journey: z.string().max(200).optional().describe("Journey id to play (from get_codebase_overview or trace_code_path)"),
        openBrowser: z.boolean().default(false).describe(hosted ? "Ignored by the hosted server: give the link to the user instead" : "Also open the link in the default browser"),
      }),
      outputSchema: OpenOutput,
      // Locally this starts a process (the viewer); it never changes repository files. Hosted, it only builds a link.
      annotations: { readOnlyHint: hosted, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded(async ({ target: raw, journey, openBrowser }) => {
      const state = await ctx.workspace.get();
      let path: string | undefined;
      let symbol: string | undefined;
      if (raw) {
        try {
          const t = resolveTarget(state, raw);
          path = t.path;
          if (t.kind === "symbol") symbol = t.symbol.id;
        } catch (err) {
          if (err instanceof TargetError) return failure(targetErrorText(err));
          throw err;
        }
      }
      if (journey && !state.analysis.journeys.some((j) => j.id === journey)) {
        return failure(`Unknown journey id "${journey}". Journey ids are listed by get_codebase_overview and trace_code_path.`);
      }
      let status;
      try {
        status = await ctx.viewer.ensure();
      } catch (err) {
        return failure(`The CodeScape viewer could not be started: ${err instanceof Error ? err.message : String(err)}`);
      }
      const url = ctx.viewer.link(status.url, { path, symbol, journey });
      // Never spawn a browser from the hosted server: it would run on the server, not for the user.
      const openedBrowser = openBrowser && !hosted ? openInBrowser(url) : false;
      const what = journey ? `journey ${journey}` : symbol ?? path ?? "the repository overview";
      const text = [
        hosted ? `CodeScape map: ${status.url}` : `CodeScape ${status.started ? "started" : "is running"} at ${status.url} (local only).`,
        `Open ${what}: ${url}`,
        openedBrowser ? "Opened in the default browser." : "Share this link with the user; it opens the 3D map with that location selected.",
      ].join("\n");
      return result({ url, started: status.started, target: symbol ?? path ?? null, openedBrowser }, text);
    }),
  );
}
