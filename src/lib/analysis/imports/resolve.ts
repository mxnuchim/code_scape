import type { PythonImport } from "./extract";

export interface AliasConfig {
  /** Repo-relative folder that `paths` targets and bare specifiers resolve from. */
  baseDir: string;
  /** Whether `baseUrl` was set; only then do bare specifiers resolve from baseDir. */
  hasBaseUrl: boolean;
  paths: { pattern: string; targets: string[] }[];
  /** Which file the aliases came from, for the UI. */
  source: string;
}

export interface ResolveContext {
  files: ReadonlySet<string>;
  alias?: AliasConfig;
  /** Folders to try for absolute Python imports, e.g. "", "src". */
  pythonRoots: string[];
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

/** Join and normalise path segments; returns null if it escapes the repo root. */
export function joinPath(...parts: string[]): string | null {
  const out: string[] = [];
  for (const part of parts) {
    for (const seg of part.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        if (out.length === 0) return null;
        out.pop();
      } else out.push(seg);
    }
  }
  return out.join("/");
}

const JS_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".json"];
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

function tryJsFile(base: string, files: ReadonlySet<string>): string | undefined {
  if (files.has(base)) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > base.lastIndexOf("/") ? base.slice(dot) : "";
  // TypeScript ESM style: `./util.js` refers to `./util.ts`.
  for (const swap of JS_TO_TS[ext] ?? []) {
    const candidate = base.slice(0, dot) + swap;
    if (files.has(candidate)) return candidate;
  }
  for (const e of JS_EXTS) if (files.has(base + e)) return base + e;
  for (const e of JS_EXTS) if (files.has(`${base}/index${e}`)) return `${base}/index${e}`;
  return undefined;
}

export function resolveJsImport(from: string, specifier: string, ctx: ResolveContext): string | undefined {
  const spec = specifier.split("?")[0].split("#")[0];
  if (!spec) return undefined;

  if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../")) {
    const base = joinPath(dirname(from), spec);
    return base === null ? undefined : tryJsFile(base, ctx.files);
  }

  const alias = ctx.alias;
  if (!alias) return undefined;
  for (const { pattern, targets } of alias.paths) {
    const star = pattern.indexOf("*");
    let captured: string | undefined;
    if (star < 0) {
      if (spec === pattern) captured = "";
    } else {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= prefix.length + suffix.length) {
        captured = spec.slice(prefix.length, spec.length - suffix.length);
      }
    }
    if (captured === undefined) continue;
    for (const target of targets) {
      const base = joinPath(alias.baseDir, target.replace("*", captured));
      const hit = base === null ? undefined : tryJsFile(base, ctx.files);
      if (hit) return hit;
    }
  }
  if (alias.hasBaseUrl && !spec.startsWith("@") && !spec.startsWith("/")) {
    const base = joinPath(alias.baseDir, spec);
    if (base !== null) return tryJsFile(base, ctx.files);
  }
  return undefined;
}

function tryPythonModule(modPath: string, files: ReadonlySet<string>): string | undefined {
  if (files.has(`${modPath}.py`)) return `${modPath}.py`;
  if (files.has(`${modPath}.pyi`)) return `${modPath}.pyi`;
  if (files.has(`${modPath}/__init__.py`)) return `${modPath}/__init__.py`;
  return undefined;
}

export function resolvePythonImport(from: string, imp: PythonImport, ctx: ResolveContext): string[] {
  const results = new Set<string>();
  const modRel = imp.module.replace(/\./g, "/");

  const bases: string[] = [];
  if (imp.level > 0) {
    let pkg: string | null = dirname(from);
    for (let i = 1; i < imp.level && pkg !== null; i++) pkg = pkg ? dirname(pkg) : null;
    if (pkg === null) return [];
    const base = joinPath(pkg, modRel);
    if (base !== null) bases.push(base);
  } else {
    if (!modRel) return [];
    for (const root of ctx.pythonRoots) {
      const base = joinPath(root, modRel);
      if (base !== null && (tryPythonModule(base, ctx.files) || imp.names.some((n) => tryPythonModule(`${base}/${n}`, ctx.files)))) {
        bases.push(base);
        break;
      }
    }
  }

  for (const base of bases) {
    const mod = base ? tryPythonModule(base, ctx.files) : undefined;
    if (mod) results.add(mod);
    // `from pkg import name` may import a submodule.
    for (const name of imp.names) {
      const sub = tryPythonModule(base ? `${base}/${name}` : name, ctx.files);
      if (sub) results.add(sub);
    }
  }
  results.delete(from);
  return [...results];
}

/** Parse tsconfig/jsconfig JSON-with-comments without dropping string contents. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

interface TsConfigLike {
  extends?: string | string[];
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
}

/** Read alias settings from a tsconfig/jsconfig located at `configPath`. */
export function aliasFromTsconfig(configPath: string, json: unknown, inherited?: AliasConfig): AliasConfig | undefined {
  const cfg = (json ?? {}) as TsConfigLike;
  const configDir = dirname(configPath);
  const opts = cfg.compilerOptions ?? {};
  const baseDir = opts.baseUrl !== undefined ? joinPath(configDir, opts.baseUrl) : null;
  const paths = opts.paths
    ? Object.entries(opts.paths)
        .filter(([, t]) => Array.isArray(t))
        .map(([pattern, targets]) => ({ pattern, targets }))
    : undefined;
  if (!paths && baseDir === null) return inherited;
  return {
    baseDir: baseDir ?? (paths ? configDir : (inherited?.baseDir ?? configDir)),
    hasBaseUrl: baseDir !== null || Boolean(inherited?.hasBaseUrl),
    paths: paths ?? inherited?.paths ?? [],
    source: configPath,
  };
}
