import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { BasisSchema, WorkspaceInfoSchema, guarded, header, loc, result, workspaceInfo, type ToolContext } from "../context";

const Ev = z.string().describe("Evidence as path:line");

export const OverviewOutput = z.object({
  workspace: WorkspaceInfoSchema,
  description: z.object({ text: z.string(), evidence: Ev }).nullable(),
  projectType: z.object({ label: z.string(), basis: BasisSchema, reasons: z.array(z.string()) }),
  languages: z.array(z.object({ language: z.string(), files: z.number() })),
  technologies: z.array(z.object({ name: z.string(), category: z.string(), evidence: Ev })),
  modules: z.array(
    z.object({
      path: z.string(),
      files: z.number(),
      role: z.object({ label: z.string(), basis: BasisSchema, reason: z.string() }).nullable(),
      importedBy: z.number(),
      imports: z.number(),
    }),
  ),
  entryPoints: z.array(z.object({ path: z.string(), symbol: z.string().nullable(), label: z.string(), basis: BasisSchema, evidence: Ev })),
  routes: z.object({ total: z.number(), byFramework: z.record(z.string(), z.number()) }),
  commands: z.array(z.object({ name: z.string(), command: z.string(), evidence: Ev })),
  tests: z.object({ files: z.number(), frameworks: z.array(z.string()), locations: z.array(z.object({ path: z.string(), files: z.number() })) }),
  configFiles: z.array(z.string()),
  boundaries: z.array(z.object({ from: z.string(), to: z.string(), imports: z.number() })),
  journeys: z.array(z.object({ id: z.string(), title: z.string(), steps: z.number() })),
  limitations: z.array(z.string()),
});

export function registerOverview(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_codebase_overview",
    {
      title: "Codebase overview",
      description:
        "Summarise the repository from static analysis: what kind of project it is, technologies (from manifests), main modules and their likely roles, entry points, HTTP routes, run/test commands, test locations, module boundaries, detected code journeys and the limits of the analysis. Every claim is labelled fact / static-analysis / heuristic with path:line evidence. Call this first when orienting in an unfamiliar repository.",
      inputSchema: z.object({}),
      outputSchema: OverviewOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async () => {
      const state = await ctx.workspace.get();
      const { overview: o, journeys } = state.analysis;
      const info = workspaceInfo(ctx, state);
      const ev = (e: { path: string; startLine: number }) => loc(e.path, e.startLine);
      const structured: z.infer<typeof OverviewOutput> = {
        workspace: info,
        description: o.description ? { text: o.description.text, evidence: ev(o.description.evidence) } : null,
        projectType: o.projectType,
        languages: o.languages.map((l) => ({ language: l.language, files: l.files })),
        technologies: o.technologies.map((t) => ({ name: t.name, category: t.category, evidence: ev(t.evidence) })),
        modules: o.modules.map((m) => ({ path: m.path || "(root)", files: m.files, role: m.role ?? null, importedBy: m.importedBy, imports: m.imports })),
        entryPoints: o.entryPoints.slice(0, 15).map((e) => ({ path: e.path, symbol: e.symbol ?? null, label: e.label, basis: e.basis, evidence: ev(e.evidence) })),
        routes: o.routes,
        commands: o.commands.slice(0, 20).map((c) => ({ name: c.name, command: c.command, evidence: ev(c.evidence) })),
        tests: o.tests,
        configFiles: o.configFiles.slice(0, 15),
        boundaries: o.boundaries.slice(0, 12),
        journeys: journeys.slice(0, 12).map((j) => ({ id: j.id, title: j.title, steps: j.steps.length })),
        limitations: o.limitations,
      };

      const lines: string[] = [header(info), ""];
      lines.push(`Project type (${o.projectType.basis}): ${o.projectType.label} — ${o.projectType.reasons.join("; ")}`);
      if (o.description) lines.push(`Description (fact, ${ev(o.description.evidence)}): ${o.description.text}`);
      lines.push(`Languages: ${o.languages.map((l) => `${l.language} (${l.files})`).join(", ")}`);
      if (o.technologies.length) lines.push(`Technologies (fact): ${o.technologies.map((t) => `${t.name} [${ev(t.evidence)}]`).join(", ")}`);
      lines.push("", "Modules:");
      for (const m of structured.modules) {
        lines.push(`- ${m.path} — ${m.files} files${m.role ? `; ${m.role.label} (${m.role.basis}: ${m.role.reason})` : ""}; imported by ${m.importedBy} / imports ${m.imports} cross-module`);
      }
      lines.push("", "Entry points:");
      for (const e of structured.entryPoints) lines.push(`- ${e.path}${e.symbol ? `#${e.symbol}` : ""} — ${e.label} (${e.basis}, ${e.evidence})`);
      if (o.routes.total) lines.push(`HTTP routes found: ${o.routes.total} (${Object.entries(o.routes.byFramework).map(([k, v]) => `${k}: ${v}`).join(", ")})`);
      if (structured.commands.length) {
        lines.push("", "Commands (fact):");
        for (const c of structured.commands) lines.push(`- ${c.name}: \`${c.command}\` (${c.evidence})`);
      }
      lines.push("", `Tests: ${o.tests.files} files${o.tests.frameworks.length ? ` using ${o.tests.frameworks.join(", ")}` : ""}${o.tests.locations.length ? ` in ${o.tests.locations.map((l) => l.path).join(", ")}` : ""}`);
      if (structured.boundaries.length) lines.push(`Module dependencies (static-analysis): ${structured.boundaries.map((b) => `${b.from || "(root)"} → ${b.to || "(root)"} ×${b.imports}`).join(", ")}`);
      if (structured.journeys.length) {
        lines.push("", "Code journeys (trace with trace_code_path):");
        for (const j of structured.journeys) lines.push(`- ${j.title} — id \`${j.id}\`, ${j.steps} steps`);
      }
      lines.push("", "Limitations:", ...o.limitations.map((l) => `- ${l}`));
      return result(structured, lines.join("\n"));
    }),
  );
}
