/**
 * Read-only queries over a model + code index, shared by every part of the
 * web UI so they all answer the same question the same way.
 */
import type { RepoModel } from "../types";
import type { Basis, CodeEdge, CodeIndex, CodeSymbol } from "./types";

export interface IndexLookup {
  symbols: Map<string, CodeSymbol>;
  symbolsByFile: Map<string, CodeSymbol[]>;
  importsOut: Map<string, CodeEdge[]>;
  importsIn: Map<string, CodeEdge[]>;
  callsOut: Map<string, CodeEdge[]>;
  callsIn: Map<string, CodeEdge[]>;
}

const cache = new WeakMap<CodeIndex, IndexLookup>();

function push<V>(map: Map<string, V[]>, key: string, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function indexLookup(index: CodeIndex): IndexLookup {
  const hit = cache.get(index);
  if (hit) return hit;
  const l: IndexLookup = { symbols: new Map(), symbolsByFile: new Map(), importsOut: new Map(), importsIn: new Map(), callsOut: new Map(), callsIn: new Map() };
  for (const f of Object.values(index.files)) {
    for (const s of f.symbols) {
      l.symbols.set(s.id, s);
      push(l.symbolsByFile, f.path, s);
    }
  }
  for (const e of index.importEdges) {
    push(l.importsOut, e.from, e);
    push(l.importsIn, e.to, e);
  }
  for (const e of index.callEdges) {
    push(l.callsOut, e.from, e);
    push(l.callsIn, e.to, e);
  }
  cache.set(index, l);
  return l;
}

// ---- symbol search --------------------------------------------------------------

export interface SymbolHit {
  symbol: CodeSymbol;
  score: number;
}

/** Rank symbols by name match. Exact > prefix > substring > camel/snake word match. */
export function searchSymbols(index: CodeIndex, query: string, limit = 20): SymbolHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/[\s_.\-/]+/).filter(Boolean);
  const hits: SymbolHit[] = [];
  for (const s of indexLookup(index).symbols.values()) {
    const name = s.name.toLowerCase();
    const qual = s.qualifiedName.toLowerCase();
    let score = 0;
    if (name === q || qual === q) score = 1000;
    else if (name.startsWith(q)) score = 800 - name.length;
    else if (qual.includes(q)) score = 600 - qual.length;
    else if (words.length > 1 || q.length >= 3) {
      const parts = splitIdentifier(s.qualifiedName);
      const matched = words.filter((w) => parts.some((p) => p.startsWith(w)));
      if (matched.length === words.length) score = 300 + matched.length * 20 - parts.length;
    }
    if (score <= 0) continue;
    if (s.exported) score += 15;
    if (s.kind === "handler") score += 10;
    hits.push({ symbol: s, score });
  }
  return hits.sort((a, b) => b.score - a.score || (a.symbol.id < b.symbol.id ? -1 : 1)).slice(0, limit);
}

export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// ---- dependencies -----------------------------------------------------------------

export interface Relation {
  /** File path or symbol id on the other end. */
  id: string;
  path: string;
  name: string;
  kind: "import" | "call";
  basis: Basis;
  /** Lines in the *source* file of the relationship where it is written. */
  evidence: { path: string; lines: number[] };
  typeOnly?: boolean;
  depth: number;
}

export interface Dependencies {
  target: { kind: "file" | "symbol" | "module"; id: string; path: string };
  upstream: Relation[];
  downstream: Relation[];
  truncated: boolean;
}

const MAX_RELATIONS = 60;

function relationFrom(edge: CodeEdge, otherEnd: "from" | "to", lookup: IndexLookup, depth: number): Relation {
  const id = otherEnd === "to" ? edge.to : edge.from;
  const path = otherEnd === "to" ? edge.toPath : edge.fromPath;
  const sym = lookup.symbols.get(id);
  return {
    id,
    path,
    name: sym ? sym.qualifiedName : path,
    kind: edge.kind,
    basis: edge.basis,
    evidence: { path: edge.fromPath, lines: edge.lines },
    ...(edge.typeOnly ? { typeOnly: true } : {}),
    depth,
  };
}

/**
 * Upstream (what depends on the target) and downstream (what the target
 * depends on), following resolved edges up to `depth` hops.
 */
