import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { search as searchPaths } from "../../lib/search";
import { searchSymbols, splitIdentifier } from "../../lib/analysis/code/queries";
import { WorkspaceInfoSchema, guarded, header, loc, result, workspaceInfo, type ToolContext } from "../context";

export const FindCodeInput = z.object({
  query: z.string().min(1).max(200).describe("What to look for: a symbol name, a file or folder name, or words that appear in the code (e.g. 'createUser', 'routes/users', 'password reset')"),
  kind: z.enum(["any", "symbol", "file", "content"]).default("any").describe("Restrict results to declarations, paths or text matches"),
  limit: z.number().int().min(1).max(30).default(12),
});

export const FindCodeOutput = z.object({
  workspace: WorkspaceInfoSchema,
  results: z.array(
    z.object({
      type: z.enum(["symbol", "file", "directory", "content"]),
      path: z.string(),
      line: z.number().nullable(),
      endLine: z.number().nullable(),
      name: z.string().nullable(),
      symbolKind: z.string().nullable(),
      symbolId: z.string().nullable(),
      snippet: z.string().nullable(),
    }),
  ),
  truncated: z.boolean(),
  note: z.string(),
});

export function registerFindCode(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "find_code",
    {
      title: "Find code",
      description:
        "Search the repository for declarations (functions, classes, methods, route handlers), files/folders by path, and lines of source text. Returns bounded results with repository-relative paths and line numbers, never whole files. Use the returned symbolId or path with explain_module, get_dependencies or trace_code_path.",
      inputSchema: FindCodeInput,
      outputSchema: FindCodeOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ query, kind, limit }) => {
      const state = await ctx.workspace.get();
      const { analysis, model } = state;
      const info = workspaceInfo(ctx, state);
      type Row = z.infer<typeof FindCodeOutput>["results"][number];
      const rows: Row[] = [];
      const seen = new Set<string>();
      const add = (row: Row) => {
        const key = `${row.type}:${row.path}:${row.line ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push(row);
      };

      if (kind === "any" || kind === "symbol") {
        for (const { symbol: s } of searchSymbols(analysis.index, query, limit)) {
          add({ type: "symbol", path: s.path, line: s.range.startLine, endLine: s.range.endLine, name: s.qualifiedName, symbolKind: s.kind, symbolId: s.id, snippet: s.doc ?? null });
        }
      }
      if (kind === "any" || kind === "file") {
        const items = [
          ...model.files.map((f) => ({ kind: "file" as const, path: f.path, name: f.name })),
          ...[...model.dirsByPath.values()].filter((d) => d.path).map((d) => ({ kind: "dir" as const, path: d.path, name: d.name })),
        ];
        for (const hit of searchPaths(items, query, limit).filter((h) => h.score >= 300)) {
          add({ type: hit.kind === "dir" ? "directory" : "file", path: hit.path, line: null, endLine: null, name: hit.name, symbolKind: null, symbolId: null, snippet: null });
        }
      }
      if (kind === "any" || kind === "content") {
        const terms = query.includes(" ") ? query.split(/\s+/) : [query, ...splitIdentifier(query).filter((p) => p.length > 2)];
        for (const hit of ctx.workspace.searchContent(terms, limit)) {
          add({ type: "content", path: hit.path, line: hit.line, endLine: hit.line, name: null, symbolKind: null, symbolId: null, snippet: hit.text });
        }
      }

      const truncated = rows.length > limit;
      const results = rows.slice(0, limit);
      const parsed = analysis.index.limits.parsed;
      const note =
        `Symbols and text come from the ${parsed} parsed source files; ` +
        `paths cover all ${model.stats.files} files. Text search skips files withheld as possible secrets, and snippets are redacted.`;
      const lines = [header(info), "", `${results.length} result${results.length === 1 ? "" : "s"} for "${query}":`];
      for (const r of results) {
        if (r.type === "symbol") lines.push(`- [symbol] ${r.name} (${r.symbolKind}) — ${loc(r.path, r.line ?? undefined, r.endLine ?? undefined)}${r.snippet ? ` — ${r.snippet}` : ""}  id: ${r.symbolId}`);
        else if (r.type === "content") lines.push(`- [text] ${loc(r.path, r.line ?? undefined)}: ${r.snippet}`);
        else lines.push(`- [${r.type}] ${r.path}`);
      }
      if (!results.length) lines.push("No matches. Try a shorter name, a file name, or kind: \"content\" with distinctive words.");
      lines.push("", note);
      return result({ workspace: info, results, truncated, note }, lines.join("\n"));
    }),
  );
}
