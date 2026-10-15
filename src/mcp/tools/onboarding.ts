import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { normalizeRepoPath } from "../../lib/local/safety";
import { BasisSchema, WorkspaceInfoSchema, guarded, header, loc, result, workspaceInfo, type ToolContext } from "../context";
import { JourneySchema, renderJourney, toJourneyRow } from "./tracePath";

export const OnboardingOutput = z.object({
  workspace: WorkspaceInfoSchema,
  focus: z.string().nullable(),
  summary: z.string(),
  readingOrder: z.array(z.object({ order: z.number(), location: z.string(), symbolId: z.string().nullable(), reason: z.string(), basis: BasisSchema })),
  keyComponents: z.array(z.object({ path: z.string(), importedBy: z.number(), calledFrom: z.number(), basis: BasisSchema })),
  connections: z.array(z.object({ from: z.string(), to: z.string(), imports: z.number() })),
  representativeJourney: JourneySchema.nullable(),
  run: z.array(z.object({ name: z.string(), command: z.string(), evidence: z.string() })),
  test: z.array(z.object({ name: z.string(), command: z.string(), evidence: z.string() })),
  questions: z.array(z.string()),
  limitations: z.array(z.string()),
});

export function registerOnboarding(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_onboarding_guide",
    {
      title: "Onboarding guide",
      description:
        "A repository-specific onboarding guide: a recommended reading order where every item says why it is there, the components most other code depends on, how the main modules connect, one representative code journey, how to run and test the project (from manifests), and questions worth investigating next. Optionally focus on a folder (e.g. 'src/billing').",
      inputSchema: z.object({
        focus: z.string().max(300).optional().describe("Optional folder to focus on, e.g. 'src/auth'"),
      }),
      outputSchema: OnboardingOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ focus: rawFocus }) => {
      const state = await ctx.workspace.get();
      const { analysis, model } = state;
      const info = workspaceInfo(ctx, state);
      const g = analysis.onboarding;
      const focus = rawFocus ? normalizeRepoPath(rawFocus) : null;
      if (focus && !model.dirsByPath.has(focus) && !model.filesByPath.has(focus)) {
        throw new Error(`"${focus}" is not a folder or file in this repository.`);
      }
      const inFocus = (p: string) => !focus || p === focus || p.startsWith(`${focus}/`);

      let readingOrder = g.readingOrder.filter((i) => inFocus(i.path) || (!!focus && i.order <= 2));
      let keyComponents = g.keyComponents.filter((k) => inFocus(k.path));
      if (focus) {
        // Inside a focus area, rank its files by how much other code depends on them.
        const extra = analysis.index.importEdges
          .filter((e) => inFocus(e.toPath) && !e.typeOnly)
          .reduce((m, e) => m.set(e.toPath, (m.get(e.toPath) ?? 0) + 1), new Map<string, number>());
        for (const [path, n] of [...extra].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
          if (!keyComponents.some((k) => k.path === path)) keyComponents.push({ path, importedBy: n, calledFrom: 0, reason: `imported ${n} times`, basis: "static-analysis" });
          if (!readingOrder.some((r) => r.path === path)) readingOrder.push({ order: 0, path, reason: `Inside ${focus}; imported ${n} time${n === 1 ? "" : "s"}.`, basis: "static-analysis" });
        }
        readingOrder = readingOrder.map((r, i) => ({ ...r, order: i + 1 }));
      }
      keyComponents = keyComponents.slice(0, 10);

      const journey = focus
        ? analysis.journeys.find((j) => j.steps.some((s) => inFocus(s.path)))
        : analysis.journeys.find((j) => j.id === g.representativeJourney);
      const journeyRow = journey ? toJourneyRow(journey) : null;

      const structured: z.infer<typeof OnboardingOutput> = {
        workspace: info,
        focus,
        summary: g.summary,
        readingOrder: readingOrder.map((r) => ({ order: r.order, location: loc(r.path, r.line), symbolId: r.symbol ?? null, reason: r.reason, basis: r.basis })),
        keyComponents: keyComponents.map((k) => ({ path: k.path, importedBy: k.importedBy, calledFrom: k.calledFrom, basis: k.basis })),
        connections: focus ? g.connections.filter((c) => inFocus(c.from) || inFocus(c.to)) : g.connections,
        representativeJourney: journeyRow,
        run: g.run.map((c) => ({ name: c.name, command: c.command, evidence: loc(c.path, c.line) })),
        test: g.test.map((c) => ({ name: c.name, command: c.command, evidence: loc(c.path, c.line) })),
        questions: g.questions,
        limitations: analysis.overview.limitations,
      };

      const lines = [header(info), "", structured.summary];
      if (focus) lines.push(`Focus: ${focus}`);
      lines.push("", "Recommended reading order:");
      for (const r of structured.readingOrder) lines.push(`${r.order}. ${r.location}${r.symbolId ? ` (${r.symbolId.split("#")[1]})` : ""} — ${r.reason} [${r.basis}]`);
      if (structured.keyComponents.length) {
        lines.push("", "Components other code depends on most (static-analysis):");
        for (const k of structured.keyComponents) lines.push(`- ${k.path}: imported by ${k.importedBy}${k.calledFrom ? `, ${k.calledFrom} call sites` : ""}`);
      }
      if (structured.connections.length) lines.push("", `How modules connect (imports): ${structured.connections.map((c) => `${c.from || "(root)"} → ${c.to || "(root)"} ×${c.imports}`).join(", ")}`);
      if (journeyRow) lines.push("", "Representative journey:", ...renderJourney(journeyRow));
      if (structured.run.length) lines.push("", "Run / build (fact):", ...structured.run.map((c) => `- ${c.name}: \`${c.command}\` (${c.evidence})`));
      if (structured.test.length) lines.push("", "Test (fact):", ...structured.test.map((c) => `- ${c.name}: \`${c.command}\` (${c.evidence})`));
      if (structured.questions.length) lines.push("", "Questions to investigate next:", ...structured.questions.map((q) => `- ${q}`));
      lines.push("", "Limitations:", ...structured.limitations.map((l) => `- ${l}`));
      lines.push("", "Tip: open_in_codescape shows any of these locations in the 3D map.");
      return result(structured, lines.join("\n"));
    }),
  );
}