export function dependenciesOf(model: RepoModel, index: CodeIndex, target: { kind: "file" | "symbol" | "module"; id: string }, depth = 1): Dependencies {
  const lookup = indexLookup(index);
  const maxDepth = Math.max(1, Math.min(depth, 3));
  let truncated = false;

  const startIds = (): string[] => {
    if (target.kind === "symbol") return [target.id];
    if (target.kind === "file") return [target.id];
    const prefix = target.id ? `${target.id}/` : "";
    return model.files.filter((f) => f.path.startsWith(prefix)).map((f) => f.path);
  };
  const inTarget = (path: string) => (target.kind === "module" ? path === target.id || path.startsWith(`${target.id}/`) : false);
  const path = target.kind === "symbol" ? (lookup.symbols.get(target.id)?.path ?? "") : target.id;

  const walk = (dir: "up" | "down"): Relation[] => {
    const out = new Map<string, Relation>();
    let frontier = startIds();
    const seen = new Set(frontier);
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const edges: CodeEdge[] = [];
        if (dir === "down") {
          edges.push(...(lookup.importsOut.get(id) ?? []), ...(lookup.callsOut.get(id) ?? []));
          // A file's calls are recorded per enclosing symbol; include them for file targets.
          if (target.kind !== "symbol" && d === 1) for (const s of lookup.symbolsByFile.get(id) ?? []) edges.push(...(lookup.callsOut.get(s.id) ?? []));
        } else {
          edges.push(...(lookup.importsIn.get(id) ?? []), ...(lookup.callsIn.get(id) ?? []));
          if (target.kind !== "symbol" && d === 1) for (const s of lookup.symbolsByFile.get(id) ?? []) edges.push(...(lookup.callsIn.get(s.id) ?? []));
        }
        for (const e of edges) {
          const other = dir === "down" ? e.to : e.from;
          const otherPath = dir === "down" ? e.toPath : e.fromPath;
          if (inTarget(otherPath) || (target.kind === "file" && otherPath === target.id && e.kind === "call")) continue;
          const key = `${e.kind}:${other}`;
          if (out.has(key)) continue;
          if (out.size >= MAX_RELATIONS) {
            truncated = true;
            break;
          }
          out.set(key, relationFrom(e, dir === "down" ? "to" : "from", lookup, d));
          if (!seen.has(other)) {
            seen.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
    return [...out.values()].sort((a, b) => a.depth - b.depth || (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind === "import" ? -1 : 1));
  };

  return { target: { ...target, path }, upstream: walk("up"), downstream: walk("down"), truncated };
}

// ---- related tests ----------------------------------------------------------------

export interface RelatedTest {
  path: string;
  basis: Basis;
  reason: string;
}

function stem(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/(\.|_|-)(test|spec|e2e)$/i, "")
    .replace(/^test_/i, "")
    .replace(/_test$/i, "")
    .toLowerCase();
}

const FAMILY: Record<string, string> = { ts: "js", tsx: "js", mts: "js", cts: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", py: "py", pyi: "py", go: "go", rb: "rb", java: "jvm", kt: "jvm", rs: "rs" };
function sameFamily(a: string, b: string): boolean {
  const ext = (n: string) => n.slice(n.lastIndexOf(".") + 1).toLowerCase();
  return (FAMILY[ext(a)] ?? ext(a)) === (FAMILY[ext(b)] ?? ext(b));
}

/** Tests that import the file (static analysis), then tests named after it (heuristic). */
export function relatedTests(model: RepoModel, index: CodeIndex, path: string, limit = 8): RelatedTest[] {
  const lookup = indexLookup(index);
  const out = new Map<string, RelatedTest>();
  for (const e of lookup.importsIn.get(path) ?? []) {
    const f = model.filesByPath.get(e.fromPath);
    if (f?.category === "test") out.set(f.path, { path: f.path, basis: "static-analysis", reason: `imports ${path} (line ${e.lines[0]})` });
  }
  const file = model.filesByPath.get(path);
  if (file && file.category !== "test") {
    const s = stem(file.name);
    for (const f of model.files) {
      if (out.size >= limit) break;
      if (f.category !== "test" || out.has(f.path) || s.length < 3) continue;
      if (stem(f.name) === s && sameFamily(f.name, file.name)) out.set(f.path, { path: f.path, basis: "heuristic", reason: `file name matches \`${file.name}\`` });
    }
  }
  return [...out.values()].slice(0, limit);
}

// ---- centrality -------------------------------------------------------------------

export interface FileRank {
  path: string;
  importedBy: number;
  calledFrom: number;
  score: number;
}

/** Files other code depends on most (distinct non-test importers, plus incoming call sites). */
export function centralFiles(model: RepoModel, index: CodeIndex, limit = 12): FileRank[] {
  const importers = new Map<string, Set<string>>();
  for (const e of index.importEdges) {
    if (e.typeOnly) continue;
    if (model.filesByPath.get(e.fromPath)?.category === "test") continue;
    const set = importers.get(e.toPath) ?? new Set();
    set.add(e.fromPath);
    importers.set(e.toPath, set);
  }
  const callers = new Map<string, number>();
  for (const e of index.callEdges) if (e.fromPath !== e.toPath) callers.set(e.toPath, (callers.get(e.toPath) ?? 0) + 1);
  const ranks: FileRank[] = [];
  for (const [path, set] of importers) {
    const f = model.filesByPath.get(path);
    if (!f || f.category === "test" || f.category === "config") continue;
    const calledFrom = callers.get(path) ?? 0;
    ranks.push({ path, importedBy: set.size, calledFrom, score: set.size * 2 + Math.min(calledFrom, 20) });
  }
  return ranks.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1)).slice(0, limit);
}
