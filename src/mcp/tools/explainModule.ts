import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { indexLookup, relatedTests } from "../../lib/analysis/code/queries";
import { moduleOf } from "../../lib/analysis/code/overview";
import { BasisSchema, WorkspaceInfoSchema, failure, guarded, header, loc, result, workspaceInfo, type ToolContext } from "../context";
import { TargetError, resolveTarget, targetErrorText } from "../targets";

const MAX_SYMBOLS = 25;

export const ExplainOutput = z.object({
  workspace: WorkspaceInfoSchema,
  target: z.object({
    kind: z.enum(["file", "directory", "symbol"]),
    path: z.string(),
    symbolId: z.string().nullable(),
    language: z.string().nullable(),
    category: z.string().nullable(),
    files: z.number(),
    bytes: z.number(),
    lines: z.number().nullable(),
    parsed: z.boolean().describe("Whether source was parsed (symbols and edges available)"),
  }),
  facts: z.array(z.object({ text: z.string(), basis: BasisSchema, evidence: z.string().nullable() })),
  roleHypothesis: z.object({ label: z.string(), basis: BasisSchema, reasons: z.array(z.string()) }).nullable(),
  symbols: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string(), lines: z.string(), exported: z.boolean(), doc: z.string().nullable() })),
  importsFrom: z.array(z.object({ path: z.string(), evidence: z.string() })),
  importedBy: z.array(z.object({ path: z.string(), evidence: z.string() })),
  externalPackages: z.array(z.string()),
  routes: z.array(z.object({ method: z.string(), route: z.string(), evidence: z.string() })),
  relatedTests: z.array(z.object({ path: z.string(), basis: BasisSchema, reason: z.string() })),
  excerpt: z.object({ path: z.string(), startLine: z.number(), endLine: z.number(), text: z.string() }).nullable(),
});

type Fact = z.infer<typeof ExplainOutput>["facts"][number];

const FILE_ROLE: [RegExp, string][] = [
  [/(controller|handler|route|router|endpoint|resolver|api)s?$/i, "Request handling"],
  [/(service|usecase|manager|interactor)s?$/i, "Business logic"],
  [/(repo|repository|dao|model|entity|schema|db|database|store)s?$/i, "Data access / data model"],
  [/(util|utils|helper|helpers|common|shared)$/i, "Shared helpers"],
  [/(config|settings|env)$/i, "Configuration"],
  [/(middleware)s?$/i, "Request middleware"],
  [/^use[A-Z]/, "React hook"],
  [/(client|sdk|gateway|adapter)$/i, "Integration with another system"],
  [/(cli|main|index|server|app)$/i, "Entry or composition point"],
];

