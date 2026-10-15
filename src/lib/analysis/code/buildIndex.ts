/**
 * Build the code index for a repository model: read a bounded, prioritised
 * set of source files, parse them, resolve imports to repository files and
 * resolve call sites to the declarations they bind to.
 *
 * Only relationships that resolve through real bindings are recorded:
 * - an import edge exists when a specifier resolves to a file in the repo;
 * - a call edge exists when the callee is a same-file declaration, an imported
 *   binding that resolves to an exported declaration, `this.x`/`self.x` inside
 *   a class, or `pkg.Func` for a Go package in this module.
 * Nothing is inferred from names that merely look alike.
 *
 * Pure apart from the injected `readText`, so it runs in Node and the browser.
 */
import type { RepoModel } from "../types";
import { dirname, joinPath, resolveJsImport, resolvePythonImport, type ResolveContext } from "../imports/resolve";
import { loadAlias, pythonRoots, withTimeout } from "../imports/trace";
import { isParseable, parseSource, prepareLanguages } from "./parser";
import type { CallSite, CodeEdge, CodeIndex, CodeSymbol, ExternalRef, ImportRecord, ParsedFile } from "./types";

export const INDEX_FILE_CAP = 300;
export const INDEX_MAX_FILE_BYTES = 512 * 1024;
const CONCURRENCY = 8;
const PER_FILE_TIMEOUT_MS = 10_000;
const MAX_REEXPORT_DEPTH = 6;

export type ReadText = (path: string, signal: AbortSignal) => Promise<string | null>;

export interface IndexProgress {
  done: number;
  total: number;
}

export interface BuildIndexOptions {
  readText: ReadText;
  signal?: AbortSignal;
  /** Maximum number of files to parse. */
  cap?: number;
  /** Stop queueing files once this many bytes are planned. */
  byteBudget?: number;
  maxFileBytes?: number;
  /** Files whose contents must not be read (e.g. likely secrets). */
  isWithheld?: (path: string) => boolean;
  /** Reuse earlier parse results; the key should change when the file changes. */
  cache?: { get(path: string): ParsedFile | undefined; set(path: string, parsed: ParsedFile): void };
  onProgress?: (p: IndexProgress) => void;
  /** Stop reading new files after this long; what was parsed is kept. */
  timeBudgetMs?: number;
}

const RANK: Record<string, number> = { source: 1, test: 2 };

