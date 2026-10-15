import { fetchRawFile, fetchRepoMeta, fetchTree } from "@/lib/github/client";
import { repoPath, repoSlug } from "@/lib/github/parseRepoUrl";
import { GitHubError, isAbortError, type RepoMeta, type RepoRef, type RepoSnapshot, type TreeEntry } from "@/lib/github/types";
import { buildRepoModel } from "@/lib/analysis/buildModel";
import { planTrace, TRACE_FILE_CAP, TRACE_MAX_BYTES } from "@/lib/analysis/imports/trace";
import { analyzeModel, isWorkspaceAnalysis, toDependencyGraph, type WorkspaceAnalysis } from "@/lib/analysis/workspace";
import { initBrowserParsers } from "@/lib/analysis/code/browserParsers";
import type { RepoModel } from "@/lib/analysis/types";
import { buildCityLayout } from "@/lib/layout/cityLayout";
import { resetCityState, useCity, type CityError } from "./store";
import { BUNDLED_SNAPSHOT as BUNDLED_SAMPLE } from "./bundledSnapshot";

export { BUNDLED_SNAPSHOT as BUNDLED_SAMPLE } from "./bundledSnapshot";

export const SAMPLE_REPOS: { owner: string; repo: string; note: string }[] = [
  { owner: "pallets", repo: "flask", note: "Python" },
  { owner: "pmndrs", repo: "zustand", note: "TypeScript" },
  { owner: "expressjs", repo: "express", note: "JavaScript" },
  { owner: "vitejs", repo: "vite", note: "Large monorepo" },
];

type HistoryMode = "push" | "replace" | "none";

let controller: AbortController | null = null;
const sessionCache = new Map<string, RepoSnapshot>();
const SESSION_CACHE_SIZE = 6;

function cacheKey(ref: RepoRef) {
  return `${ref.owner}/${ref.repo}@${ref.ref ?? ""}`.toLowerCase();
}

function remember(key: string, snapshot: RepoSnapshot) {
  sessionCache.delete(key);
  sessionCache.set(key, snapshot);
  while (sessionCache.size > SESSION_CACHE_SIZE) sessionCache.delete(sessionCache.keys().next().value!);
}

function updateHistory(path: string, mode: HistoryMode) {
  if (mode === "none" || typeof window === "undefined") return;
  if (window.location.pathname === path) return;
  if (mode === "push") window.history.pushState(null, "", path);
  else window.history.replaceState(null, "", path);
}

// Yield so the UI can paint the new stage. A timer rather than rAF, because
// rAF never fires in a background tab and the pipeline would stall.
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 16));

/** Dev-only: `?__simulate=rate-limit` etc. lets us check every state without spending API quota. */
function simulationMode(): string | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("__simulate");
}

async function maybeSimulate(mode: string | null, signal: AbortSignal) {
  if (!mode) return;
  await new Promise((r) => setTimeout(r, 1100));
  if (signal.aborted) throw new GitHubError("aborted", "cancelled");
  switch (mode) {
    case "rate-limit":
      throw new GitHubError("rate-limited", "API rate limit exceeded", {
        status: 403,
        rateLimit: { limit: 60, remaining: 0, resetAt: Date.now() + 23 * 60_000 + 12_000 },
      });
    case "secondary":
      throw new GitHubError("secondary-rate-limit", "Slow down", { status: 403, retryAfterMs: 45_000 });
    case "network":
      throw new GitHubError("network", "Failed to fetch");
    case "not-found":
      throw new GitHubError("not-found-or-private", "Not Found", { status: 404 });
    case "empty":
      throw new GitHubError("empty-repo", "Git Repository is empty.", { status: 409 });
    case "blocked":
      throw new GitHubError("blocked", "Repository access blocked", { status: 451 });
    case "unavailable":
      throw new GitHubError("unavailable", "Server error", { status: 502 });
  }
}

function toCityError(err: unknown, repo: RepoRef, defaultBranch?: string): CityError {
  if (err instanceof GitHubError) {
    return {
      kind: err.kind,
      repo,
      message: err.message,
      rateLimit: err.rateLimit,
      retryAfterMs: err.retryAfterMs,
      defaultBranch,
      at: Date.now(),
    };
  }
  if (err instanceof Error && err.message === "nothing-to-build") {
    return { kind: "nothing-to-build", repo, at: Date.now() };
  }
  return { kind: "unexpected", repo, message: err instanceof Error ? err.message : String(err), at: Date.now() };
}

