import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { dependenciesOf, type Relation } from "../../lib/analysis/code/queries";
import { BasisSchema, WorkspaceInfoSchema, failure, guarded, header, result, workspaceInfo, type ToolContext } from "../context";
import { TargetError, resolveTarget, targetErrorText } from "../targets";

const RelationSchema = z.object({
  id: z.string().describe("File path, or symbol id for call relationships"),
  path: z.string(),
  name: z.string(),
  kind: z.enum(["import", "call"]),
  basis: BasisSchema,
  evidence: z.string().describe("Where the relationship is written, as path:line[,line…]"),
  typeOnly: z.boolean(),
  depth: z.number().describe("1 = direct; 2-3 = transitive"),
});

export const DependenciesOutput = z.object({
  workspace: WorkspaceInfoSchema,
  target: z.object({ kind: z.enum(["file", "directory", "symbol"]), id: z.string(), path: z.string() }),
  upstream: z.array(RelationSchema).describe("Code that depends on the target (imports it or calls it)"),
  downstream: z.array(RelationSchema).describe("Code the target depends on"),
  externalPackages: z.array(z.string()),
  truncated: z.boolean(),
  coverage: z.string(),
});

const toRow = (r: Relation): z.infer<typeof RelationSchema> => ({
  id: r.id,
  path: r.path,
  name: r.name,
  kind: r.kind,
  basis: r.basis,
  evidence: `${r.evidence.path}:${r.evidence.lines.slice(0, 5).join(",")}`,
  typeOnly: Boolean(r.typeOnly),
  depth: r.depth,
});

export function registerDependencies(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_dependencies",
    {
      title: "Get dependencies",
      description:
        "List what depends on a file, folder or declaration (upstream) and what it depends on (downstream). Only relationships established by parsing and resolving imports and calls are returned, each with the line where it is written; nothing is inferred from names or folder proximity. depth 2-3 follows transitive relationships (useful for change impact).",
      inputSchema: z.object({
        target: z.string().min(1).max(400).describe("File or folder path, symbol id (path#Name), or declaration name"),
        direction: z.enum(["both", "upstream", "downstream"]).default("both"),
        depth: z.number().int().min(1).max(3).default(1),
      }),
      outputSchema: DependenciesOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ target: raw, direction, depth }) => {
      const state = await ctx.workspace.get();
      const { model, analysis } = state;
      const info = workspaceInfo(ctx, state);
      let target;
      try {
        target = resolveTarget(state, raw);
      } catch (err) {
        if (err instanceof TargetError) return failure(targetErrorText(err));
        throw err;
      }
      const kind = target.kind === "directory" ? "module" : target.kind;
      const id = target.kind === "symbol" ? target.symbol.id : target.path;
      const deps = dependenciesOf(model, analysis.index, { kind, id }, depth);
      const upstream = direction === "downstream" ? [] : deps.upstream.map(toRow);
      const downstream = direction === "upstream" ? [] : deps.downstream.map(toRow);

      const inTarget = (p: string) => (target.kind === "directory" ? p.startsWith(`${target.path}/`) : p === target.path);
      const externalPackages = [
        ...new Set(analysis.index.external.filter((x) => inTarget(x.path) && (target.kind !== "symbol" || x.enclosing === target.symbol.id)).map((x) => x.module)),
      ].sort();

      const parsed = target.kind === "directory" ? Object.keys(analysis.index.files).some((p) => inTarget(p)) : Boolean(analysis.index.files[target.path]);
      const l = analysis.index.limits;
      const coverage =
        (parsed ? "The target was parsed. " : "The target itself was not parsed (unsupported language, too large, or beyond the parse cap), so only edges *into* it from parsed files can appear. ") +
        `Edges come from ${l.parsed} of ${l.eligible} parseable files. Dynamic dispatch, dependency injection and runtime wiring are not visible to static analysis.`;

      const structured = { workspace: info, target: { kind: target.kind, id, path: target.path }, upstream, downstream, externalPackages, truncated: deps.truncated, coverage };
      const fmt = (r: z.infer<typeof RelationSchema>) => `- ${"  ".repeat(r.depth - 1)}${r.kind === "call" ? "calls" : "imports"}: ${r.name}${r.kind === "call" ? ` (${r.path})` : ""}${r.typeOnly ? " [type-only]" : ""} — at ${r.evidence}`;
      const lines = [header(info), "", `Target: ${target.kind} ${id}`];
      if (direction !== "downstream") lines.push("", `Upstream — depends on the target (${upstream.length}):`, ...(upstream.length ? upstream.map(fmt) : ["- none found"]));
      if (direction !== "upstream") lines.push("", `Downstream — the target depends on (${downstream.length}):`, ...(downstream.length ? downstream.map(fmt) : ["- none found"]));
      if (externalPackages.length) lines.push("", `External packages used: ${externalPackages.join(", ")}`);
      if (deps.truncated) lines.push("", "Results were capped; narrow the target or reduce depth.");
      lines.push("", coverage);
      return result(structured, lines.join("\n"));
    }),
  );
}