/** Which files to parse, in priority order: entry points, source by depth, tests, the rest. */
export function planIndex(model: RepoModel, options: Pick<BuildIndexOptions, "cap" | "byteBudget" | "maxFileBytes" | "isWithheld"> = {}) {
  const cap = options.cap ?? INDEX_FILE_CAP;
  const maxBytes = options.maxFileBytes ?? INDEX_MAX_FILE_BYTES;
  let skippedLarge = 0;
  const withheld: string[] = [];
  const eligible = model.files.filter((f) => {
    if (!isParseable(f.path)) return false;
    if (options.isWithheld?.(f.path)) {
      withheld.push(f.path);
      return false;
    }
    if (f.size > maxBytes) {
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
  const queue: string[] = [];
  let bytes = 0;
  for (const f of ordered) {
    if (queue.length >= cap) break;
    if (options.byteBudget && bytes + f.size > options.byteBudget) continue;
    bytes += f.size;
    queue.push(f.path);
  }
  return { eligible: eligible.length + skippedLarge, skippedLarge, withheld, queue };
}

interface GoModule {
  dir: string;
  module: string;
}

async function loadGoModules(model: RepoModel, readText: ReadText, signal: AbortSignal): Promise<GoModule[]> {
  const out: GoModule[] = [];
  for (const f of model.files) {
    if (f.name !== "go.mod") continue;
    const text = await readText(f.path, signal).catch(() => null);
    const m = text ? /^\s*module\s+(\S+)/m.exec(text) : null;
    if (m) out.push({ dir: f.dirPath, module: m[1].replace(/^"|"$/g, "") });
  }
  // Longest module path first, so nested modules win.
  return out.sort((a, b) => b.module.length - a.module.length);
}

function resolveGoImport(spec: string, modules: GoModule[], model: RepoModel): string[] {
  for (const m of modules) {
    if (spec !== m.module && !spec.startsWith(`${m.module}/`)) continue;
    const rel = joinPath(m.dir, spec.slice(m.module.length));
    if (rel === null) return [];
    const dir = model.dirsByPath.get(rel);
    if (!dir) return [];
    return dir.files.filter((f) => f.name.endsWith(".go") && !f.name.endsWith("_test.go")).map((f) => f.path);
  }
  return [];
}

export async function buildCodeIndex(model: RepoModel, options: BuildIndexOptions): Promise<CodeIndex> {
  const signal = options.signal ?? new AbortController().signal;
  const started = Date.now();
  const plan = planIndex(model, options);
  const { readText, cache, onProgress } = options;

  const needsAlias = plan.queue.some((p) => /\.(m|c)?(t|j)sx?$/.test(p) || /\.(vue|svelte|astro)$/.test(p));
  const alias = needsAlias ? await loadAlias(model, readText, signal) : undefined;
  const goModules = plan.queue.some((p) => p.endsWith(".go")) ? await loadGoModules(model, readText, signal) : [];
  const ctx: ResolveContext = { files: new Set(model.filesByPath.keys()), alias, pythonRoots: pythonRoots(model) };
  await prepareLanguages(plan.queue);

  const parsed = new Map<string, ParsedFile>();
  const failed: string[] = [];
  let timedOut = false;
  let done = 0;
  let cursor = 0;
  onProgress?.({ done, total: plan.queue.length });

  const worker = async () => {
    while (cursor < plan.queue.length) {
      if (signal.aborted) return;
      if (options.timeBudgetMs && Date.now() - started > options.timeBudgetMs) {
        timedOut = true;
        return;
      }
      const path = plan.queue[cursor++];
      const cached = cache?.get(path);
      if (cached) {
        parsed.set(path, cached);
      } else {
        const { signal: fileSignal, dispose } = withTimeout(signal, PER_FILE_TIMEOUT_MS);
        try {
          const text = await readText(path, fileSignal);
          if (text === null) failed.push(path);
          else {
            const result = parseSource(path, text);
            parsed.set(path, result);
            cache?.set(path, result);
          }
        } catch {
          if (signal.aborted) return;
          failed.push(path);
        } finally {
          dispose();
        }
      }
      done++;
      onProgress?.({ done, total: plan.queue.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plan.queue.length) }, worker));
  if (signal.aborted) throw new DOMException("Indexing cancelled", "AbortError");

  // ---- resolve imports --------------------------------------------------------
  const files: Record<string, ParsedFile> = {};
  for (const path of [...parsed.keys()].sort()) {
    const p = parsed.get(path)!;
    const imports: ImportRecord[] = p.imports.map((rec) => {
      let targets: string[] = [];
      if (p.language === "python" && rec.python) targets = resolvePythonImport(path, rec.python, ctx);
      else if (p.language === "go") targets = resolveGoImport(rec.specifier, goModules, model);
      else {
        const hit = resolveJsImport(path, rec.specifier, ctx);
        if (hit && hit !== path) targets = [hit];
      }
      return { ...rec, targets };
    });
    files[path] = { ...p, imports };
  }

  const resolver = new SymbolResolver(files, model);
  const external: ExternalRef[] = [];
  const importEdgeMap = new Map<string, CodeEdge>();
  const callEdgeMap = new Map<string, CodeEdge>();

  const addEdge = (map: Map<string, CodeEdge>, edge: Omit<CodeEdge, "lines">, line: number, typeOnly?: boolean) => {
    const key = `${edge.kind}\u0000${edge.from}\u0000${edge.to}`;
    const existing = map.get(key);
    if (existing) {
      if (!existing.lines.includes(line)) existing.lines.push(line);
      if (existing.typeOnly && !typeOnly) existing.typeOnly = false;
    } else map.set(key, { ...edge, lines: [line], ...(typeOnly !== undefined ? { typeOnly } : {}) });
  };

  for (const file of Object.values(files)) {
    // Go import edges are added below, only to the files a package reference actually uses.
    if (file.language !== "go") {
      for (const rec of file.imports) {
        for (const to of rec.targets ?? []) {
          addEdge(importEdgeMap, { kind: "import", from: file.path, to, fromPath: file.path, toPath: to, basis: "static-analysis" }, rec.line, rec.typeOnly);
        }
        if ((rec.targets ?? []).length === 0 && isPackageSpecifier(rec, file)) {
          external.push({ path: file.path, line: rec.line, module: rec.specifier });
        }
      }
    }

    for (const call of file.calls) {
      const result = resolver.resolveCall(file, call);
      if (!result) continue;
      if (result.kind === "external") {
        external.push({ path: file.path, line: call.line, module: result.module, callee: call.callee, ...(call.enclosing ? { enclosing: call.enclosing } : {}) });
        continue;
      }
      const target = result.symbol;
      const from = call.enclosing ?? file.path;
      if (target.id === from) continue;
      addEdge(callEdgeMap, { kind: "call", from, to: target.id, fromPath: file.path, toPath: target.path, basis: "static-analysis" }, call.line);
      if (file.language === "go" && target.path !== file.path && result.viaImport) {
        addEdge(importEdgeMap, { kind: "import", from: file.path, to: target.path, fromPath: file.path, toPath: target.path, basis: "static-analysis" }, result.viaImport.line, false);
      }
    }
  }

  const sortEdges = (edges: CodeEdge[]) =>
    edges
      .map((e) => ({ ...e, lines: [...e.lines].sort((a, b) => a - b) }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));

  return {
    files,
    importEdges: sortEdges([...importEdgeMap.values()]),
    callEdges: sortEdges([...callEdgeMap.values()]),
    external,
    limits: {
      eligible: plan.eligible,
      parsed: parsed.size,
      skipped: plan.eligible - plan.skippedLarge - parsed.size - failed.length,
      skippedLarge: plan.skippedLarge,
      failed: failed.sort(),
      withheld: plan.withheld.sort(),
      fallback: [...parsed.values()].filter((p) => p.parser === "regex").length,
      cap: options.cap ?? INDEX_FILE_CAP,
      aliasSource: alias?.source ?? null,
      timedOut,
    },
  };
}

function isPackageSpecifier(rec: ImportRecord, file: ParsedFile): boolean {
  if (file.language === "python") return (rec.python?.level ?? 0) === 0;
  return !rec.specifier.startsWith(".") && !rec.specifier.startsWith("/");
}

export type CallResolution =
  | { kind: "symbol"; symbol: CodeSymbol; viaImport?: ImportRecord }
  | { kind: "external"; module: string };

/** Looks up declarations across parsed files, following re-exports a bounded number of hops. */
export class SymbolResolver {
  private byFile = new Map<string, Map<string, CodeSymbol>>();

  constructor(
    private files: Record<string, ParsedFile>,
    private model: RepoModel,
  ) {
    for (const f of Object.values(files)) {
      const m = new Map<string, CodeSymbol>();
      for (const s of f.symbols) if (!m.has(s.qualifiedName)) m.set(s.qualifiedName, s);
      this.byFile.set(f.path, m);
    }
  }

  private declared(path: string, qualifiedName: string): CodeSymbol | undefined {
    return this.byFile.get(path)?.get(qualifiedName);
  }

  /** The declaration that `name` refers to when imported from `path`. */
  resolveExport(path: string, name: string, depth = 0): CodeSymbol | undefined {
    if (depth > MAX_REEXPORT_DEPTH) return undefined;
    const file = this.files[path];
    if (!file) return undefined;

    if (file.language === "python" || file.language === "go") {
      const direct = this.declared(path, name);
      if (direct) return direct;
      // Python packages often re-export from submodules in __init__.py.
      for (const rec of file.imports) {
        const b = rec.bindings.find((x) => x.local === name);
        if (b && b.imported !== "*") for (const t of rec.targets ?? []) {
          const hit = this.resolveExport(t, b.imported, depth + 1);
          if (hit) return hit;
        }
      }
      return undefined;
    }

    const local = file.exports[name];
    if (local !== undefined) {
      const own = this.declared(path, local);
      if (own) return own;
      // Exporting an imported binding: `import { a } from "./x"; export { a }`.
      const found = this.followBinding(file, local, depth);
      if (found) return found;
    }
    for (const rec of file.imports) {
      if (rec.kind !== "reexport") continue;
      for (const b of rec.bindings) {
        if (b.local === name && b.imported !== "*") {
          for (const t of rec.targets ?? []) {
            const hit = this.resolveExport(t, b.imported, depth + 1);
            if (hit) return hit;
          }
        }
        if (b.local === "*" && name !== "default") {
          for (const t of rec.targets ?? []) {
            const hit = this.resolveExport(t, name, depth + 1);
            if (hit) return hit;
          }
        }
      }
    }
    return undefined;
  }

  private followBinding(file: ParsedFile, local: string, depth: number): CodeSymbol | undefined {
    for (const rec of file.imports) {
      const b = rec.bindings.find((x) => x.local === local);
      if (!b || b.imported === "*") continue;
      for (const t of rec.targets ?? []) {
        const hit = this.resolveExport(t, b.imported, depth + 1);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  /** Find the import record and binding that introduces `local` in `file`. */
  private binding(file: ParsedFile, local: string) {
    for (const rec of file.imports) {
      if (rec.kind === "reexport") continue;
      const b = rec.bindings.find((x) => x.local === local);
      if (b) return { rec, b };
    }
    return undefined;
  }

  /** Python: `from pkg import mod` binds a module when the target file *is* that module. */
  private isModuleBinding(rec: ImportRecord, imported: string, target: string): boolean {
    if (imported === "*") return true;
    return target.endsWith(`/${imported}.py`) || target.endsWith(`/${imported}/__init__.py`) || target === `${imported}.py`;
  }

  /**
   * The package a name ultimately comes from, when it is a package import or a
   * variable holding an instance of a package class (directly or via an import).
   */
  private externalModuleOf(file: ParsedFile, name: string, depth = 0): string | undefined {
    if (depth > 3 || name === "this" || name === "self") return undefined;
    const own = this.declared(file.path, name);
    if (own?.instanceOf) return this.externalModuleOf(file, own.instanceOf, depth + 1);
    const bound = this.binding(file, name);
    if (!bound) return undefined;
    const targets = bound.rec.targets ?? [];
    if (targets.length === 0) return isPackageSpecifier(bound.rec, file) ? bound.rec.specifier : undefined;
    for (const t of targets) {
      const value = this.resolveExport(t, bound.b.imported === "*" ? "default" : bound.b.imported);
      if (value?.instanceOf && this.files[value.path]) {
        const hit = this.externalModuleOf(this.files[value.path], value.instanceOf, depth + 1);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  private methodOf(path: string, className: string, method: string): CodeSymbol | undefined {
    return this.declared(path, `${className}.${method}`);
  }

  private goSamePackage(file: ParsedFile, name: string): CodeSymbol | undefined {
    const dir = this.model.dirsByPath.get(dirname(file.path));
    for (const f of dir?.files ?? []) {
      if (f.path === file.path || !f.name.endsWith(".go")) continue;
      const other = this.files[f.path];
      if (other?.goPackage && other.goPackage === file.goPackage) {
        const hit = this.declared(f.path, name);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  resolveCall(file: ParsedFile, call: CallSite): CallResolution | undefined {
    const callee = call.callee.startsWith("new:") ? call.callee.slice(4) : call.callee;
    const parts = callee.split(".");

    if (parts.length === 1) {
      const name = parts[0];
      const own = this.declared(file.path, name);
      if (own && (own.kind === "function" || own.kind === "class" || own.kind === "variable")) return { kind: "symbol", symbol: own };
      const bound = this.binding(file, name);
      if (bound) {
        const targets = bound.rec.targets ?? [];
        if (targets.length === 0) return isPackageSpecifier(bound.rec, file) ? { kind: "external", module: bound.rec.specifier } : undefined;
        for (const t of targets) {
          const hit = this.resolveExport(t, bound.b.imported === "*" ? "default" : bound.b.imported);
          if (hit) return { kind: "symbol", symbol: hit, viaImport: bound.rec };
        }
        return undefined;
      }
      if (file.language === "go") {
        const hit = this.goSamePackage(file, name);
        if (hit) return { kind: "symbol", symbol: hit };
      }
      return undefined;
    }

    if (parts.length > 2) {
      // `client.orders.list()`: only the package boundary can be established.
      const pkg = this.externalModuleOf(file, parts[0]);
      return pkg ? { kind: "external", module: pkg } : undefined;
    }
    const [obj, prop] = parts;

    // this.x() / self.x() inside a class method.
    if ((obj === "this" || obj === "self") && call.enclosing) {
      const encl = this.files[file.path]?.symbols.find((s) => s.id === call.enclosing);
      const cls = encl?.kind === "method" ? encl.qualifiedName.split(".")[0] : undefined;
      const hit = cls ? this.methodOf(file.path, cls, prop) : undefined;
      return hit ? { kind: "symbol", symbol: hit } : undefined;
    }

    // A same-file instance: `const svc = new Service(); svc.run()`, where the
    // class is declared here, imported from the repo, or comes from a package.
    const ownVar = this.declared(file.path, obj);
    if (ownVar?.instanceOf) {
      const cls = ownVar.instanceOf;
      if (this.declared(file.path, cls)) {
        const hit = this.methodOf(file.path, cls, prop);
        return hit ? { kind: "symbol", symbol: hit } : undefined;
      }
      const classBinding = this.binding(file, cls);
      if (classBinding) {
        const targets = classBinding.rec.targets ?? [];
        if (targets.length === 0) return isPackageSpecifier(classBinding.rec, file) ? { kind: "external", module: classBinding.rec.specifier } : undefined;
        for (const t of targets) {
          const value = this.resolveExport(t, classBinding.b.imported === "*" ? "default" : classBinding.b.imported);
          const method = value?.kind === "class" ? this.methodOf(value.path, value.name, prop) : undefined;
          if (method) return { kind: "symbol", symbol: method, viaImport: classBinding.rec };
        }
      }
      return undefined;
    }

    const bound = this.binding(file, obj);
    if (!bound) return undefined;
    const targets = bound.rec.targets ?? [];
    if (targets.length === 0) return isPackageSpecifier(bound.rec, file) ? { kind: "external", module: bound.rec.specifier } : undefined;

    for (const t of targets) {
      if (file.language === "go" || this.isModuleBinding(bound.rec, bound.b.imported, t)) {
        // Namespace-style: ns.fn() / pkg.Func() / module.func()
        const hit = this.resolveExport(t, prop);
        if (hit) return { kind: "symbol", symbol: hit, viaImport: bound.rec };
        continue;
      }
      // An imported object: resolve it, then its method if it is an instance or class.
      const value = this.resolveExport(t, bound.b.imported);
      if (!value) continue;
      const className = value.kind === "class" ? value.name : value.instanceOf;
      const method = className ? this.methodOf(value.path, className, prop) : undefined;
      return { kind: "symbol", symbol: method ?? value, viaImport: bound.rec };
    }
    return undefined;
  }
}
