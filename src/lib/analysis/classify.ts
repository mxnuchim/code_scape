import type { Category, LandmarkKind } from "./types";
import { detectLanguage, extensionOf } from "./languages";

const CODE_LANGUAGES = new Set([
  "typescript", "javascript", "python", "go", "rust", "java", "kotlin", "swift", "objc",
  "c", "cpp", "csharp", "fsharp", "ruby", "php", "scala", "dart", "elixir", "erlang",
  "haskell", "ocaml", "clojure", "lua", "r", "julia", "zig", "nim", "solidity", "shell",
  "powershell", "html", "vue", "svelte", "astro",
]);

const STYLE_LANGUAGES = new Set(["css", "scss", "less"]);
const DOC_LANGUAGES = new Set(["markdown", "mdx", "rst"]);
const DATA_LANGUAGES = new Set(["json", "yaml", "toml", "xml", "csv", "sql", "graphql", "protobuf"]);
const ASSET_LANGUAGES = new Set(["image", "font", "media", "model3d", "binary"]);

const DOC_NAMES = /^(readme|license|licence|copying|changelog|changes|history|contributing|code_of_conduct|security|authors|contributors|notice|support|governance|maintainers|funding|citation)(\.[a-z0-9]+)?$/i;

const TEST_DIR = /(^|\/)(__tests__|__test__|__mocks__|__snapshots__|__fixtures__|tests?|specs?|e2e|cypress|playwright|fixtures?|testing|testdata)(\/|$)/i;
const TEST_FILE =
  /(?:[._-](?:test|spec|e2e|bench)\.[a-z0-9]+$)|(?:^test_[^/]*\.py$)|(?:_test\.(?:go|py|rb|exs?|dart|c|cc|cpp)$)|(?:Tests?\.(?:java|kt|swift|cs|scala|m)$)|(?:_spec\.rb$)|(?:\.snap$)/i;

const BUILD_NAMES = /^(dockerfile.*|containerfile|.*\.dockerfile|docker-compose.*\.ya?ml|compose\.ya?ml|makefile|gnumakefile|.*\.mk|cmakelists\.txt|.*\.cmake|justfile|taskfile\.ya?ml|jenkinsfile|\.gitlab-ci\.yml|\.travis\.yml|azure-pipelines\.yml|appveyor\.yml|cloudbuild\.ya?ml|procfile|vagrantfile|earthfile|build\.(sh|ps1|bat|cmd)|bitbucket-pipelines\.yml)$/i;
const BUILD_DIR = /^(\.github\/workflows|\.github\/actions|\.circleci|\.buildkite|scripts|tools|tooling|ci|\.husky|\.devcontainer)(\/|$)/i;

const CONFIG_NAMES =
  /^(package\.json|tsconfig.*\.json|jsconfig.*\.json|deno\.jsonc?|bunfig\.toml|\.?eslintrc.*|eslint\.config\..*|\.?prettierrc.*|prettier\.config\..*|\.prettierignore|\.eslintignore|\.editorconfig|\.gitignore|\.gitattributes|\.gitmodules|\.npmrc|\.nvmrc|\.node-version|\.tool-versions|\.yarnrc.*|\.npmignore|\.dockerignore|\.browserslistrc|\.babelrc.*|babel\.config\..*|\.swcrc|\.stylelintrc.*|stylelint\.config\..*|.*\.config\.(js|cjs|mjs|ts|mts|cts|json)|cargo\.toml|go\.mod|go\.work|pyproject\.toml|setup\.py|setup\.cfg|requirements.*\.txt|pipfile|tox\.ini|pytest\.ini|mypy\.ini|\.flake8|\.pylintrc|\.coveragerc|gemfile|.*\.gemspec|composer\.json|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|mix\.exs|pubspec\.yaml|package\.swift|.*\.csproj|.*\.sln|\.env(\..*)?|turbo\.json|nx\.json|lerna\.json|pnpm-workspace\.yaml|renovate\.json5?|\.renovaterc.*|dependabot\.yml|vercel\.json|netlify\.toml|biome\.jsonc?|\.releaserc.*|codecov\.ya?ml|\.codecov\.ya?ml|codeowners|funding\.yml|\.mailmap|.*\.code-workspace|rust-toolchain(\.toml)?|\.clang-format|\.rubocop\.yml|\.golangci\.ya?ml|vitest\.workspace\..*|jest\.preset\.js|karma\.conf\.js|\.watchmanconfig|\.vscode.*)$/i;
