import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { journeyFromSymbol, traceFrom, type Journey } from "../../lib/analysis/code/journeys";
import { searchSymbols, splitIdentifier } from "../../lib/analysis/code/queries";
import { WorkspaceInfoSchema, failure, guarded, header, loc, result, workspaceInfo, type ToolContext } from "../context";
import { TargetError, resolveTarget, targetErrorText } from "../targets";

export const JourneySchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["http", "main", "cli", "symbol"]),
  start: z.string().describe("Where the journey starts, path:line"),
  steps: z.array(
    z.object({
      index: z.number(),
      depth: z.number(),
      kind: z.enum(["entry", "call", "external"]),
      name: z.string(),
      symbolId: z.string().nullable(),
      location: z.string().describe("Declaration of this step, path:start-end"),
      calledAt: z.string().nullable().describe("Where the previous step calls this one, path:line"),
      module: z.string().nullable().describe("For external steps: the package called into"),
    }),
  ),
  gaps: z.array(z.object({ atStep: z.number(), reason: z.string(), location: z.string() })),
  truncated: z.boolean(),
});

export const TraceOutput = z.object({
  workspace: WorkspaceInfoSchema,
  found: z.boolean(),
  journey: JourneySchema.nullable(),
  explanation: z.string(),
  otherJourneys: z.array(z.object({ id: z.string(), title: z.string() })),
});

export function toJourneyRow(j: Journey): z.infer<typeof JourneySchema> {
  return {
    id: j.id,
    title: j.title,
    kind: j.kind,
    start: loc(j.start.path, j.start.line),
    steps: j.steps.map((s) => ({
      index: s.index,
      depth: s.depth,
      kind: s.kind,
      name: s.name,
      symbolId: s.kind === "external" || s.id === s.path ? null : s.id,
      location: s.kind === "external" ? `package ${s.module}` : loc(s.path, s.range?.startLine, s.range?.endLine),
      calledAt: s.via ? loc(s.via.path, s.via.line) : null,
      module: s.module ?? null,
    })),
    gaps: j.gaps.map((g) => ({ atStep: g.atStep, reason: g.reason, location: loc(g.path, g.line) })),
    truncated: j.truncated,
  };
}

export function renderJourney(j: z.infer<typeof JourneySchema>): string[] {
  const lines = [`Journey "${j.title}" (id ${j.id}) — starts at ${j.start}`];
  for (const s of j.steps) {
    const indent = "  ".repeat(s.depth);
    if (s.kind === "external") lines.push(`${indent}${s.index}. → leaves the repo: \`${s.name}\` (${s.module})${s.calledAt ? ` at ${s.calledAt}` : ""}`);
    else lines.push(`${indent}${s.index}. ${s.name} — ${s.location}${s.calledAt ? ` (called at ${s.calledAt})` : ""}`);
  }
  for (const g of j.gaps) lines.push(`  ⚠ gap after step ${g.atStep}: ${g.reason} (${g.location})`);
  if (j.truncated) lines.push("  (stopped at the step/depth limit)");
  return lines;
}

const ORDER_NOTE =
  "Steps follow resolved call edges depth-first in source order. They show what each step can call, not the runtime order, and branches that depend on data are all listed.";

export function registerTracePath(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "trace_code_path",
    {
      title: "Trace code path",
      description:
        "Trace how an operation moves through the code: an ordered sequence of declarations connected by resolved calls, each with file:line evidence, the point where it leaves the repository (e.g. a database package), and explicit gaps where static analysis can't follow (dynamic dispatch, unresolved handlers). Start from a journey id (see get_codebase_overview), a symbol id or name, a file, or a query such as 'POST /users' or 'checkout'.",
      inputSchema: z.object({
        from: z.string().max(400).optional().describe("Journey id, symbol id (path#Name), declaration name or file path"),
        query: z.string().max(200).optional().describe("Words describing the operation, e.g. 'GET /orders' or 'create user'"),
      }),
      outputSchema: TraceOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ from, query }) => {
      const state = await ctx.workspace.get();
      const { analysis } = state;
      const info = workspaceInfo(ctx, state);
      const others = analysis.journeys.slice(0, 15).map((j) => ({ id: j.id, title: j.title }));
      if (!from && !query) return failure("Pass `from` (journey id, symbol or file) or `query` (e.g. 'POST /users').");

      let journey: Journey | undefined;
      let explanation = "";
      if (from) {
        journey = analysis.journeys.find((j) => j.id === from);
        if (!journey) {
          let target;
          try {
            target = resolveTarget(state, from);
          } catch (err) {
            if (err instanceof TargetError) return failure(targetErrorText(err));
            throw err;
          }
          if (target.kind === "symbol") journey = journeyFromSymbol(analysis.index, target.symbol);
          else if (target.kind === "file") {
            journey = analysis.journeys.find((j) => j.start.path === target.path);
            if (!journey) {
              const fileJourney = traceFrom(analysis.index, { kind: "symbol", title: target.path, label: "module-level code", id: target.path, path: target.path, line: 1 });
              journey = fileJourney.steps.length > 1 ? fileJourney : undefined;
              explanation = journey ? "Traced from the file's module-level code (no journey starts here)." : "";
            }
          } else {
            return failure(`"${from}" is a folder. Pass a file, a declaration or a journey id; get_dependencies works on folders.`);
          }
        }
      } else if (query) {
        const q = query.toLowerCase();
        const words = q.split(/[\s/]+/).filter(Boolean);
        const scored = analysis.journeys
          .map((j) => {
            const title = j.title.toLowerCase();
            const names = j.steps.map((s) => s.name.toLowerCase()).join(" ");
            let score = title === q ? 100 : 0;
            for (const w of words) {
              if (title.includes(w)) score += 10;
              else if (names.includes(w)) score += 3;
            }
            return { j, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score);
        journey = scored[0]?.j;
        if (!journey) {
          const sym = searchSymbols(analysis.index, query, 1)[0] ?? searchSymbols(analysis.index, splitIdentifier(query).join(" "), 1)[0];
          if (sym) {
            journey = journeyFromSymbol(analysis.index, sym.symbol);
            explanation = `No detected journey matched "${query}"; traced from the best-matching declaration ${sym.symbol.id}.`;
          }
        }
      }

      if (!journey || journey.steps.length === 0) {
        const msg = `No code path could be established${from ? ` from "${from}"` : ` for "${query}"`}. Static analysis found no resolved calls to follow. Try find_code to locate the right starting declaration, or one of the detected journeys listed.`;
        return result({ workspace: info, found: false, journey: null, explanation: msg, otherJourneys: others }, [header(info), "", msg, "", ...others.map((o) => `- ${o.title} (${o.id})`)].join("\n"));
      }

      const row = toJourneyRow(journey);
      const single = row.steps.length === 1 && row.gaps.length === 0;
      explanation = [explanation, single ? "This declaration makes no resolved calls into other repository code." : "", ORDER_NOTE].filter(Boolean).join(" ");
      const lines = [header(info), "", ...renderJourney(row), "", explanation];
      if (others.length) lines.push("", "Other detected journeys:", ...others.filter((o) => o.id !== row.id).slice(0, 8).map((o) => `- ${o.title} (${o.id})`));
      return result({ workspace: info, found: true, journey: row, explanation, otherJourneys: others }, lines.join("\n"));
    }),
  );
}
