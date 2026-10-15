/**
 * Code journeys: ordered walks through resolved call edges, starting from a
 * place where execution enters the code (an HTTP route handler, a program's
 * main block, a CLI entry) or from any symbol the user picks.
 *
 * The order is depth-first in source order: it shows which code a step can
 * call, not what happens at runtime. Places where the trail goes cold are
 * reported as gaps instead of being filled in.
 */
import type { RepoModel } from "../types";
import { SymbolResolver } from "./buildIndex";
import { isNonProductPath } from "./overview";
import type { CallSite, CodeEdge, CodeIndex, CodeLanguage, CodeSymbol, ExternalRef, LineRange } from "./types";

export const MAX_JOURNEY_DEPTH = 6;
export const MAX_JOURNEY_STEPS = 30;
const MAX_EXTERNAL_PER_STEP = 3;
const MAX_GAPS_PER_STEP = 2;

export interface JourneyStep {
  index: number;
  depth: number;
  kind: "entry" | "call" | "external";
  /** Symbol id, or a file path when the step is module-level code. */
  id: string;
  name: string;
  path: string;
  range?: LineRange;
  /** Where the previous step calls this one. */
  via?: { path: string; line: number };
  /** For external steps: the package or module being called into. */
  module?: string;
}

export interface JourneyGap {
  /** Index of the step where the trail could not be followed. */
  atStep: number;
  reason: string;
  path: string;
  line: number;
}

export type JourneyKind = "http" | "main" | "cli" | "symbol";

export interface Journey {
  id: string;
  title: string;
  kind: JourneyKind;
  start: { path: string; line: number; label: string };
  steps: JourneyStep[];
  gaps: JourneyGap[];
  truncated: boolean;
  basis: "static-analysis";
}

export interface JourneyStart {
  kind: JourneyKind;
  title: string;
  label: string;
  /** Symbol id or file path (module scope). */
  id: string;
  path: string;
  line: number;
  /** When the start is known but its handler couldn't be resolved. */
  unresolved?: string;
}

function hash4(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).slice(0, 5);
}

export function journeyId(kind: JourneyKind, title: string, startId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${kind}-${slug}-${hash4(startId)}`;
}

const MAIN_LABEL: Partial<Record<CodeLanguage, string>> = {
  python: "__main__ block",
  go: "func main",
  rust: "fn main",
  java: "static void main",
};

/** Where execution can enter the code, as far as static analysis can tell. */
export function findJourneyStarts(model: RepoModel, index: CodeIndex): JourneyStart[] {
  const resolver = new SymbolResolver(index.files, model, index.rustCrates);
  const starts: JourneyStart[] = [];
  for (const file of Object.values(index.files)) {
    // Examples, fixtures and tests have their own entry points; they aren't the product's.
    if (isNonProductPath(file.path) || model.filesByPath.get(file.path)?.category === "test") continue;
    for (const r of file.routes) {
      const title = r.method === "PAGE" ? `Page ${r.route}` : `${r.method} ${r.route}`;
      if (r.handler) {
        starts.push({ kind: "http", title, label: r.method === "PAGE" ? "Next.js page" : `${r.framework} route`, id: r.handler, path: file.path, line: r.line });
        continue;
      }
      const resolved = r.handlerRef ? resolver.resolveCall(file, { callee: r.handlerRef, line: r.line }) : undefined;
      if (resolved?.kind === "symbol") {
        starts.push({ kind: "http", title, label: `${r.framework} route`, id: resolved.symbol.id, path: file.path, line: r.line });
      } else {
        starts.push({
          kind: "http",
          title,
          label: `${r.framework} route`,
          id: file.path,
          path: file.path,
          line: r.line,
          unresolved: r.handlerRef ? `Handler \`${r.handlerRef}\` could not be resolved to a declaration` : "Handler is not a named or inline function",
        });
      }
    }
    if (file.mainAt) {
      // Python's guard is module scope; elsewhere `main` is a declaration.
      const mainSym = file.language === "python" ? undefined : file.symbols.find((s) => s.name === "main" && s.range.startLine === file.mainAt);
      starts.push({
        kind: "main",
        title: `Run ${file.path}`,
        label: MAIN_LABEL[file.language] ?? "main",
        id: mainSym?.id ?? file.path,
        path: file.path,
        line: file.mainAt,
      });
    }
  }
  return starts.sort((a, b) => (a.kind === b.kind ? (a.title < b.title ? -1 : 1) : a.kind === "http" ? -1 : 1));
}

