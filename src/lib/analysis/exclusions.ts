/**
 * Things that are not the project's own architecture: installed dependencies,
 * build output, caches, VCS internals and generated lockfiles.
 */

const DIR_REASONS: Record<string, string> = {
  node_modules: "dependencies",
  bower_components: "dependencies",
  jspm_packages: "dependencies",
  vendor: "dependencies",
  Pods: "dependencies",
  "site-packages": "dependencies",
  ".venv": "dependencies",
  venv: "dependencies",
  ".yarn": "dependencies",
  ".pnpm-store": "dependencies",
  elm_stuff: "dependencies",
  "elm-stuff": "dependencies",
  ".dart_tool": "dependencies",
  ".pub-cache": "dependencies",

  dist: "build output",
  build: "build output",
  out: "build output",
  target: "build output",
  ".next": "build output",
  ".nuxt": "build output",
  ".svelte-kit": "build output",
  ".output": "build output",
  ".vercel": "build output",
  ".netlify": "build output",
  ".docusaurus": "build output",
  ".expo": "build output",
  "storybook-static": "build output",
  DerivedData: "build output",
  ".gradle": "build output",
  ".terraform": "build output",
  ".serverless": "build output",

  coverage: "caches",
  ".nyc_output": "caches",
  ".cache": "caches",
  ".parcel-cache": "caches",
  ".turbo": "caches",
  ".angular": "caches",
  __pycache__: "caches",
  ".pytest_cache": "caches",
  ".mypy_cache": "caches",
  ".ruff_cache": "caches",
  ".tox": "caches",

  ".git": "version control",
  ".svn": "version control",
  ".hg": "version control",

  ".idea": "editor settings",
  ".vs": "editor settings",
  ".fleet": "editor settings",
};

const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
  "bun.lockb", "bun.lock", "cargo.lock", "poetry.lock", "pipfile.lock", "uv.lock",
  "pdm.lock", "composer.lock", "gemfile.lock", "go.sum", "flake.lock", "mix.lock",
  "pubspec.lock", "podfile.lock", "packages.lock.json", "gradle.lockfile",
  "deno.lock", "package.resolved",
]);

const JUNK = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

const GENERATED_SUFFIXES = [".min.js", ".min.css", ".min.mjs", ".map", ".tsbuildinfo"];
const COMPILED_EXT = new Set(["pyc", "pyo", "class", "o", "obj", "so", "dll", "dylib", "exe", "a", "lib"]);

/** Returns the exclusion reason for a directory name, if it is excluded. */
export function excludedDirReason(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(DIR_REASONS, name) ? DIR_REASONS[name] : undefined;
}

/** Returns the exclusion reason for a file name, if it is excluded. */
export function excludedFileReason(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (LOCKFILES.has(lower)) return "lockfiles";
  if (JUNK.has(lower)) return "OS files";
  if (GENERATED_SUFFIXES.some((s) => lower.endsWith(s))) return "generated files";
  const dot = lower.lastIndexOf(".");
  if (dot > 0 && COMPILED_EXT.has(lower.slice(dot + 1))) return "compiled binaries";
  return undefined;
}

/**
 * For a full path, find the outermost excluded directory and its reason.
 * `build/` and `out/` are only treated as output at the top of a project or
 * package. Projects sometimes keep real source in folders with those names
 * deeper down (e.g. `src/build/`).
 */
export function excludedPathMatch(
  path: string,
): { dir: string; reason: string } | undefined {
  const segments = path.split("/");
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const reason = excludedDirReason(seg);
    if (!reason) continue;
    if ((seg === "build" || seg === "out" || seg === "target") && i > 2) continue;
    return { dir: segments.slice(0, i + 1).join("/"), reason };
  }
  return undefined;
}
