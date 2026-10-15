import type { RepoModel } from "../types";
import { importLanguageFor } from "./extract";
import { buildCodeIndex } from "../code/buildIndex";
import { toDependencyGraph } from "../workspace";
import { aliasFromTsconfig, dirname, joinPath, parseJsonc, type AliasConfig } from "./resolve";

export const TRACE_FILE_CAP = 300;
export const TRACE_MAX_BYTES = 300 * 1024;

export interface DependencyEdge {
  from: string;
  to: string;
}

export interface DependencyGraph {
  edges: DependencyEdge[];
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
  /** Files whose source was read and parsed. */
  traced: Set<string>;
  /** Files we tried to read but couldn't. */
  failed: Set<string>;
  /** Files in a traceable language (JS/TS/Python). */
  eligible: number;
  /** Eligible files skipped for being larger than TRACE_MAX_BYTES. */
  skippedLarge: number;
  cap: number;
  /** tsconfig/jsconfig the aliases came from, if any. */
  aliasSource: string | null;
}

export interface TraceProgress {
  done: number;
  total: number;
}

export type FetchText = (path: string, signal: AbortSignal) => Promise<string | null>;

export interface TraceOptions {
  signal: AbortSignal;
  fetchText: FetchText;
  onProgress?: (p: TraceProgress) => void;
  cap?: number;
}

export function withTimeout(parent: AbortSignal, ms: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onAbort);
    },
  };
}

const RANK = { source: 1, test: 2 } as Record<string, number>;

/** Which files to read, in priority order: entry points, then source by depth, then tests. */
export function planTrace(model: RepoModel, cap = TRACE_FILE_CAP) {
  let skippedLarge = 0;
  const eligible = model.files.filter((f) => {
    if (!importLanguageFor(f.path)) return false;
    if (f.size > TRACE_MAX_BYTES) {
      skippedLarge++;
      return false;
    }
    return true;
  });
  const ordered = [...eligible].sort((a, b) => {
    const ra = a.landmark === "entry" ? 0 : (RANK[a.category] ?? 3);
    const rb = b.landmark === "entry" ? 0 : (RANK[b.category] ?? 3);
    if (ra !== rb) return ra - rb;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.path < b.path ? -1 : 1;
  });
  return { eligible: eligible.length, skippedLarge, queue: ordered.slice(0, cap).map((f) => f.path) };
}

export async function loadAlias(model: RepoModel, fetchText: FetchText, signal: AbortSignal): Promise<AliasConfig | undefined> {
  const candidates = ["tsconfig.json", "jsconfig.json"].filter((p) => model.filesByPath.has(p));
  for (const path of candidates) {
    try {
      const text = await fetchText(path, signal);
      if (!text) continue;
      const json = parseJsonc(text) as { extends?: unknown };
      let inherited: AliasConfig | undefined;
      // Follow one level of a relative `extends`, e.g. tsconfig.base.json.
      if (typeof json.extends === "string" && json.extends.startsWith(".")) {
        let basePath = joinPath(dirname(path), json.extends);
        if (basePath && !basePath.endsWith(".json")) basePath += ".json";
        if (basePath && model.filesByPath.has(basePath)) {
          const baseText = await fetchText(basePath, signal);
          if (baseText) inherited = aliasFromTsconfig(basePath, parseJsonc(baseText));
        }
      }
      const alias = aliasFromTsconfig(path, json, inherited);
      if (alias) return alias;
    } catch (err) {
      if (signal.aborted) throw err;
      // An unparseable config just means no aliases.
    }
  }
  return undefined;
}

export function pythonRoots(model: RepoModel): string[] {
  const roots = new Set<string>(["", "src", "lib"]);
  for (const dir of model.dirsByPath.values()) {
    if (dir.isPackage) {
      roots.add(dir.path);
      roots.add(`${dir.path}/src`);
    }
  }
  return [...roots];
}

/**
 * Read a bounded set of source files and record imports that resolve to files
 * in the repository. Only resolved, in-repo edges are recorded. Nothing is guessed.
 * A thin adapter over the code index, kept for the file-level graph shape.
 */
export async function traceImports(model: RepoModel, options: TraceOptions): Promise<DependencyGraph> {
  const index = await buildCodeIndex(model, {
    readText: options.fetchText,
    signal: options.signal,
    cap: options.cap ?? TRACE_FILE_CAP,
    maxFileBytes: TRACE_MAX_BYTES,
    onProgress: options.onProgress,
  });
  return toDependencyGraph(index);
}