const CONFIG_EXT = new Set(["toml", "ini", "cfg", "conf", "properties", "env"]);
const CONFIG_DIR = /^(\.vscode|\.github|\.changeset|\.config|config|\.storybook)(\/|$)/i;

const MANIFESTS = new Set([
  "package.json", "cargo.toml", "go.mod", "pyproject.toml", "setup.py", "gemfile",
  "composer.json", "pom.xml", "build.gradle", "build.gradle.kts", "mix.exs",
  "pubspec.yaml", "deno.json", "deno.jsonc", "package.swift",
]);

export function isManifest(name: string): boolean {
  return MANIFESTS.has(name.toLowerCase());
}

export interface Classification {
  language: string;
  category: Category;
}

export function classifyFile(path: string): Classification {
  const slash = path.lastIndexOf("/");
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const language = detectLanguage(name).id;
  const ext = extensionOf(name);

  const category = ((): Category => {
    if (ASSET_LANGUAGES.has(language)) return "asset";
    if (DOC_NAMES.test(name)) return "docs";
    if (BUILD_NAMES.test(name) || BUILD_DIR.test(dir)) return "build";
    if (CONFIG_NAMES.test(name)) return "config";
    if (TEST_FILE.test(name) || TEST_DIR.test(dir)) return "test";
    if (STYLE_LANGUAGES.has(language)) return "style";
    if (DOC_LANGUAGES.has(language)) return "docs";
    if (language === "text") return /(^|\/)docs?(\/|$)/i.test(dir) ? "docs" : "data";
    if (CONFIG_EXT.has(ext) || language === "ini") return "config";
    if (CONFIG_DIR.test(dir) && (language === "yaml" || language === "json")) return "config";
    if (DATA_LANGUAGES.has(language)) return "data";
    if (CODE_LANGUAGES.has(language)) return "source";
    if (language === "docker" || language === "make" || language === "cmake") return "build";
    if (language === "nix" || language === "hcl") return "config";
    return "other";
  })();

  return { language, category };
}

const ENTRY_BASENAMES = /^(index|main|app|server|cli|mod)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;
const ENTRY_UI = /^(App)\.(tsx|jsx|vue|svelte)$/;
const NEXT_ENTRY = /^(page|layout)\.(tsx|jsx|ts|js)$/;
const PY_ENTRY = /^(main|app|manage|wsgi|asgi|cli)\.py$/i;

/**
 * Landmarks are recognised by naming convention only. The UI labels them that
 * way, so we never claim more than the filename tells us.
 */
export function detectLandmark(
  path: string,
  category: Category,
  packageDirs: ReadonlySet<string>,
): LandmarkKind | undefined {
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  const dir = segments.slice(0, -1).join("/");
  const depth = segments.length - 1;
  const lower = name.toLowerCase();

  if (depth === 0 && /^readme(\.|$)/i.test(name)) return "readme";
  if (depth === 0 && /^(license|licence|copying)(\.|$)/i.test(name)) return "license";
  if (isManifest(lower) && (depth === 0 || packageDirs.has(dir))) return "manifest";
  if (category === "test" || category === "docs" || category === "config") return undefined;

  // Is this file at a project root, or in a package's src/ folder?
  const parent = segments.slice(0, -2).join("/");
  const lastDir = segments[segments.length - 2] ?? "";
  const atRoot = depth === 0 || packageDirs.has(dir);
  const inSrc = lastDir === "src" && (depth === 1 || packageDirs.has(parent));

  if ((atRoot || inSrc) && (ENTRY_BASENAMES.test(name) || ENTRY_UI.test(name))) return "entry";
  if (NEXT_ENTRY.test(name) && /(^|\/)app$/.test(dir) && depth <= 3) return "entry";
  if ((atRoot || inSrc) && PY_ENTRY.test(name)) return "entry";
  if (lower === "__main__.py" && depth <= 3) return "entry";
  if (lower === "main.go" && depth <= 3) return "entry";
  if ((lower === "main.rs" || lower === "lib.rs") && lastDir === "src") return "entry";
  if ((lower === "main.c" || lower === "main.cpp" || lower === "main.cc") && depth <= 2) return "entry";
  return undefined;
}