export function registerExplainModule(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "explain_module",
    {
      title: "Explain module",
      description:
        "Gather the evidence needed to explain a file, folder or declaration: what it contains (symbols with line ranges), what it imports and what imports it, packages it uses, routes it registers, related tests, a short redacted source excerpt, and a role hypothesis labelled with its basis. Use this evidence to write the explanation; do not present the heuristic role as fact.",
      inputSchema: z.object({
        target: z.string().min(1).max(400).describe("Repository-relative file or folder path, a symbol id from find_code (path#Name), or a declaration name"),
      }),
      outputSchema: ExplainOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ target: raw }) => {
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
      const lookup = indexLookup(analysis.index);
      const facts: Fact[] = [];
      const paths = target.kind === "directory" ? model.files.filter((f) => f.path.startsWith(`${target.path}/`)).map((f) => f.path) : [target.path];
      const pathSet = new Set(paths);
      const inTarget = (p: string) => pathSet.has(p);
      const parsedFiles = paths.map((p) => analysis.index.files[p]).filter((f) => f !== undefined);

      // ---- symbols
      const allSymbols = target.kind === "symbol" ? [target.symbol] : parsedFiles.flatMap((f) => f.symbols);
      const symbols = [...allSymbols]
        .sort((a, b) => Number(b.exported) - Number(a.exported) || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.range.startLine - b.range.startLine))
        .slice(0, MAX_SYMBOLS)
        .map((s) => ({ id: s.id, name: s.qualifiedName, kind: s.kind, lines: loc(s.path, s.range.startLine, s.range.endLine), exported: s.exported, doc: s.doc ?? null }));

      // ---- relationships (file level, across the target boundary)
      const importsFrom = new Map<string, string>();
      const importedBy = new Map<string, string>();
      for (const p of paths) {
        for (const e of lookup.importsOut.get(p) ?? []) if (!inTarget(e.toPath)) importsFrom.set(e.toPath, loc(e.fromPath, e.lines[0]));
        for (const e of lookup.importsIn.get(p) ?? []) if (!inTarget(e.fromPath)) importedBy.set(e.fromPath, loc(e.fromPath, e.lines[0]));
      }
      if (target.kind === "symbol") {
        importsFrom.clear();
        importedBy.clear();
        for (const e of lookup.callsOut.get(target.symbol.id) ?? []) importsFrom.set(e.to, loc(e.fromPath, e.lines[0]));
        for (const e of lookup.callsIn.get(target.symbol.id) ?? []) importedBy.set(e.from, loc(e.fromPath, e.lines[0]));
      }
      const externalPackages = [...new Set(analysis.index.external.filter((x) => inTarget(x.path) && (target.kind !== "symbol" || x.enclosing === target.symbol.id)).map((x) => x.module))].sort().slice(0, 20);
      const routes = parsedFiles.flatMap((f) => f.routes.map((r) => ({ method: r.method, route: r.route, evidence: loc(f.path, r.line) }))).slice(0, 20);

      // ---- facts
      const file = model.filesByPath.get(target.path);
      const dir = model.dirsByPath.get(target.path);
      if (file) {
        const lineCount = analysis.index.files[file.path]?.lineCount;
        facts.push({ text: `${file.size} bytes${lineCount ? `, ${lineCount} lines` : ""}`, basis: "fact", evidence: null });
        facts.push({ text: `Classified as ${file.language} / ${file.category} (by file name and extension)`, basis: "heuristic", evidence: null });
      }
      if (dir) facts.push({ text: `${dir.stats.files} files in ${dir.stats.dirs} subfolders; languages: ${Object.entries(dir.stats.languages).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, n]) => `${l} ${n}`).join(", ")}`, basis: "fact", evidence: null });
      if (target.kind === "symbol") facts.push({ text: `${target.symbol.kind} \`${target.symbol.qualifiedName}\`${target.symbol.exported ? ", exported" : ""}`, basis: "static-analysis", evidence: loc(target.path, target.symbol.range.startLine, target.symbol.range.endLine) });
      const entry = analysis.overview.entryPoints.filter((e) => inTarget(e.path));
      for (const e of entry.slice(0, 3)) facts.push({ text: `Entry point: ${e.label}`, basis: e.basis, evidence: loc(e.evidence.path, e.evidence.startLine) });
      if (routes.length) facts.push({ text: `Registers ${routes.length} HTTP route${routes.length === 1 ? "" : "s"}`, basis: "static-analysis", evidence: routes[0].evidence });
      if (importedBy.size) facts.push({ text: `${target.kind === "symbol" ? "Called from" : "Imported by"} ${importedBy.size} ${target.kind === "symbol" ? "place" : "file"}${importedBy.size === 1 ? "" : "s"} outside it`, basis: "static-analysis", evidence: null });
      for (const j of analysis.journeys.filter((j) => j.steps.some((s) => inTarget(s.path))).slice(0, 3)) {
        facts.push({ text: `Part of the "${j.title}" journey (id ${j.id})`, basis: "static-analysis", evidence: null });
      }
      if (paths.length && !parsedFiles.length) facts.push({ text: "Not parsed (unsupported language, over the size limit or outside the parse cap): no symbols or edges are available.", basis: "fact", evidence: null });

      // ---- role hypothesis
      let roleHypothesis: z.infer<typeof ExplainOutput>["roleHypothesis"] = null;
      const mod = analysis.overview.modules.find((m) => m.path === moduleOf(analysis.overview.modules, target.path));
      const stemName = (target.kind === "symbol" ? target.symbol.name : target.path.slice(target.path.lastIndexOf("/") + 1)).replace(/\.[^.]+$/, "");
      const byName = FILE_ROLE.find(([re]) => re.test(stemName));
      if (routes.length) roleHypothesis = { label: "HTTP request handling", basis: "static-analysis", reasons: [`registers ${routes.length} route(s)`] };
      else if (byName) roleHypothesis = { label: byName[1], basis: "heuristic", reasons: [`name \`${stemName}\``, ...(mod?.role ? [`inside ${mod.path || "(root)"} (${mod.role.label}, ${mod.role.basis})`] : [])] };
      else if (mod?.role) roleHypothesis = { label: mod.role.label, basis: mod.role.basis === "fact" ? "heuristic" : mod.role.basis, reasons: [`inside ${mod.path || "(root)"}: ${mod.role.reason}`] };

      const tests = target.kind === "directory" ? [] : relatedTests(model, analysis.index, target.path, 6);

      // ---- excerpt (a file's head or a symbol's body), redacted
      let excerpt: z.infer<typeof ExplainOutput>["excerpt"] = null;
      if (target.kind !== "directory") {
        const start = target.kind === "symbol" ? target.symbol.range.startLine : 1;
        const end = target.kind === "symbol" ? Math.min(target.symbol.range.endLine, start + 39) : 30;
        try {
          const ex = await ctx.workspace.excerpt(target.path, start, end, 40);
          excerpt = { path: ex.path, startLine: ex.startLine, endLine: ex.endLine, text: ex.text };
        } catch {
          facts.push({ text: "Source excerpt unavailable (withheld, binary or too large).", basis: "fact", evidence: null });
        }
      }

      const structured: z.infer<typeof ExplainOutput> = {
        workspace: info,
        target: {
          kind: target.kind,
          path: target.path,
          symbolId: target.kind === "symbol" ? target.symbol.id : null,
          language: file?.language ?? null,
          category: file?.category ?? null,
          files: paths.length,
          bytes: paths.reduce((n, p) => n + (model.filesByPath.get(p)?.size ?? 0), 0),
          lines: target.kind === "file" ? (analysis.index.files[target.path]?.lineCount ?? null) : null,
          parsed: parsedFiles.length > 0,
        },
        facts,
        roleHypothesis,
        symbols,
        importsFrom: [...importsFrom].slice(0, 20).map(([path, evidence]) => ({ path, evidence })),
        importedBy: [...importedBy].slice(0, 20).map(([path, evidence]) => ({ path, evidence })),
        externalPackages,
        routes,
        relatedTests: tests,
        excerpt,
      };

      const rel = target.kind === "symbol" ? ["Calls", "Called by"] : ["Imports from", "Imported by"];
      const lines = [header(info), "", `${target.kind}: ${target.kind === "symbol" ? target.symbol.id : target.path}`];
      lines.push("", "Facts:", ...facts.map((f) => `- (${f.basis}) ${f.text}${f.evidence ? ` [${f.evidence}]` : ""}`));
      if (roleHypothesis) lines.push("", `Role hypothesis (${roleHypothesis.basis} — verify against the code): ${roleHypothesis.label}; ${roleHypothesis.reasons.join("; ")}`);
      if (symbols.length) lines.push("", `Declarations${allSymbols.length > symbols.length ? ` (first ${symbols.length} of ${allSymbols.length})` : ""}:`, ...symbols.map((s) => `- ${s.kind} ${s.name}${s.exported ? " (exported)" : ""} — ${s.lines}${s.doc ? ` — ${s.doc}` : ""}`));
      if (structured.importsFrom.length) lines.push("", `${rel[0]}:`, ...structured.importsFrom.map((r) => `- ${r.path} (at ${r.evidence})`));
      if (structured.importedBy.length) lines.push("", `${rel[1]}:`, ...structured.importedBy.map((r) => `- ${r.path} (at ${r.evidence})`));
      if (externalPackages.length) lines.push("", `Packages used: ${externalPackages.join(", ")}`);
      if (routes.length) lines.push("", "Routes:", ...routes.map((r) => `- ${r.method} ${r.route} (${r.evidence})`));
      if (tests.length) lines.push("", "Related tests:", ...tests.map((t) => `- ${t.path} (${t.basis}: ${t.reason})`));
      if (excerpt) lines.push("", `Excerpt ${loc(excerpt.path, excerpt.startLine, excerpt.endLine)} (redacted):`, "```", excerpt.text, "```");
      return result(structured, lines.join("\n"));
    }),
  );
}
