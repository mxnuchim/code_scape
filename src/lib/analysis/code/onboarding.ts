/**
 * A repository-specific onboarding guide: where to start, what to read in
 * which order and why, how the main parts connect, how to run and test it,
 * and questions worth asking next. Built only from the overview, the index
 * and the journeys; every reading-order item says why it is there.
 */
import type { RepoModel } from "../types";
import type { Journey } from "./journeys";
import type { Overview } from "./overview";
import { centralFiles, relatedTests } from "./queries";
import type { Basis, CodeIndex } from "./types";

export interface ReadingItem {
  order: number;
  path: string;
  /** Symbol id when the item is a specific declaration. */
  symbol?: string;
  line?: number;
  reason: string;
  basis: Basis;
}

export interface OnboardingGuide {
  summary: string;
  readingOrder: ReadingItem[];
  keyComponents: { path: string; importedBy: number; calledFrom: number; reason: string; basis: Basis }[];
  connections: { from: string; to: string; imports: number }[];
  representativeJourney: string | null;
  run: { name: string; command: string; path: string; line: number }[];
  test: { name: string; command: string; path: string; line: number }[];
  questions: string[];
}

const MAX_ITEMS = 12;

export function buildOnboarding(model: RepoModel, index: CodeIndex, overview: Overview, journeys: Journey[]): OnboardingGuide {
  const items: ReadingItem[] = [];
  /** Journey steps may revisit a file for a different symbol; everything else is one item per file. */
  const add = (item: Omit<ReadingItem, "order">) => {
    if (items.length >= MAX_ITEMS) return;
    const dup = item.symbol ? items.some((i) => i.path === item.path && i.symbol === item.symbol) : items.some((i) => i.path === item.path);
    if (dup) return;
    items.push({ ...item, order: items.length + 1 });
  };

  const readme = model.files.find((f) => f.depth === 0 && f.landmark === "readme");
  if (readme) add({ path: readme.path, reason: "The project's own description of what it is and how to run it.", basis: "fact" });
  const manifest = model.files.find((f) => f.depth === 0 && f.landmark === "manifest");
  if (manifest) add({ path: manifest.path, reason: "Declares dependencies and the commands used to build, run and test the project.", basis: "fact" });

  const strongEntries = overview.entryPoints.filter((e) => e.kind !== "naming-convention" && e.kind !== "framework-convention");
  for (const e of (strongEntries.length ? strongEntries : overview.entryPoints).slice(0, 2)) {
    add({ path: e.path, line: e.evidence.startLine, reason: `Entry point: ${e.label}.`, basis: e.basis });
  }

  const journey = journeys.find((j) => j.steps.filter((s) => s.kind === "call").length >= 2) ?? journeys[0];
  if (journey) {
    for (const step of journey.steps.filter((s) => s.kind !== "external").slice(0, 4)) {
      add({
        path: step.path,
        ...(step.id !== step.path ? { symbol: step.id } : {}),
        ...(step.range ? { line: step.range.startLine } : {}),
        reason: step.index === 0 ? `Where the "${journey.title}" journey starts.` : `Step ${step.index} of the "${journey.title}" journey.`,
        basis: "static-analysis",
      });
    }
  }

  const central = centralFiles(model, index, 8);
  for (const c of central.slice(0, 4)) {
    add({ path: c.path, reason: `Other code depends on it: imported by ${c.importedBy} file${c.importedBy === 1 ? "" : "s"}${c.calledFrom ? `, ${c.calledFrom} resolved call site${c.calledFrom === 1 ? "" : "s"}` : ""}.`, basis: "static-analysis" });
  }
  const topCentral = central[0]?.path;
  const test = topCentral ? relatedTests(model, index, topCentral, 1)[0] : undefined;
  if (test) add({ path: test.path, reason: `Tests for ${topCentral}: ${test.reason}.`, basis: test.basis });

  const commands = overview.commands.map((c) => ({ name: c.name, command: c.command, path: c.evidence.path, line: c.evidence.startLine }));
  const isTest = (c: { name: string; command: string }) => /(^|[\s:])test|pytest|vitest|jest|spec/i.test(`${c.name} ${c.command}`);
  const isRun = (c: { name: string }) => /(^|[\s:])(dev|start|serve|run|build)\b/i.test(c.name);

  const questions: string[] = [];
  const ext = journey?.steps.find((s) => s.kind === "external");
  if (journey && ext) questions.push(`How does "${journey.title}" get from ${journey.steps[0].name} to \`${ext.name}\` in ${ext.module}?`);
  if (topCentral) questions.push(`Why do so many files depend on ${topCentral}, and what would a change there affect?`);
  const httpModule = overview.modules.find((m) => m.role?.label === "HTTP / API layer");
  if (httpModule) questions.push(`Which routes in ${httpModule.path} need authentication, and where is that enforced?`);
  if (overview.modules.length > 1) questions.push(`What is the boundary between ${overview.modules[0].path} and ${overview.modules[1].path}?`);
  if (overview.tests.files === 0) questions.push("There are no test files: how is this project verified?");

  const parts: string[] = [];
  parts.push(`${overview.name} appears to be: ${overview.projectType.label} (${overview.projectType.reasons[0] ?? "heuristic"}).`);
  const langs = overview.languages.slice(0, 3).map((l) => l.language);
  if (langs.length) parts.push(`Mostly ${langs.join(", ")} across ${model.stats.files} files.`);
  if (overview.routes.total) parts.push(`${overview.routes.total} HTTP route registration${overview.routes.total === 1 ? "" : "s"} were found.`);
  if (journey) parts.push(`Start with the "${journey.title}" journey to see one path through the code.`);

  return {
    summary: parts.join(" "),
    readingOrder: items,
    keyComponents: central.map((c) => ({
      path: c.path,
      importedBy: c.importedBy,
      calledFrom: c.calledFrom,
      reason: `imported by ${c.importedBy} file${c.importedBy === 1 ? "" : "s"}`,
      basis: "static-analysis" as const,
    })),
    connections: overview.boundaries.slice(0, 10),
    representativeJourney: journey?.id ?? null,
    run: commands.filter((c) => isRun(c) && !isTest(c)).slice(0, 6),
    test: commands.filter(isTest).slice(0, 6),
    questions: questions.slice(0, 5),
  };
}
