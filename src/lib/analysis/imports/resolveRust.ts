/**
 * Rust module resolution: Cargo crates (workspace members included), crate
 * roots (`src/lib.rs`, `src/main.rs`, `src/bin/*.rs`, or `[lib]`/`[[bin]]`
 * paths), and module files (`a.rs` or `a/mod.rs`). `use` and `mod` paths
 * resolve to files only when those files exist; nothing is matched by name
 * similarity.
 */
import type { RepoModel } from "../types";
import { dirname, joinPath } from "./resolve";

export interface RustCrate {
  /** Crate name as used in paths (`my-crate` → `my_crate`). */
  name: string;
  /** Folder holding Cargo.toml ("" for the repository root). */
  dir: string;
  lib?: string;
  bins: string[];
}

export interface RustModulePath {
  file: string;
  /** Remaining path inside that file, joined with "." (`Store.new`), or undefined for the module itself. */
  item?: string;
}

type ReadText = (path: string, signal: AbortSignal) => Promise<string | null>;

/** `[section]` → lines, for the handful of Cargo.toml keys we read. */
function tomlSections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      current = header[1];
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    const lines = out.get(current);
    if (lines) lines.push(line);
    else out.set(current, [line]);
  }
  return out;
}

function tomlString(lines: string[] | undefined, key: string): string | undefined {
  for (const line of lines ?? []) {
    const m = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`).exec(line);
    if (m) return m[1];
  }
  return undefined;
}

export async function loadRustCrates(model: RepoModel, readText: ReadText, signal: AbortSignal): Promise<RustCrate[]> {
  const crates: RustCrate[] = [];
  for (const f of model.files) {
    if (f.name.toLowerCase() !== "cargo.toml") continue;
    const text = await readText(f.path, signal).catch(() => null);
    if (!text) continue;
    const sections = tomlSections(text);
    const name = tomlString(sections.get("package"), "name");
    if (!name) continue; // a virtual workspace manifest
    const at = (rel: string) => joinPath(f.dirPath, rel) ?? undefined;
    const exists = (p: string | undefined) => (p && model.filesByPath.has(p) ? p : undefined);
    const lib = exists(at(tomlString(sections.get("lib"), "path") ?? "src/lib.rs"));
    const bins = new Set<string>();
    const main = exists(at("src/main.rs"));
    if (main) bins.add(main);
    const binPath = exists(at(tomlString(sections.get("bin"), "path") ?? ""));
    if (binPath) bins.add(binPath);
    for (const b of model.dirsByPath.get(at("src/bin") ?? "")?.files ?? []) if (b.name.endsWith(".rs")) bins.add(b.path);
    for (const d of model.dirsByPath.get(at("src/bin") ?? "")?.dirs ?? []) {
      const m = exists(`${d.path}/main.rs`);
      if (m) bins.add(m);
    }
    crates.push({ name: name.replace(/-/g, "_"), dir: f.dirPath, ...(lib ? { lib } : {}), bins: [...bins].sort() });
  }
  // Deepest first, so nested crates win when locating a file's crate.
  return crates.sort((a, b) => b.dir.length - a.dir.length || (a.name < b.name ? -1 : 1));
}

export class RustModules {
  private names: Map<string, RustCrate>;

  constructor(
    readonly crates: RustCrate[],
    private files: ReadonlySet<string>,
  ) {
    this.names = new Map(crates.map((c) => [c.name, c]));
  }

  isLocalCrate(name: string): boolean {
    return this.names.has(name);
  }

  private crateOf(path: string): RustCrate | undefined {
    return this.crates.find((c) => c.dir === "" || path.startsWith(`${c.dir}/`));
  }

  /** The crate root a file belongs to and its module path under that root. */
  private moduleOf(path: string): { root: string; segs: string[] } | undefined {
    const crate = this.crateOf(path);
    if (!crate) return undefined;
    if (path === crate.lib || crate.bins.includes(path)) return { root: path, segs: [] };
    const root = crate.lib ?? crate.bins.find((b) => dirname(b) === joinPath(crate.dir, "src")) ?? crate.bins[0];
    if (!root) return undefined;
    const srcDir = dirname(root);
    if (!path.startsWith(srcDir ? `${srcDir}/` : "")) return undefined;
    const rel = path.slice(srcDir ? srcDir.length + 1 : 0).replace(/\.rs$/, "").replace(/(^|\/)mod$/, "");
    if (rel.startsWith("bin/")) return undefined;
    return { root, segs: rel ? rel.split("/") : [] };
  }

  /** The file of module `segs` under a crate root, if it exists. */
  private moduleFile(root: string, segs: string[]): string | undefined {
    if (segs.length === 0) return root;
    const base = joinPath(dirname(root), segs.join("/"));
    if (base === null) return undefined;
    for (const candidate of [`${base}.rs`, `${base}/mod.rs`]) if (this.files.has(candidate)) return candidate;
    return undefined;
  }

  /**
   * Resolve a path written in `from` (`crate::a::B`, `super::x`, `self::m`,
   * `other_crate::Item`, or a child module) to the deepest module file that
   * exists plus the rest of the path. "external" means the first segment names
   * another crate (a dependency or the standard library).
   */
  resolve(from: string, segs: string[]): RustModulePath | "external" | undefined {
    if (segs.length === 0) return undefined;
    const here = this.moduleOf(from);
    let root: string | undefined;
    let base: string[];
    let rest: string[];
    const [first] = segs;
    if (first === "crate") {
      if (!here) return undefined;
      root = here.root;
      base = [];
      rest = segs.slice(1);
    } else if (first === "self" || first === "super") {
      if (!here) return undefined;
      root = here.root;
      base = [...here.segs];
      let i = 0;
      if (segs[0] === "self") i = 1;
      while (segs[i] === "super") {
        if (base.length === 0) return undefined;
        base.pop();
        i++;
      }
      rest = segs.slice(i);
    } else if (this.names.has(first)) {
      const crate = this.names.get(first)!;
      root = crate.lib;
      if (!root) return undefined;
      base = [];
      rest = segs.slice(1);
    } else if (here && this.moduleFile(here.root, [...here.segs, first])) {
      // A child module named without `self::` (2018 uniform paths).
      root = here.root;
      base = [...here.segs];
      rest = segs;
    } else {
      return "external";
    }
    for (let k = rest.length; k >= 0; k--) {
      const file = this.moduleFile(root, [...base, ...rest.slice(0, k)]);
      if (file) {
        const item = rest.slice(k).join(".");
        return { file, ...(item ? { item } : {}) };
      }
    }
    return undefined;
  }
}