interface Lookup {
  symbols: Map<string, CodeSymbol>;
  outgoing: Map<string, CodeEdge[]>;
  /** Keyed by enclosing symbol id, or file path for module scope. */
  externals: Map<string, ExternalRef[]>;
  calls: Map<string, { path: string; call: CallSite }[]>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function lookup(index: CodeIndex): Lookup {
  const symbols = new Map<string, CodeSymbol>();
  for (const f of Object.values(index.files)) for (const s of f.symbols) symbols.set(s.id, s);
  const outgoing = new Map<string, CodeEdge[]>();
  for (const e of index.callEdges) {
    const list = outgoing.get(e.from) ?? [];
    list.push(e);
    outgoing.set(e.from, list);
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.lines[0] - b.lines[0]);
  const externals = new Map<string, ExternalRef[]>();
  for (const x of index.external) if (x.callee) push(externals, x.enclosing ?? x.path, x);
  const calls = new Map<string, { path: string; call: CallSite }[]>();
  for (const f of Object.values(index.files)) for (const call of f.calls) push(calls, call.enclosing ?? f.path, { path: f.path, call });
  return { symbols, outgoing, externals, calls };
}

const lookupCache = new WeakMap<CodeIndex, Lookup>();
function cachedLookup(index: CodeIndex): Lookup {
  let l = lookupCache.get(index);
  if (!l) {
    l = lookup(index);
    lookupCache.set(index, l);
  }
  return l;
}

/** Walk outgoing call edges from `startId` (a symbol id or a file path for module scope). */
export function traceFrom(index: CodeIndex, start: JourneyStart): Journey {
  const { symbols, outgoing, externals: externalsBy, calls: callsBy } = cachedLookup(index);
  const steps: JourneyStep[] = [];
  const gaps: JourneyGap[] = [];
  const visited = new Set<string>();
  let truncated = false;

  const stepFor = (id: string): Pick<JourneyStep, "id" | "name" | "path" | "range"> => {
    const sym = symbols.get(id);
    if (sym) return { id, name: sym.qualifiedName, path: sym.path, range: sym.range };
    return { id, name: id.slice(id.lastIndexOf("/") + 1), path: id };
  };

  // Same-file helpers are only shown when they lead somewhere else; otherwise the
  // journey drowns in small utility calls.
  const leadsElsewhere = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id) || seen.size > 20) return false;
    seen.add(id);
    return (outgoing.get(id) ?? []).some((e) => e.toPath !== e.fromPath || leadsElsewhere(e.to, seen));
  };

  const visit = (id: string, depth: number) => {
    const current = steps.length - 1;

    for (const edge of outgoing.get(id) ?? []) {
      if (visited.has(edge.to)) continue;
      if (edge.toPath === edge.fromPath && !leadsElsewhere(edge.to)) continue;
      if (steps.length >= MAX_JOURNEY_STEPS) {
        truncated = true;
        return;
      }
      visited.add(edge.to);
      steps.push({ index: steps.length, depth: depth + 1, kind: "call", ...stepFor(edge.to), via: { path: edge.fromPath, line: edge.lines[0] } });
      // A call through an interface or trait reaches the declaration only.
      const target = symbols.get(edge.to);
      const owner = target?.kind === "method" ? symbols.get(`${target.path}#${target.qualifiedName.slice(0, target.qualifiedName.lastIndexOf("."))}`) : undefined;
      if (owner?.kind === "interface") {
        gaps.push({ atStep: steps.length - 1, reason: `\`${target!.qualifiedName}\` is declared on an interface; the implementation is chosen at runtime and isn't followed`, path: edge.fromPath, line: edge.lines[0] });
      }
      if (depth + 1 < MAX_JOURNEY_DEPTH) visit(edge.to, depth + 1);
      else if (outgoing.get(edge.to)?.some((e) => !visited.has(e.to))) truncated = true;
    }

    // Calls that leave the repository (packages, standard library).
    const externals = externalsBy.get(id) ?? [];
    const seen = new Set<string>();
    for (const x of externals) {
      const key = `${x.module}:${x.callee}`;
      if (seen.has(key) || seen.size >= MAX_EXTERNAL_PER_STEP || steps.length >= MAX_JOURNEY_STEPS) continue;
      seen.add(key);
      steps.push({ index: steps.length, depth: depth + 1, kind: "external", id: `external:${key}`, name: x.callee!, path: x.path, via: { path: x.path, line: x.line }, module: x.module });
    }

    // Calls through object fields can't be followed without types: report them,
    // unless a declared field type (Rust, Java) already let them resolve.
    const resolvedLines = new Set([...(outgoing.get(id) ?? []).flatMap((e) => e.lines), ...externals.map((x) => x.line)]);
    let reported = 0;
    for (const { path, call } of callsBy.get(id) ?? []) {
      if (reported >= MAX_GAPS_PER_STEP) break;
      if (call.receiverType && resolvedLines.has(call.line)) continue;
      const parts = call.callee.split(".");
      if ((parts[0] === "this" || parts[0] === "self") && parts.length >= 3) {
        gaps.push({ atStep: current, reason: `\`${call.callee}()\` goes through an object field; its target depends on runtime wiring and isn't followed`, path, line: call.line });
        reported++;
      }
    }
  };

  const first = stepFor(start.id);
  steps.push({ index: 0, depth: 0, kind: "entry", ...first, ...(first.range ? {} : { range: { startLine: start.line, endLine: start.line } }) });
  visited.add(start.id);
  if (start.unresolved) gaps.push({ atStep: 0, reason: start.unresolved, path: start.path, line: start.line });
  else visit(start.id, 0);

  if (truncated) gaps.push({ atStep: steps.length - 1, reason: `Stopped after ${MAX_JOURNEY_STEPS} steps or ${MAX_JOURNEY_DEPTH} levels deep`, path: steps[steps.length - 1].path, line: steps[steps.length - 1].range?.startLine ?? 1 });

  return {
    id: journeyId(start.kind, start.title, start.id),
    title: start.title,
    kind: start.kind,
    start: { path: start.path, line: start.line, label: start.label },
    steps,
    gaps,
    truncated,
    basis: "static-analysis",
  };
}

/** All detected journeys, most informative first, capped. */
export function buildJourneys(model: RepoModel, index: CodeIndex, limit = 40): Journey[] {
  const journeys = findJourneyStarts(model, index).map((s) => traceFrom(index, s));
  const inRepoSteps = (j: Journey) => j.steps.filter((s) => s.kind === "call").length;
  return journeys
    .sort((a, b) => {
      // Prefer journeys that actually go somewhere, then HTTP before main, then by title.
      const sa = Math.min(inRepoSteps(a), 6);
      const sb = Math.min(inRepoSteps(b), 6);
      if (sa !== sb) return sb - sa;
      if (a.kind !== b.kind) return a.kind === "http" ? -1 : b.kind === "http" ? 1 : 0;
      return a.title < b.title ? -1 : 1;
    })
    .slice(0, limit);
}

/** A journey starting from an arbitrary symbol (used by trace_code_path and the UI). */
export function journeyFromSymbol(index: CodeIndex, symbol: CodeSymbol): Journey {
  return traceFrom(index, {
    kind: "symbol",
    title: symbol.qualifiedName,
    label: `${symbol.kind} in ${symbol.path}`,
    id: symbol.id,
    path: symbol.path,
    line: symbol.range.startLine,
  });
}
