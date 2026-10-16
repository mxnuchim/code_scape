/**
 * The one entry point for analysing a repository, used by every surface:
 * the browser (GitHub mode), the local Next.js API and the CLI.
 *
 *   snapshot (file tree) ─▶ RepoModel ─▶ CodeIndex ─▶ overview, journeys, onboarding
 *
 * Inputs are a snapshot and a `readText` function, so the same code works
 * over the GitHub API and over a local checkout.
 */
import type { RepoSnapshot } from "../github/types";
import { buildRepoModel } from "./buildModel";
import { buildCodeIndex, type BuildIndexOptions, type ReadText } from "./code/buildIndex";
import { buildJourneys, type Journey } from "./code/journeys";
import { buildOnboarding, type OnboardingGuide } from "./code/onboarding";
import { buildOverview, overviewInputs, type Overview } from "./code/overview";
import type { CodeIndex } from "./code/types";
import type { DependencyGraph } from "./imports/trace";
import type { RepoModel } from "./types";

export const ANALYSIS_VERSION = 1;

export interface WorkspaceAnalysis {
  version: typeof ANALYSIS_VERSION;
  analyzedAt: number;
  /** Changes whenever files change (local analyses only). */
  fingerprint: string | null;
  snapshot: RepoSnapshot;
  index: CodeIndex;
  overview: Overview;
  journeys: Journey[];
  onboarding: OnboardingGuide;
}

export type AnalyzeOptions = Omit<BuildIndexOptions, "readText"> & { fingerprint?: string | null };

export async function analyzeRepository(
  snapshot: RepoSnapshot,
  readText: ReadText,
  options: AnalyzeOptions = {},
): Promise<{ model: RepoModel; analysis: WorkspaceAnalysis }> {
  const model = buildRepoModel(snapshot);
  return { model, analysis: await analyzeModel(model, snapshot, readText, options) };
}

/** Like analyzeRepository, for callers that already built the model from `snapshot`. */
export async function analyzeModel(
  model: RepoModel,
  snapshot: RepoSnapshot,
  readText: ReadText,
  options: AnalyzeOptions = {},
): Promise<WorkspaceAnalysis> {
  const signal = options.signal ?? new AbortController().signal;
  const index = await buildCodeIndex(model, { ...options, readText, signal });

  const texts = new Map<string, string>();
  for (const path of overviewInputs(model)) {
    if (options.isWithheld?.(path)) continue;
    const text = await readText(path, signal).catch(() => null);
    if (text !== null) texts.set(path, text);
  }
  if (signal.aborted) throw new DOMException("Analysis cancelled", "AbortError");

  const overview = buildOverview(model, index, texts);
  const journeys = buildJourneys(model, index);
  const onboarding = buildOnboarding(model, index, overview, journeys);
  return {
    version: ANALYSIS_VERSION,
    analyzedAt: Date.now(),
    fingerprint: options.fingerprint ?? null,
    snapshot,
    index,
    overview,
    journeys,
    onboarding,
  };
}

/** Minimal runtime check for analysis JSON received over HTTP. */
export function isWorkspaceAnalysis(value: unknown): value is WorkspaceAnalysis {
  const v = value as Partial<WorkspaceAnalysis> | null;
  return (
    !!v &&
    v.version === ANALYSIS_VERSION &&
    !!v.snapshot &&
    Array.isArray(v.snapshot.entries) &&
    !!v.index &&
    typeof v.index.files === "object" &&
    Array.isArray(v.index.importEdges) &&
    Array.isArray(v.journeys) &&
    !!v.overview &&
    !!v.onboarding
  );
}

/** The file-level import graph in the shape the city renderer already uses. */
export function toDependencyGraph(index: CodeIndex): DependencyGraph {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const edges = index.importEdges.map((e) => ({ from: e.fromPath, to: e.toPath }));
  for (const { from, to } of edges) {
    (outgoing.get(from) ?? outgoing.set(from, []).get(from)!).push(to);
    (incoming.get(to) ?? incoming.set(to, []).get(to)!).push(from);
  }
  return {
    edges,
    outgoing,
    incoming,
    traced: new Set(Object.keys(index.files)),
    failed: new Set(index.limits.failed),
    eligible: index.limits.eligible,
    skippedLarge: index.limits.skippedLarge,
    cap: index.limits.cap,
    aliasSource: index.limits.aliasSource,
  };
}