/** Turn a snapshot into a model and layout, then hand them to the world. */
async function buildCity(snapshot: RepoSnapshot, signal: AbortSignal, fromCache: boolean, analysis?: WorkspaceAnalysis) {
  useCity.setState({ stage: "analysis" });
  await nextFrame();
  if (signal.aborted) return;
  const model = buildRepoModel(snapshot);
  if (model.files.length === 0) throw new Error("nothing-to-build");

  useCity.setState({ stage: "layout", model });
  await nextFrame();
  if (signal.aborted) return;
  const layout = buildCityLayout(model);

  useCity.setState((s) => ({
    phase: "city",
    stage: "assembling",
    model,
    layout,
    fromCache,
    cityKey: s.cityKey + 1,
    // A local analysis arrives complete from the server; GitHub cities analyse in the browser.
    ...(analysis ? { analysis, trace: { status: "done" as const, graph: toDependencyGraph(analysis.index) } } : {}),
  }));
  if (!analysis) void startAnalysis(model, snapshot, signal);
}

/**
 * Read a bounded set of source files from GitHub and run the shared analysis
 * engine on them in the browser: imports for the city, plus symbols, journeys
 * and the onboarding guide.
 */
async function startAnalysis(model: RepoModel, snapshot: RepoSnapshot, signal: AbortSignal) {
  const plan = planTrace(model);
  if (plan.queue.length === 0) {
    useCity.setState({ trace: { status: "unsupported" } });
    return;
  }
  const { owner, repo } = model.meta;
  let lastUpdate = 0;
  useCity.setState({ trace: { status: "running", done: 0, total: plan.queue.length } });
  try {
    // If the parser can't load, the engine falls back to import-only extraction.
    await initBrowserParsers();
    const analysis = await analyzeModel(model, snapshot, (path, s) => fetchRawFile(owner, repo, model.ref, path, s), {
      signal,
      cap: TRACE_FILE_CAP,
      maxFileBytes: TRACE_MAX_BYTES,
      onProgress: ({ done, total }) => {
        const now = performance.now();
        if (done === total || now - lastUpdate > 120) {
          lastUpdate = now;
          if (!signal.aborted) useCity.setState({ trace: { status: "running", done, total } });
        }
      },
    });
    if (!signal.aborted) useCity.setState({ trace: { status: "done", graph: toDependencyGraph(analysis.index) }, analysis });
  } catch (err) {
    if (signal.aborted || isAbortError(err)) return;
    useCity.setState({ trace: { status: "error", message: err instanceof Error ? err.message : "Tracing failed" } });
  }
}

function begin(repo: RepoRef): AbortSignal {
  controller?.abort();
  controller = new AbortController();
  useCity.setState({
    ...resetCityState(),
    phase: "loading",
    repo,
    stage: "metadata",
    bytesReceived: 0,
    error: null,
    inputError: null,
    model: null,
    layout: null,
    fromCache: false,
  });
  return controller.signal;
}

export async function loadRepo(ref: RepoRef, history: HistoryMode = "push") {
  // Read before the URL changes below.
  const simulate = simulationMode();
  const signal = begin(ref);
  updateHistory(repoPath(ref), history);
  let meta: RepoMeta | undefined;
  try {
    await maybeSimulate(simulate, signal);
    const key = cacheKey(ref);
    const cached = sessionCache.get(key);
    if (cached) {
      useCity.setState({ stage: "tree", bytesReceived: 0 });
      await buildCity({ ...cached, source: cached.source === "live" ? "session-cache" : cached.source }, signal, true);
      return;
    }
    meta = await fetchRepoMeta(ref, signal);
    useCity.setState({ stage: "tree" });
    const treeRef = ref.ref ?? meta.defaultBranch;
    const tree = await fetchTree({ ...ref, ref: treeRef }, signal, (bytes) => {
      if (!signal.aborted) useCity.setState({ bytesReceived: bytes });
    });
    const snapshot: RepoSnapshot = {
      meta,
      ref: treeRef,
      entries: tree.entries,
      truncated: tree.truncated,
      fetchedAt: Date.now(),
      source: "live",
    };
    remember(key, snapshot);
    await buildCity(snapshot, signal, false);
  } catch (err) {
    if (signal.aborted || isAbortError(err)) return;
    useCity.setState({ phase: "error", error: toCityError(err, ref, meta?.defaultBranch) });
  }
}

