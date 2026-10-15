/**
 * Build the code index for a repository model: read a bounded, prioritised
 * set of source files, parse them, resolve imports to repository files and
 * resolve call sites to the declarations they bind to.
 *
 * Only relationships that resolve through real bindings are recorded:
 * - an import edge exists when a specifier resolves to a file in the repo;
 * - a call edge exists when the callee is a same-file declaration, an imported
 *   binding that resolves to an exported declaration, `this.x`/`self.x` inside
 *   a class, `pkg.Func` for a Go package in this module, a Rust `use`/`mod`
 *   path or a Java import, or a receiver whose type the source declares
 *   (Rust and Java parameters, locals and fields).
 * Nothing is inferred from names that merely look alike.
 *
 * Pure apart from the injected `readText`, so it runs in Node and the browser.
 */
import type { RepoModel } from "../types";
import { dirname, joinPath, resolveJsImport, resolvePythonImport, type ResolveContext } from "../imports/resolve";
import { javaPackageOf, javaSourceRoots, resolveJavaImport } from "../imports/resolveJava";
import { loadRustCrates, RustModules, type RustCrate } from "../imports/resolveRust";
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
  const rustCrates = plan.queue.some((p) => p.endsWith(".rs")) ? await loadRustCrates(model, readText, signal) : [];
  const ctx: ResolveContext = { files: new Set(model.filesByPath.keys()), alias, pythonRoots: pythonRoots(model) };
  const rustModules = new RustModules(rustCrates, ctx.files);
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
  const javaRoots = javaSourceRoots(parsed.values());
  const files: Record<string, ParsedFile> = {};
  for (const path of [...parsed.keys()].sort()) {
    const p = parsed.get(path)!;
    const imports: ImportRecord[] = p.imports.map((rec) => {
      let targets: string[] = [];
      if (p.language === "python" && rec.python) targets = resolvePythonImport(path, rec.python, ctx);
      else if (p.language === "go") targets = resolveGoImport(rec.specifier, goModules, model);
      else if (p.language === "rust" && rec.rust) {
        const hit = rustModules.resolve(path, rec.rust.path);
        if (!hit || hit === "external" || hit.file === path) return { ...rec, targets };
        // The binding names whatever the path ends at: a module ("*") or an item in that file.
        const imported = rec.rust.glob || rec.rust.isMod || !hit.item ? "*" : hit.item;
        return { ...rec, targets: [hit.file], bindings: rec.bindings.map((b) => ({ ...b, imported })) };
      } else if (p.language === "java" && rec.java) {
        const hit = resolveJavaImport(rec, javaRoots, model);
        targets = hit.files.filter((f) => f !== path);
        if (hit.item && targets.length) return { ...rec, targets, bindings: rec.bindings.map((b) => ({ ...b, imported: hit.item! })) };
      } else {
        const hit = resolveJsImport(path, rec.specifier, ctx);
        if (hit && hit !== path) targets = [hit];
      }
      return { ...rec, targets };
    });
    files[path] = { ...p, imports };
  }

  const resolver = new SymbolResolver(files, model, rustCrates);
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
    // Go packages and Java on-demand imports name whole folders: their import
    // edges are added below, only to the files a reference actually uses.
    if (file.language !== "go") {
      for (const rec of file.imports) {
        if (!rec.java?.wildcard) {
          for (const to of rec.targets ?? []) {
            addEdge(importEdgeMap, { kind: "import", from: file.path, to, fromPath: file.path, toPath: to, basis: "static-analysis" }, rec.line, rec.typeOnly);
          }
        }
        if ((rec.targets ?? []).length === 0 && resolver.isPackage(rec, file)) {
          external.push({ path: file.path, line: rec.line, module: packageName(rec) });
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
      if ((file.language === "go" || result.viaImport?.java?.wildcard) && target.path !== file.path && result.viaImport) {
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
    ...(rustCrates.length ? { rustCrates } : {}),
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

function isPackageSpecifier(rec: ImportRecord, file: ParsedFile, rust?: RustModules): boolean {
  if (file.language === "python") return (rec.python?.level ?? 0) === 0;
  if (file.language === "rust") {
    const first = rec.rust?.path[0];
    return !!first && !rec.rust?.isMod && !["crate", "self", "super"].includes(first) && !rust?.isLocalCrate(first);
  }
  if (file.language === "java") return true;
  return !rec.specifier.startsWith(".") && !rec.specifier.startsWith("/");
}

/** How an unresolved import is named when code leaves the repository: Rust crate, Java package, or the specifier. */
export function packageName(rec: ImportRecord): string {
  if (rec.rust) return rec.rust.path[0];
  if (rec.java) return javaPackageOf(rec);
  return rec.specifier;
}

export type CallResolution =
  | { kind: "symbol"; symbol: CodeSymbol; viaImport?: ImportRecord }
  | { kind: "external"; module: string };

/** Looks up declarations across parsed files, following re-exports a bounded number of hops. */
export class SymbolResolver {
  private byFile = new Map<string, Map<string, CodeSymbol>>();
  private rust: RustModules;

  constructor(
    private files: Record<string, ParsedFile>,
    private model: RepoModel,
    rustCrates: RustCrate[] = [],
  ) {
    for (const f of Object.values(files)) {
      const m = new Map<string, CodeSymbol>();
      for (const s of f.symbols) if (!m.has(s.qualifiedName)) m.set(s.qualifiedName, s);
      this.byFile.set(f.path, m);
    }
    this.rust = new RustModules(rustCrates, new Set(model.filesByPath.keys()));
  }

  /** Whether an import that resolved to no file names a package outside the repository. */
  isPackage(rec: ImportRecord, file: ParsedFile): boolean {
    return isPackageSpecifier(rec, file, this.rust);
  }

  private declared(path: string, qualifiedName: string): CodeSymbol | undefined {
    return this.byFile.get(path)?.get(qualifiedName);
  }

  /** The declaration that `name` refers to when imported from `path`. */
  resolveExport(path: string, name: string, depth = 0): CodeSymbol | undefined {
    if (depth > MAX_REEXPORT_DEPTH) return undefined;
    const file = this.files[path];
    if (!file) return undefined;

    if (file.language === "python" || file.language === "go" || file.language === "rust" || file.language === "java") {
      const direct = this.declared(path, name);
      if (direct) return direct;
      if (file.language === "java") return undefined;
      // Python packages often re-export from submodules in __init__.py; Rust uses `pub use`.
      for (const rec of file.imports) {
        const b = rec.bindings.find((x) => x.local === name || (file.language === "rust" && x.local === "*" && rec.kind === "reexport"));
        if (!b) continue;
        for (const t of rec.targets ?? []) {
          const hit = this.resolveExport(t, b.imported === "*" ? name : b.imported, depth + 1);
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
      // `pub use` binds the name locally too; a JS re-export doesn't.
      if (rec.kind === "reexport" && file.language !== "rust") continue;
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
    if (file.language === "rust") return this.resolveRustCall(file, call);
    if (file.language === "java") return this.resolveJavaCall(file, call);
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

  // ---- Rust ------------------------------------------------------------------

  /** A declaration reached through a module path: `f`, `Type`, or `Type.method`. */
  private rustItem(path: string, item: string): CodeSymbol | undefined {
    const direct = this.resolveExport(path, item);
    if (direct) return direct;
    const dot = item.lastIndexOf(".");
    if (dot < 0) return undefined;
    const owner = this.resolveExport(path, item.slice(0, dot));
    return owner ? this.declared(owner.path, `${owner.qualifiedName}.${item.slice(dot + 1)}`) : undefined;
  }

  /** Resolve a `::` path written in `file`, through its `use`/`mod` bindings or from the crate root. */
  private rustPath(file: ParsedFile, segs: string[]): CallResolution | undefined {
    const [first] = segs;
    let full = segs;
    let via: ImportRecord | undefined;
    if (!["crate", "self", "super"].includes(first) && !this.rust.isLocalCrate(first)) {
      const own = this.declared(file.path, segs.join("."));
      if (own) return { kind: "symbol", symbol: own };
      const bound = this.binding(file, first);
      if (bound && bound.rec.rust) {
        via = bound.rec;
        if ((bound.rec.targets ?? []).length === 0) {
          return this.isPackage(bound.rec, file) ? { kind: "external", module: packageName(bound.rec) } : undefined;
        }
        // Replace the bound name (maybe an alias) with the path it stands for.
        full = [...bound.rec.rust.path, ...segs.slice(1)];
      } else if (!bound) {
        // An item from a glob import: `use crate::store::*; Store::open()`.
        for (const rec of file.imports) {
          if (!rec.rust?.glob) continue;
          for (const t of rec.targets ?? []) {
            const hit = this.rustItem(t, segs.join("."));
            if (hit) return { kind: "symbol", symbol: hit, viaImport: rec };
          }
        }
      }
    }
    const hit = this.rust.resolve(file.path, full);
    if (hit === "external") return /^[a-z_][a-z0-9_]*$/.test(first) ? { kind: "external", module: first } : undefined;
    if (!hit?.item) return undefined;
    const symbol = this.rustItem(hit.file, hit.item);
    return symbol ? { kind: "symbol", symbol, ...(via ? { viaImport: via } : {}) } : undefined;
  }

  /** The declaration a Rust type name refers to in `file`, or the crate it comes from. */
  private rustType(file: ParsedFile, name: string): CallResolution | undefined {
    const segs = name.split("::");
    const own = segs.length === 1 ? this.declared(file.path, name) : undefined;
    if (own) return { kind: "symbol", symbol: own };
    return this.rustPath(file, segs);
  }

  private resolveRustCall(file: ParsedFile, call: CallSite): CallResolution | undefined {
    const { callee } = call;
    const dotParts = callee.split(".");
    const method = dotParts[dotParts.length - 1];

    if (call.receiverType) {
      const type = this.rustType(file, call.receiverType);
      if (type?.kind === "external") return type;
      if (type?.kind !== "symbol") return undefined;
      const hit = this.declared(type.symbol.path, `${type.symbol.qualifiedName}.${method}`);
      return hit ? { kind: "symbol", symbol: hit, ...(type.viaImport ? { viaImport: type.viaImport } : {}) } : undefined;
    }
    if (dotParts[0] === "self" && dotParts.length === 2 && call.enclosing) {
      const encl = file.symbols.find((s) => s.id === call.enclosing);
      const owner = encl?.kind === "method" ? encl.qualifiedName.slice(0, encl.qualifiedName.lastIndexOf(".")) : undefined;
      const hit = owner ? this.declared(file.path, `${owner}.${method}`) : undefined;
      return hit ? { kind: "symbol", symbol: hit } : undefined;
    }
    if (dotParts.length > 1) return undefined; // a method on a value of unknown type

    const segs = callee.split("::");
    if (segs.length === 1) {
      const own = this.declared(file.path, callee);
      if (own && (own.kind === "function" || own.kind === "class")) return { kind: "symbol", symbol: own };
    }
    return this.rustPath(file, segs);
  }

  // ---- Java ------------------------------------------------------------------

  /** The class, interface or enum a Java type name refers to in `file`, or the package it comes from. */
  private javaType(file: ParsedFile, name: string): CallResolution | undefined {
    const isType = (s: CodeSymbol | undefined) => !!s && (s.kind === "class" || s.kind === "interface" || s.kind === "enum");
    // Declared here, possibly nested: `Inner` inside `Outer`.
    const own = this.declared(file.path, name) ?? file.symbols.find((s) => isType(s) && s.qualifiedName.endsWith(`.${name}`));
    if (isType(own)) return { kind: "symbol", symbol: own! };
    const [head, ...rest] = name.split(".");
    if (rest.length && /^[A-Z]/.test(head)) {
      // `Outer.Inner` where `Outer` is resolvable.
      const outer = this.javaType(file, head);
      if (outer?.kind !== "symbol") return outer;
      const inner = this.declared(outer.symbol.path, `${outer.symbol.qualifiedName}.${rest.join(".")}`);
      return isType(inner) ? { kind: "symbol", symbol: inner!, ...(outer.viaImport ? { viaImport: outer.viaImport } : {}) } : undefined;
    }
    const bound = this.binding(file, name);
    if (bound && !bound.rec.java?.wildcard) {
      const targets = bound.rec.targets ?? [];
      if (targets.length === 0) return { kind: "external", module: packageName(bound.rec) };
      for (const t of targets) {
        const hit = this.resolveExport(t, bound.b.imported);
        if (isType(hit)) return { kind: "symbol", symbol: hit!, viaImport: bound.rec };
      }
      return undefined;
    }
    // Same package: classes in this folder that declare the same package.
    for (const f of this.model.dirsByPath.get(dirname(file.path))?.files ?? []) {
      const other = this.files[f.path];
      if (f.path === file.path || other?.language !== "java" || other.javaPackage !== file.javaPackage) continue;
      const hit = this.declared(f.path, name);
      if (isType(hit)) return { kind: "symbol", symbol: hit! };
    }
    for (const rec of file.imports) {
      if (!rec.java?.wildcard || rec.java.static) continue;
      for (const t of rec.targets ?? []) {
        const hit = this.declared(t, name);
        if (isType(hit)) return { kind: "symbol", symbol: hit!, viaImport: rec };
      }
    }
    return undefined;
  }

  /** `Type.method` with overloads told apart by argument count; ambiguous means no edge. */
  private javaMethod(owner: CodeSymbol, method: string, argCount: number | undefined): CodeSymbol | undefined {
    const qualified = `${owner.qualifiedName}.${method}`;
    const candidates = (this.files[owner.path]?.symbols ?? []).filter((s) => s.qualifiedName === qualified && s.kind === "method");
    if (candidates.length <= 1) return candidates[0];
    const matching = candidates.filter((s) => argCount === undefined || s.params === argCount || s.params === -1);
    return matching.length === 1 ? matching[0] : undefined;
  }

  private resolveJavaCall(file: ParsedFile, call: CallSite): CallResolution | undefined {
    const { callee, argCount } = call;
    const typed = (type: CallResolution | undefined, method: string): CallResolution | undefined => {
      if (type?.kind !== "symbol") return type;
      const hit = this.javaMethod(type.symbol, method, argCount);
      return hit ? { kind: "symbol", symbol: hit, ...(type.viaImport ? { viaImport: type.viaImport } : {}) } : undefined;
    };

    if (callee.startsWith("new:")) {
      const type = this.javaType(file, callee.slice(4));
      if (type?.kind !== "symbol") return type;
      return typed(type, type.symbol.name) ?? type;
    }
    const parts = callee.split(".");
    const method = parts[parts.length - 1];
    if (call.receiverType) return typed(this.javaType(file, call.receiverType), method);

    const encl = call.enclosing ? file.symbols.find((s) => s.id === call.enclosing) : undefined;
    const ownerName = encl?.kind === "method" ? encl.qualifiedName.slice(0, encl.qualifiedName.lastIndexOf(".")) : undefined;
    const owner = ownerName ? this.declared(file.path, ownerName) : undefined;

    if (parts.length === 1) {
      // An implicit `this.m()`, in this class or an enclosing one.
      for (let o = owner; o; ) {
        const hit = this.javaMethod(o, method, argCount);
        if (hit) return { kind: "symbol", symbol: hit };
        const dot = o.qualifiedName.lastIndexOf(".");
        o = dot > 0 ? this.declared(file.path, o.qualifiedName.slice(0, dot)) : undefined;
      }
      // A static import: `import static a.B.m;`.
      const bound = this.binding(file, method);
      if (bound?.rec.java?.static) {
        const targets = bound.rec.targets ?? [];
        if (targets.length === 0) return { kind: "external", module: packageName(bound.rec) };
        for (const t of targets) {
          const hit = this.resolveExport(t, bound.b.imported);
          if (hit) return { kind: "symbol", symbol: hit, viaImport: bound.rec };
        }
      }
      return undefined;
    }
    if (parts.length === 2 && parts[0] === "this") return owner ? typed({ kind: "symbol", symbol: owner }, method) : undefined;
    if (parts[0] === "this" || parts[0] === "super") return undefined; // a field of unknown type, or an inherited method
    // `Type.staticMethod()` or `pkg.Type.m()`.
    if (/^[A-Z]/.test(parts[parts.length - 2])) return typed(this.javaType(file, parts.slice(0, -1).join(".")), method);
    return undefined;
  }
}