interface BundledFile {
  capturedAt: string;
  ref: string;
  truncated: boolean;
  meta: RepoMeta;
  entries: ([string, "blob", number] | [string, "tree" | "commit"])[];
}

/** The dated sample snapshot that ships with the app, for when GitHub is unreachable or rate-limited. */
export async function loadBundledSnapshot(history: HistoryMode = "push") {
  const repo = { owner: BUNDLED_SAMPLE.owner, repo: BUNDLED_SAMPLE.repo };
  const signal = begin(repo);
  updateHistory(repoPath(repo), history);
  try {
    useCity.setState({ stage: "tree" });
    const res = await fetch(BUNDLED_SAMPLE.file, { signal });
    if (!res.ok) throw new GitHubError("unexpected", "The bundled snapshot is missing");
    const data = (await res.json()) as BundledFile;
    const entries: TreeEntry[] = data.entries.map((e) =>
      e[1] === "blob" ? { path: e[0], type: "blob", size: e[2] } : { path: e[0], type: e[1] },
    );
    await buildCity(
      {
        meta: data.meta,
        ref: data.ref,
        entries,
        truncated: data.truncated,
        fetchedAt: Date.parse(data.capturedAt),
        capturedAt: data.capturedAt,
        source: "bundled-snapshot",
      },
      signal,
      false,
    );
  } catch (err) {
    if (signal.aborted || isAbortError(err)) return;
    useCity.setState({ phase: "error", error: { kind: "snapshot-unavailable", repo, at: Date.now() } });
  }
}

/**
 * The repository on this machine that the local viewer was started for
 * (`codescape view` or open_in_codescape). The server analyses it with the
 * same engine the MCP server uses.
 */
export async function loadLocalWorkspace(history: HistoryMode = "push") {
  const repo = { owner: "local", repo: "workspace" };
  const signal = begin(repo);
  updateHistory(`/local${typeof window !== "undefined" ? window.location.search : ""}`, history);
  try {
    useCity.setState({ stage: "metadata" });
    const res = await fetch("/api/workspace", { signal, cache: "no-store" });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (body as { error?: string } | null)?.error ?? `The local server answered ${res.status}.`;
      useCity.setState({ phase: "error", error: { kind: "local-unavailable", repo, message, at: Date.now() } });
      return;
    }
    if (!isWorkspaceAnalysis(body)) throw new Error("The local server returned an analysis this version of CodeScape can't read.");
    const name = body.snapshot.meta.repo;
    useCity.setState({ repo: { owner: "local", repo: name }, stage: "tree" });
    await buildCity(body.snapshot, signal, false, body);
  } catch (err) {
    if (signal.aborted || isAbortError(err)) return;
    useCity.setState({
      phase: "error",
      error: { kind: "local-unavailable", repo, message: err instanceof Error ? err.message : String(err), at: Date.now() },
    });
  }
}

export function goToLanding(history: HistoryMode = "push") {
  controller?.abort();
  controller = null;
  useCity.setState({
    ...resetCityState(),
    phase: "landing",
    stage: null,
    error: null,
    model: null,
    layout: null,
    repo: null,
  });
  updateHistory("/", history);
}

export function retryCurrent() {
  const { repo, error, model } = useCity.getState();
  if (model?.source === "local" || error?.kind === "local-unavailable") {
    void loadLocalWorkspace("none");
    return;
  }
  if (model?.source === "bundled-snapshot" || error?.kind === "snapshot-unavailable") {
    void loadBundledSnapshot("none");
    return;
  }
  if (repo) void loadRepo(repo, "none");
}

/** Stop any work in flight; used when the app unmounts. */
export function cancelAll() {
  controller?.abort();
  controller = null;
}

export function describeRepo(ref: RepoRef) {
  if (ref.owner === "local") return ref.repo;
  return ref.ref ? `${repoSlug(ref)} @ ${ref.ref}` : repoSlug(ref);
}
