/**
 * Repository overview: what kind of project this is, its technologies,
 * modules, entry points, commands, tests and the limits of the analysis.
 *
 * Every item is labelled with how it is known. Manifests are facts; parsed
 * structure is static analysis; anything derived from names is a heuristic.
 */
import type { DirNode, RepoModel } from "../types";
import { joinPath } from "../imports/resolve";
import type { Basis, CodeIndex, CodeLanguage, Evidence } from "./types";

export interface Technology {
  name: string;
  category: "framework" | "ui" | "data" | "testing" | "build" | "runtime" | "tooling";
  basis: "fact";
  evidence: Evidence;
}

export interface ModuleSummary {
  path: string;
  name: string;
  files: number;
  bytes: number;
  languages: { language: string; files: number }[];
  isPackage: boolean;
  /** What the module seems to be for. Always labelled with its basis. */
  role?: { label: string; basis: Basis; reason: string };
  /** Resolved imports from other modules into this one. */
  importedBy: number;
  /** Resolved imports from this module into other modules. */
  imports: number;
}

export type EntryKind = "manifest" | "script" | "http-route" | "main" | "framework-convention" | "naming-convention";

export interface EntryPoint {
  path: string;
  symbol?: string;
  kind: EntryKind;
  label: string;
  basis: Basis;
  evidence: Evidence;
}

export interface CommandInfo {
  name: string;
  command: string;
  basis: "fact";
  evidence: Evidence;
}

export interface Overview {
  name: string;
  description?: { text: string; basis: "fact"; evidence: Evidence };
  projectType: { label: string; basis: Basis; reasons: string[] };
  languages: { language: string; files: number; bytes: number }[];
  technologies: Technology[];
  modules: ModuleSummary[];
  entryPoints: EntryPoint[];
  routes: { total: number; byFramework: Record<string, number> };
  commands: CommandInfo[];
  configFiles: string[];
  tests: { locations: { path: string; files: number }[]; files: number; frameworks: string[] };
  docs: string[];
  boundaries: { from: string; to: string; imports: number }[];
  limitations: string[];
}

// ---- manifest inputs ---------------------------------------------------------

const MANIFEST_FILES = /(^|\/)(package\.json|pyproject\.toml|requirements(-[\w]+)?\.txt|setup\.cfg|go\.mod|cargo\.toml|pom\.xml|build\.gradle(\.kts)?|makefile|justfile)$/i;

/** Files the overview needs to read (manifests at the root and in packages, plus the root README). */
export function overviewInputs(model: RepoModel): string[] {
  const out: string[] = [];
  for (const f of model.files) {
    const atPackage = f.depth === 0 || model.dirsByPath.get(f.dirPath)?.isPackage;
    if (atPackage && MANIFEST_FILES.test(f.path)) out.push(f.path);
    if (f.depth === 0 && /^readme(\.(md|markdown|rst|txt))?$/i.test(f.name)) out.push(f.path);
  }
  return out.slice(0, 60);
}

/** 1-based line of the first occurrence of `needle` (or of character offset `needle`). */
function lineOf(text: string, needle: string | number): number {
  const idx = typeof needle === "number" ? needle : text.indexOf(needle);
  if (idx < 0) return 1;
  return text.slice(0, idx).split("\n").length;
}

const JS_TECH: Record<string, [string, Technology["category"]]> = {
  next: ["Next.js", "framework"],
  react: ["React", "ui"],
  vue: ["Vue", "ui"],
  svelte: ["Svelte", "ui"],
  "@sveltejs/kit": ["SvelteKit", "framework"],
  nuxt: ["Nuxt", "framework"],
  "@angular/core": ["Angular", "framework"],
  "@remix-run/node": ["Remix", "framework"],
  astro: ["Astro", "framework"],
  express: ["Express", "framework"],
  fastify: ["Fastify", "framework"],
  hono: ["Hono", "framework"],
  koa: ["Koa", "framework"],
  "@nestjs/core": ["NestJS", "framework"],
  "@trpc/server": ["tRPC", "framework"],
  graphql: ["GraphQL", "framework"],
  "@apollo/server": ["Apollo Server", "framework"],
  electron: ["Electron", "runtime"],
  "@modelcontextprotocol/server": ["MCP server SDK", "framework"],
  "@modelcontextprotocol/sdk": ["MCP SDK", "framework"],
  prisma: ["Prisma", "data"],
  "@prisma/client": ["Prisma", "data"],
  "drizzle-orm": ["Drizzle ORM", "data"],
  typeorm: ["TypeORM", "data"],
  sequelize: ["Sequelize", "data"],
  mongoose: ["Mongoose", "data"],
  pg: ["PostgreSQL client (pg)", "data"],
  mysql2: ["MySQL client", "data"],
  "better-sqlite3": ["SQLite", "data"],
  redis: ["Redis client", "data"],
  ioredis: ["Redis client", "data"],
  bullmq: ["BullMQ jobs", "runtime"],
  zustand: ["Zustand", "ui"],
  "@reduxjs/toolkit": ["Redux Toolkit", "ui"],
  three: ["three.js", "ui"],
  "@react-three/fiber": ["React Three Fiber", "ui"],
  tailwindcss: ["Tailwind CSS", "ui"],
  zod: ["Zod", "tooling"],
  vitest: ["Vitest", "testing"],
  jest: ["Jest", "testing"],
  mocha: ["Mocha", "testing"],
  "@playwright/test": ["Playwright", "testing"],
  cypress: ["Cypress", "testing"],
  vite: ["Vite", "build"],
  webpack: ["webpack", "build"],
  esbuild: ["esbuild", "build"],
  typescript: ["TypeScript", "build"],
};

const PY_TECH: Record<string, [string, Technology["category"]]> = {
  flask: ["Flask", "framework"],
  django: ["Django", "framework"],
  fastapi: ["FastAPI", "framework"],
  starlette: ["Starlette", "framework"],
  sqlalchemy: ["SQLAlchemy", "data"],
  alembic: ["Alembic migrations", "data"],
  pydantic: ["Pydantic", "tooling"],
  celery: ["Celery", "runtime"],
  pytest: ["pytest", "testing"],
  click: ["Click", "tooling"],
  typer: ["Typer", "tooling"],
  numpy: ["NumPy", "data"],
  pandas: ["pandas", "data"],
  torch: ["PyTorch", "data"],
  uvicorn: ["Uvicorn", "runtime"],
  gunicorn: ["Gunicorn", "runtime"],
};

const GO_TECH: Record<string, [string, Technology["category"]]> = {
  "github.com/gin-gonic/gin": ["Gin", "framework"],
  "github.com/labstack/echo": ["Echo", "framework"],
  "github.com/gorilla/mux": ["gorilla/mux", "framework"],
  "github.com/go-chi/chi": ["chi", "framework"],
  "gorm.io/gorm": ["GORM", "data"],
  "github.com/spf13/cobra": ["Cobra CLI", "tooling"],
  "google.golang.org/grpc": ["gRPC", "framework"],
};

const RUST_TECH: Record<string, [string, Technology["category"]]> = {
  axum: ["axum", "framework"],
  "actix-web": ["Actix Web", "framework"],
  rocket: ["Rocket", "framework"],
  warp: ["warp", "framework"],
  tonic: ["tonic (gRPC)", "framework"],
  tokio: ["Tokio", "runtime"],
  serde: ["Serde", "tooling"],
  sqlx: ["SQLx", "data"],
  diesel: ["Diesel", "data"],
  "sea-orm": ["SeaORM", "data"],
  redis: ["Redis client", "data"],
  clap: ["clap", "tooling"],
  reqwest: ["reqwest", "tooling"],
  tracing: ["tracing", "tooling"],
};

/** Maven/Gradle artifact ids (exact, or a prefix ending in "-"). */
const JAVA_TECH: [string, [string, Technology["category"]]][] = [
  ["spring-boot-starter-web", ["Spring MVC", "framework"]],
  ["spring-boot-starter-webmvc", ["Spring MVC", "framework"]],
  ["spring-webmvc", ["Spring MVC", "framework"]],
  ["spring-webflux", ["Spring WebFlux", "framework"]],
  ["spring-boot-starter-thymeleaf", ["Thymeleaf", "ui"]],
  ["spring-boot-starter-webflux", ["Spring WebFlux", "framework"]],
  ["spring-boot-starter-data-jpa", ["Spring Data JPA", "data"]],
  ["spring-boot-starter-jdbc", ["Spring JDBC", "data"]],
  ["spring-boot-starter-security", ["Spring Security", "framework"]],
  ["spring-boot-starter-test", ["Spring Boot Test", "testing"]],
  ["spring-boot-", ["Spring Boot", "framework"]],
  ["quarkus-", ["Quarkus", "framework"]],
  ["micronaut-", ["Micronaut", "framework"]],
  ["hibernate-core", ["Hibernate", "data"]],
  ["postgresql", ["PostgreSQL driver", "data"]],
  ["mysql-connector-j", ["MySQL driver", "data"]],
  ["flyway-core", ["Flyway migrations", "data"]],
  ["liquibase-core", ["Liquibase migrations", "data"]],
  ["jackson-databind", ["Jackson", "tooling"]],
  ["lombok", ["Lombok", "tooling"]],
  ["junit-jupiter", ["JUnit 5", "testing"]],
  ["junit", ["JUnit", "testing"]],
  ["mockito-core", ["Mockito", "testing"]],
];

function javaTech(artifact: string): [string, Technology["category"]][] {
  const out: [string, Technology["category"]][] = [];
  for (const [id, def] of JAVA_TECH) if (artifact === id || (id.endsWith("-") && artifact.startsWith(id))) out.push(def);
  return out;
}

/** Dependency names in Cargo.toml `[dependencies]`-style sections, with their offsets. */
function cargoDependencies(text: string): { name: string; at: number }[] {
  const out: { name: string; at: number }[] = [];
  let section = "";
  let offset = 0;
  for (const line of text.split("\n")) {
    const header = /^\s*\[\s*([^\]]+?)\s*\]/.exec(line);
    if (header) {
      section = header[1];
      // `[dependencies.serde]` names the dependency in the header.
      const inline = /^(?:workspace\.)?(?:dev-|build-)?dependencies\.([\w-]+)$/.exec(section);
      if (inline) out.push({ name: inline[1], at: offset + line.indexOf(inline[1]) });
    } else if (/^(?:workspace\.)?(?:dev-|build-)?dependencies$|^target\..+\.(?:dev-)?dependencies$/.test(section)) {
      const m = /^\s*([\w-]+)\s*=/.exec(line);
      if (m) out.push({ name: m[1], at: offset + line.indexOf(m[1]) });
    }
    offset += line.length + 1;
  }
  return out;
}

interface PackageJson {
  name?: string;
  description?: string;
  main?: string;
  module?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: unknown;
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

// ---- builder -----------------------------------------------------------------

const MAIN_ENTRY_LABEL: Partial<Record<CodeLanguage, string>> = {
  python: "`if __name__ == \"__main__\":` block",
  go: "`func main` in package main",
  rust: "`fn main` in a binary crate root",
  java: "`public static void main` method",
};

export function buildOverview(model: RepoModel, index: CodeIndex, texts: ReadonlyMap<string, string>): Overview {
  const technologies = new Map<string, Technology>();
  const entryPoints: EntryPoint[] = [];
  const commands: CommandInfo[] = [];
  let description: Overview["description"];
  const addTech = (def: [string, Technology["category"]], evidence: Evidence) => {
    if (!technologies.has(def[0])) technologies.set(def[0], { name: def[0], category: def[1], basis: "fact", evidence });
  };
  const addEntry = (e: EntryPoint) => {
    if (isNonProductPath(e.path) || model.filesByPath.get(e.path)?.category === "test") return;
    if (!entryPoints.some((x) => x.path === e.path && x.kind === e.kind && x.symbol === e.symbol)) entryPoints.push(e);
  };
  const ev = (path: string, line: number): Evidence => ({ path, startLine: line, endLine: line });
  let hasBin = false;
  let hasLibraryExport = false;

  for (const [path, text] of [...texts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (isNonProductPath(path)) continue;
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

    if (name === "package.json") {
      const pkg = parseJson<PackageJson>(text);
      if (!pkg) continue;
      if (!description && dir === "" && pkg.description) description = { text: pkg.description, basis: "fact", evidence: ev(path, lineOf(text, '"description"')) };
      for (const deps of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
        for (const dep of Object.keys(deps ?? {})) {
          const def = JS_TECH[dep];
          if (def) addTech(def, ev(path, lineOf(text, `"${dep}"`)));
        }
      }
      const fileEntry = (spec: string, label: string, kind: EntryKind) => {
        const target = joinPath(dir, spec);
        if (target && model.filesByPath.has(target)) {
          addEntry({ path: target, kind, label, basis: "fact", evidence: ev(path, lineOf(text, spec)) });
          return true;
        }
        return false;
      };
      if (pkg.bin) {
        hasBin = true;
        const bins = typeof pkg.bin === "string" ? { [pkg.name ?? "bin"]: pkg.bin } : pkg.bin;
        for (const [binName, spec] of Object.entries(bins)) if (typeof spec === "string") fileEntry(spec, `CLI command \`${binName}\` (package.json bin)`, "manifest");
      }
      for (const key of ["main", "module"] as const) {
        const spec = pkg[key];
        if (typeof spec === "string") {
          hasLibraryExport = true;
          fileEntry(spec, `Package ${key} (package.json)`, "manifest");
        }
      }
      if (pkg.exports) hasLibraryExport = true;
      for (const [script, command] of Object.entries(pkg.scripts ?? {})) {
        if (typeof command !== "string") continue;
        commands.push({ name: dir ? `${dir}: ${script}` : script, command, basis: "fact", evidence: ev(path, lineOf(text, `"${script}"`)) });
        if (/^(dev|start|serve)$/.test(script)) {
          for (const token of command.split(/\s+/)) {
            if (/\.(m|c)?(t|j)sx?$|\.py$/.test(token)) fileEntry(token, `Run by \`${script}\` script`, "script");
          }
        }
      }
      continue;
    }

    if (name === "pyproject.toml" || name.startsWith("requirements") || name === "setup.cfg") {
      if (name === "pyproject.toml" && !description) {
        const m = /^\s*description\s*=\s*"([^"]+)"/m.exec(text);
        if (m && dir === "") description = { text: m[1], basis: "fact", evidence: ev(path, lineOf(text, m[0].trim())) };
      }
      // The project's own name (`name = "flask"`) is not a dependency: blank that line, keeping line numbers.
      const deps = text.replace(/^\s*name\s*=.*$/gm, "");
      for (const [dep, def] of Object.entries(PY_TECH)) {
        const re = new RegExp(`(^|["'\\s,\\[])${dep}([\\s<>=~!\\[;,"']|$)`, "im");
        const m = re.exec(deps);
        if (m) addTech(def, ev(path, lineOf(deps, m.index + m[1].length)));
      }
      if (name === "pyproject.toml") {
        const section = /^\[project\.scripts\]\s*$([\s\S]*?)(^\[|$(?![\s\S]))/m.exec(text);
        for (const line of section?.[1].split("\n") ?? []) {
          const m = /^\s*([\w.-]+)\s*=\s*"([\w.]+):(\w+)"/.exec(line);
          if (!m) continue;
          const modPath = m[2].replace(/\./g, "/");
          const candidates = [`${modPath}.py`, `${modPath}/__init__.py`, `src/${modPath}.py`, `src/${modPath}/__init__.py`].map((c) => joinPath(dir, c));
          const hit = candidates.find((c): c is string => !!c && model.filesByPath.has(c));
          if (hit) {
            hasBin = true;
            addEntry({ path: hit, symbol: m[3], kind: "manifest", label: `CLI command \`${m[1]}\` (pyproject scripts)`, basis: "fact", evidence: ev(path, lineOf(text, line.trim())) });
          }
        }
      }
      continue;
    }

    if (name === "cargo.toml") {
      if (!description && dir === "") {
        const m = /^\s*description\s*=\s*"([^"]+)"/m.exec(text);
        if (m) description = { text: m[1], basis: "fact", evidence: ev(path, lineOf(text, m[0].trim())) };
      }
      // A workspace's own crates depend on each other (axum-extra → axum); that isn't a technology choice.
      const ownCrates = new Set((index.rustCrates ?? []).map((c) => c.name));
      for (const dep of cargoDependencies(text)) {
        if (ownCrates.has(dep.name.replace(/-/g, "_"))) continue;
        const def = RUST_TECH[dep.name];
        if (def) addTech(def, ev(path, lineOf(text, dep.at)));
      }
      const pkgName = /^\[package\][^[]*?^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1];
      const header = /^\[(package|workspace)\]/m.exec(text);
      const at = ev(path, header ? lineOf(text, header.index) : 1);
      const inWorkspace = dir !== "" && texts.get("Cargo.toml")?.match(/^\[workspace\]/m);
      const flag = dir === "" || !pkgName ? "" : ` -p ${pkgName}`;
      if (dir === "" || !inWorkspace) {
        commands.push({ name: `${dir ? `${dir}: ` : ""}cargo build`, command: "cargo build", basis: "fact", evidence: at });
        commands.push({ name: `${dir ? `${dir}: ` : ""}cargo test`, command: "cargo test", basis: "fact", evidence: at });
      }
      const crateBins = (index.rustCrates ?? []).find((c) => c.dir === dir)?.bins ?? [];
      if (pkgName && crateBins.length) {
        commands.push({ name: `cargo run${flag}`, command: `cargo run${flag}`, basis: "fact", evidence: at });
      }
      continue;
    }

    if (name === "pom.xml" || name === "build.gradle" || name === "build.gradle.kts") {
      const maven = name === "pom.xml";
      if (maven && !description && dir === "") {
        const m = /<description>([^<]+)<\/description>/.exec(text);
        if (m) description = { text: m[1].trim(), basis: "fact", evidence: ev(path, lineOf(text, m.index)) };
      }
      let springBoot: Evidence | undefined;
      if (maven) {
        // Only artifacts this project depends on; its own <artifactId> is not a dependency.
        for (const block of text.matchAll(/<(dependency|plugin|parent)>[\s\S]*?<\/\1>/g)) {
          const m = /<artifactId>\s*([\w.-]+)\s*<\/artifactId>/.exec(block[0]);
          if (!m) continue;
          const at = ev(path, lineOf(text, block.index! + m.index));
          for (const def of javaTech(m[1])) addTech(def, at);
          if (m[1] === "spring-boot-maven-plugin") springBoot = at;
        }
      } else {
        // The Boot plugin is the most direct evidence for Spring Boot, so it goes first.
        const plugin = /id\s*\(?\s*["']org\.springframework\.boot["']/.exec(text);
        if (plugin) {
          springBoot = ev(path, lineOf(text, plugin.index));
          addTech(["Spring Boot", "framework"], springBoot);
        }
        for (const m of text.matchAll(/["']([\w.-]+):([\w.-]+)(?::[^"'\s]*)?["']/g)) {
          for (const def of javaTech(m[2])) addTech(def, ev(path, lineOf(text, m.index!)));
        }
      }
      const prefix = dir ? `${dir}: ` : "";
      const at = ev(path, maven ? lineOf(text, "<project") : 1);
      if (maven) {
        const mvn = model.filesByPath.has(joinPath(dir, "mvnw") ?? "") ? "./mvnw" : "mvn";
        commands.push({ name: `${prefix}${mvn} test`, command: `${mvn} test`, basis: "fact", evidence: at });
        if (springBoot) commands.push({ name: `${prefix}${mvn} spring-boot:run`, command: `${mvn} spring-boot:run`, basis: "fact", evidence: springBoot });
      } else {
        const gradle = model.filesByPath.has(joinPath(dir, "gradlew") ?? "") ? "./gradlew" : "gradle";
        commands.push({ name: `${prefix}${gradle} test`, command: `${gradle} test`, basis: "fact", evidence: at });
        if (springBoot) commands.push({ name: `${prefix}${gradle} bootRun`, command: `${gradle} bootRun`, basis: "fact", evidence: springBoot });
      }
      continue;
    }

    if (name === "go.mod") {
      for (const [mod, def] of Object.entries(GO_TECH)) if (text.includes(mod)) addTech(def, ev(path, lineOf(text, mod)));
      continue;
    }

    if (name === "makefile" || name === "justfile") {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        const m = /^([A-Za-z0-9][\w.-]*)\s*:(?!=)/.exec(line);
        if (m && m[1] !== ".PHONY") {
          const body = lines[i + 1]?.trim() ?? "";
          commands.push({ name: `${name === "makefile" ? "make" : "just"} ${m[1]}`, command: body.slice(0, 120), basis: "fact", evidence: ev(path, i + 1) });
        }
      });
      continue;
    }

    if (/^readme/.test(name) && !description) {
      const para = text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .find((p) => p && !p.startsWith("#") && !p.startsWith("<") && !p.startsWith("[!") && !p.startsWith("![") && !/^\[!\[/.test(p) && p.length > 30);
      if (para) {
        const oneLine = para.replace(/\s+/g, " ");
        description = { text: oneLine.length > 280 ? `${oneLine.slice(0, 277)}…` : oneLine, basis: "fact", evidence: ev(path, lineOf(text, para.slice(0, 40))) };
      }
    }
  }

  // Language-level technologies from the tree itself.
  for (const [language, label] of [["typescript", "TypeScript"], ["python", "Python"], ["go", "Go"], ["rust", "Rust"], ["java", "Java"], ["javascript", "JavaScript"]] as const) {
    if (!model.stats.languages[language] || technologies.has(label)) continue;
    const sample = model.files.find((f) => f.language === language)!;
    technologies.set(label, { name: label, category: "runtime", basis: "fact", evidence: ev(sample.path, 1) });
  }

  // Entry points from parsed code.
  const routes = { total: 0, byFramework: {} as Record<string, number> };
  const productFiles = Object.values(index.files).filter((f) => !isNonProductPath(f.path));
  for (const file of productFiles) {
    for (const r of file.routes) {
      if (r.method === "PAGE") continue;
      routes.total++;
      routes.byFramework[r.framework] = (routes.byFramework[r.framework] ?? 0) + 1;
    }
    if (file.mainAt) {
      addEntry({
        path: file.path,
        kind: "main",
        label: MAIN_ENTRY_LABEL[file.language] ?? "`main`",
        basis: "static-analysis",
        evidence: ev(file.path, file.mainAt),
      });
    }
  }
  const routeFiles = new Map<string, number>();
  for (const file of productFiles) {
    const n = file.routes.filter((r) => r.method !== "PAGE").length;
    if (n) routeFiles.set(file.path, n);
  }
  for (const [path, count] of [...routeFiles].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    const first = index.files[path].routes.find((r) => r.method !== "PAGE")!;
    addEntry({ path, kind: "http-route", label: `${count} HTTP route${count === 1 ? "" : "s"} (${first.framework})`, basis: "static-analysis", evidence: ev(path, first.line) });
  }
  // Framework conventions (Next.js pages/layouts) and naming-only landmarks.
  for (const f of model.files) {
    if (/(^|\/)app\/(.*\/)?(page|layout)\.(t|j)sx?$/.test(f.path) && technologies.has("Next.js") && f.depth <= 3) {
      addEntry({ path: f.path, kind: "framework-convention", label: `Next.js ${f.name.startsWith("page") ? "page" : "layout"} (file convention)`, basis: "static-analysis", evidence: ev(f.path, 1) });
    }
  }
  if (!entryPoints.some((e) => e.kind !== "framework-convention")) {
    for (const f of model.files) {
      if (f.landmark === "entry") addEntry({ path: f.path, kind: "naming-convention", label: "Named like an entry point", basis: "heuristic", evidence: ev(f.path, 1) });
    }
  }

  const modules = summarizeModules(model, index);
  const tech = [...technologies.values()];
  const projectType = inferProjectType(model, tech, routes.total, hasBin, hasLibraryExport, entryPoints, index);

  // Tests
  const testCounts = new Map<string, number>();
  let testFiles = 0;
  for (const f of model.files) {
    if (f.category !== "test") continue;
    testFiles++;
    const key = testLocationKey(f.path);
    testCounts.set(key, (testCounts.get(key) ?? 0) + 1);
  }

  return {
    name: model.meta.fullName,
    ...(description ? { description } : {}),
    projectType,
    languages: Object.entries(model.stats.languages)
      .map(([language, files]) => ({ language, files, bytes: model.stats.languageBytes[language] ?? 0 }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8),
    technologies: tech.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    modules,
    entryPoints: entryPoints.sort((a, b) => ENTRY_RANK[a.kind] - ENTRY_RANK[b.kind] || (a.path < b.path ? -1 : 1)).slice(0, 25),
    routes,
    commands: commands.slice(0, 40),
    configFiles: model.files
      .filter((f) => f.category === "config" && (f.depth === 0 || model.dirsByPath.get(f.dirPath)?.isPackage))
      .map((f) => f.path)
      .slice(0, 30),
    tests: {
      locations: [...testCounts].map(([path, files]) => ({ path, files })).sort((a, b) => b.files - a.files).slice(0, 10),
      files: testFiles,
      frameworks: tech.filter((t) => t.category === "testing").map((t) => t.name),
    },
    docs: model.files.filter((f) => f.category === "docs" && (f.depth <= 1 || /^docs?\//i.test(f.path))).map((f) => f.path).slice(0, 20),
    boundaries: moduleBoundaries(modules, index),
    limitations: describeLimitations(model, index),
  };
}

const ENTRY_RANK: Record<EntryKind, number> = { manifest: 0, script: 1, main: 2, "http-route": 3, "framework-convention": 4, "naming-convention": 5 };

function testLocationKey(path: string): string {
  const parts = path.split("/");
  const testIdx = parts.findIndex((p) => /^(__tests__|tests?|specs?|e2e|testing)$/i.test(p));
  if (testIdx >= 0) return parts.slice(0, testIdx + 1).join("/");
  return parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join("/") : "(root)";
}

// ---- modules -------------------------------------------------------------------

const ROLE_BY_NAME: [RegExp, string][] = [
  [/^(api|apis|routes?|routers?|controllers?|handlers?|endpoints?|resolvers?)$/i, "HTTP / API layer"],
  [/^(services?|domain|core|usecases?|use-cases|business|logic)$/i, "Business logic"],
  [/^(db|database|models?|repositor(y|ies)|repos?|dao|entities|schemas?|migrations?|prisma|persistence|storage|store)$/i, "Data and persistence"],
  [/^(components?|ui|views?|pages|screens|layouts?|widgets?)$/i, "User interface"],
  [/^(lib|libs|utils?|helpers?|common|shared|pkg|internal)$/i, "Shared library code"],
  [/^(config|configs|settings|conf)$/i, "Configuration"],
  [/^(tests?|__tests__|specs?|e2e|integration)$/i, "Tests"],
  [/^(scripts?|tools?|tooling|bin|cmd)$/i, "Scripts and commands"],
  [/^(docs?|documentation)$/i, "Documentation"],
  [/^(middlewares?)$/i, "Request middleware"],
  [/^(jobs?|workers?|queues?|tasks?|cron)$/i, "Background jobs"],
  [/^(auth|authentication|authz|security)$/i, "Authentication / authorisation"],
  [/^(hooks?)$/i, "Hooks"],
  [/^(state|stores?)$/i, "State management"],
  [/^(types?|interfaces?|typings)$/i, "Type definitions"],
  [/^(public|static|assets?)$/i, "Static assets"],
  [/^(styles?|css|theme|themes)$/i, "Styling and theming"],
  [/^(cli)$/i, "Command-line interface"],
  [/^(app)$/i, "Application shell"],
  [/^(src)$/i, "Source root"],
  [/^(packages|apps|modules)$/i, "Workspace packages"],
];

/** Folders that hold examples, fixtures or test data rather than the project itself. */
export const NON_PRODUCT_DIR = /(^|\/)(__tests__|tests?|specs?|e2e|fixtures?|__fixtures__|testdata|examples?|samples?|demos?|templates?|benchmarks?|benches)(\/|$)/i;

/**
 * Whether a path belongs to tests, fixtures, examples and the like. Inside a JVM
 * source root (`src/main/java/`) folders are package names, so `com/example/demo`
 * says nothing about the code; only the part up to the source root is checked.
 */
export function isNonProductPath(path: string): boolean {
  const root = /(^|\/)src\/[\w-]+\/(java|kotlin|scala)\//.exec(path);
  return NON_PRODUCT_DIR.test(root ? path.slice(0, root.index + root[0].length) : path);
}

/** Workspace packages: folders with their own manifest that aren't examples or fixtures. */
export function workspacePackages(model: RepoModel): DirNode[] {
  return [...model.dirsByPath.values()].filter((d) => d.isPackage && d.path !== "" && d.depth <= 3 && !isNonProductPath(d.path));
}

/** The folders worth presenting as the project's main modules. */
export function moduleDirs(model: RepoModel): DirNode[] {
  const root = model.root;
  const packages = workspacePackages(model);
  if (packages.length >= 2) return packages.sort((a, b) => b.stats.files - a.stats.files).slice(0, 24);
  let dirs = root.dirs.filter((d) => d.stats.files > 0);
  // Expand a folder that holds most of the source code (src/, lib/, app/…), up to twice.
  const sourceFiles = (d: { stats: { categories: Record<string, number> } }) => d.stats.categories.source ?? 0;
  for (let i = 0; i < 2; i++) {
    const total = dirs.reduce((n, d) => n + sourceFiles(d), 0) + root.files.filter((f) => f.category === "source").length;
    const dominant = dirs.find((d) => sourceFiles(d) / Math.max(1, total) > 0.6 && d.dirs.filter((c) => c.stats.files > 0).length >= 2);
    if (!dominant) break;
    // Files directly inside the dominant folder stay attached to it as their own module.
    const keepSelf = dominant.files.length > 0;
    dirs = [...dirs.filter((d) => d !== dominant), ...(keepSelf ? [dominant] : []), ...dominant.dirs.filter((d) => d.stats.files > 0)];
    if (keepSelf) break;
  }
  const sorted = dirs.sort((a, b) => b.stats.files - a.stats.files).slice(0, 24);
  // Source files directly at the root (Go package main, single-file scripts) form their own module.
  return root.files.some((f) => f.category === "source") ? [root, ...sorted] : sorted;
}

/** The most specific module containing `path`; the root module ("") matches anything as a fallback. */
export function moduleOf(modules: { path: string }[], path: string): string | undefined {
  let best: string | undefined;
  for (const m of modules) {
    const contains = m.path === "" || path === m.path || path.startsWith(`${m.path}/`);
    if (contains && (best === undefined || m.path.length > best.length)) best = m.path;
  }
  return best;
}

function summarizeModules(model: RepoModel, index: CodeIndex): ModuleSummary[] {
  const dirs = moduleDirs(model);
  const paths = dirs.map((d) => ({ path: d.path }));
  const importedBy = new Map<string, number>();
  const imports = new Map<string, number>();
  for (const e of index.importEdges) {
    const a = moduleOf(paths, e.fromPath);
    const b = moduleOf(paths, e.toPath);
    if (!a || !b || a === b) continue;
    imports.set(a, (imports.get(a) ?? 0) + 1);
    importedBy.set(b, (importedBy.get(b) ?? 0) + 1);
  }
  return dirs.map((d) => {
    if (d.path === "") return rootModule(d, paths, index, importedBy, imports);
    // Only files that belong to this module (not to a more specific one listed alongside it).
    const routeCount = Object.values(index.files)
      .filter((f) => moduleOf(paths, f.path) === d.path && !isNonProductPath(f.path))
      .reduce((n, f) => n + f.routes.filter((r) => r.method !== "PAGE").length, 0);
    let role: ModuleSummary["role"];
    if (routeCount > 0) {
      role = { label: "HTTP / API layer", basis: "static-analysis", reason: `${routeCount} route registration${routeCount === 1 ? "" : "s"} found in this folder` };
    } else {
      const byName = ROLE_BY_NAME.find(([re]) => re.test(d.name));
      if (byName) role = { label: byName[1], basis: "heuristic", reason: `Folder name \`${d.name}\`` };
      else {
        const dominant = Object.entries(d.stats.categories).sort((a, b) => b[1] - a[1])[0];
        if (dominant && dominant[0] !== "source") role = { label: `Mostly ${dominant[0]} files`, basis: "fact", reason: `${dominant[1]} of ${d.stats.files} files are ${dominant[0]}` };
      }
    }
    return {
      path: d.path,
      name: d.name,
      files: d.stats.files,
      bytes: d.stats.bytes,
      languages: Object.entries(d.stats.languages)
        .map(([language, files]) => ({ language, files }))
        .sort((a, b) => b.files - a.files)
        .slice(0, 3),
      isPackage: d.isPackage,
      ...(role ? { role } : {}),
      importedBy: importedBy.get(d.path) ?? 0,
      imports: imports.get(d.path) ?? 0,
    };
  });
}

function rootModule(root: DirNode, paths: { path: string }[], index: CodeIndex, importedBy: Map<string, number>, imports: Map<string, number>): ModuleSummary {
  const languages = new Map<string, number>();
  for (const f of root.files) languages.set(f.language, (languages.get(f.language) ?? 0) + 1);
  const routeCount = Object.values(index.files)
    .filter((f) => moduleOf(paths, f.path) === "")
    .reduce((n, f) => n + f.routes.filter((r) => r.method !== "PAGE").length, 0);
  return {
    path: "",
    name: "(repository root)",
    files: root.files.length,
    bytes: root.files.reduce((n, f) => n + f.size, 0),
    languages: [...languages].map(([language, files]) => ({ language, files })).sort((a, b) => b.files - a.files).slice(0, 3),
    isPackage: root.isPackage,
    role: routeCount
      ? { label: "HTTP / API layer", basis: "static-analysis", reason: `${routeCount} route registration${routeCount === 1 ? "" : "s"} in root files` }
      : { label: "Files at the repository root", basis: "fact", reason: "Source files directly in the root folder" },
    importedBy: importedBy.get("") ?? 0,
    imports: imports.get("") ?? 0,
  };
}

function moduleBoundaries(modules: ModuleSummary[], index: CodeIndex) {
  const counts = new Map<string, number>();
  for (const e of index.importEdges) {
    if (e.typeOnly) continue;
    const a = moduleOf(modules, e.fromPath);
    const b = moduleOf(modules, e.toPath);
    if (!a || !b || a === b) continue;
    const key = `${a}\u0000${b}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([k, imports]) => {
      const [from, to] = k.split("\u0000");
      return { from, to, imports };
    })
    .sort((a, b) => b.imports - a.imports || (a.from < b.from ? -1 : 1))
    .slice(0, 24);
}

function inferProjectType(
  model: RepoModel,
  tech: Technology[],
  routeCount: number,
  hasBin: boolean,
  hasLibraryExport: boolean,
  entries: EntryPoint[],
  index: CodeIndex,
): Overview["projectType"] {
  const has = (n: string) => tech.some((t) => t.name === n);
  const reasons: string[] = [];
  const packages = workspacePackages(model).length;
  const prefix = packages >= 2 ? `Monorepo (${packages} packages): ` : "";
  if (packages >= 2) reasons.push(`${packages} folders contain their own package manifest`);
  const pick = (label: string, why: string) => {
    reasons.push(why);
    return { label: prefix + label, basis: "heuristic" as const, reasons };
  };
  if (has("Next.js")) return pick("Next.js web application", "depends on `next`");
  for (const fw of ["NestJS", "Express", "Fastify", "Hono", "Koa"]) if (has(fw)) return pick(`Node.js HTTP service (${fw})`, `depends on ${fw}${routeCount ? `; ${routeCount} route registrations found` : ""}`);
  for (const fw of ["Django", "FastAPI", "Flask"]) if (has(fw)) return pick(`Python web application (${fw})`, `depends on ${fw}${routeCount ? `; ${routeCount} route registrations found` : ""}`);
  for (const fw of ["Gin", "Echo", "chi", "gorilla/mux"]) if (has(fw)) return pick(`Go HTTP service (${fw})`, `go.mod requires ${fw}`);
  for (const fw of ["axum", "Actix Web", "Rocket", "warp"]) if (has(fw)) return pick(`Rust HTTP service (${fw})`, `Cargo.toml depends on ${fw}${routeCount ? `; ${routeCount} route registrations found` : ""}`);
  for (const fw of ["Spring MVC", "Spring WebFlux"]) {
    if (has(fw)) return pick(`Java web application (${has("Spring Boot") ? "Spring Boot" : "Spring"})`, `depends on ${fw}${routeCount ? `; ${routeCount} route mappings found` : ""}`);
  }
  if (has("Spring Boot") && routeCount > 0) return pick("Java web application (Spring Boot)", `depends on Spring Boot; ${routeCount} route mappings found`);
  for (const fw of ["Quarkus", "Micronaut"]) if (has(fw)) return pick(`Java service (${fw})`, `depends on ${fw}`);
  if (routeCount > 0 && entries.some((e) => e.kind === "http-route" && e.path.endsWith(".go"))) return pick("Go HTTP service", "net/http route registrations found");
  if (has("Electron")) return pick("Electron desktop application", "depends on electron");
  if ((has("React") || has("Vue") || has("Svelte")) && has("Vite")) return pick("Single-page web application", "UI framework built with Vite");
  if (hasBin) return pick("Command-line tool", "manifest declares a CLI entry (bin/scripts)");
  if (model.stats.languages.go && entries.some((e) => e.kind === "main" && e.path.endsWith(".go"))) return pick("Go program", "`func main` in package main");
  if (entries.some((e) => e.kind === "main" && e.path.endsWith(".rs"))) return pick("Rust program", "`fn main` in a binary crate root");
  if (entries.some((e) => e.kind === "main" && e.path.endsWith(".java"))) return pick("Java application", "`public static void main` found");
  const crates = (index.rustCrates ?? []).filter((c) => !isNonProductPath(c.dir));
  if (crates.some((c) => c.lib) && !crates.some((c) => c.bins.length)) return pick("Rust library", "crate has src/lib.rs and no binary");
  if (hasLibraryExport) return pick("Library / package", "manifest declares main/module/exports and no app framework");
  if (model.files.some((f) => f.name === "pyproject.toml" || f.name === "setup.py")) return pick("Python package", "pyproject.toml / setup.py present");
  if (model.files.some((f) => f.name === "go.mod")) return pick("Go module", "go.mod present");
  if (model.files.some((f) => f.name === "Cargo.toml")) return pick("Rust crate", "Cargo.toml present");
  if (model.files.some((f) => f.name === "pom.xml" || f.name.startsWith("build.gradle"))) return pick("Java project", "pom.xml / build.gradle present");
  reasons.push("no recognised framework, manifest entry or main function");
  return { label: prefix + "Repository (type not determined)", basis: "heuristic", reasons };
}

function describeLimitations(model: RepoModel, index: CodeIndex): string[] {
  const out: string[] = [
    "Relationships come from static analysis of source text; nothing was executed and no runtime data is available.",
  ];
  const l = index.limits;
  if (l.parsed < l.eligible) {
    out.push(`Parsed ${l.parsed} of ${l.eligible} source files (cap ${l.cap}${l.skippedLarge ? `; ${l.skippedLarge} too large` : ""}${l.timedOut ? "; time budget reached" : ""}). Unparsed files have no symbols or edges.`);
  }
  if (l.fallback > 0) out.push(`${l.fallback} files were read with the regex fallback (imports only, no symbols or calls).`);
  if (l.failed.length) out.push(`${l.failed.length} files could not be read.`);
  if (l.withheld.length) out.push(`${l.withheld.length} files look like secrets (.env, keys, credentials); their contents were not read.`);
  const unparsedLangs = Object.entries(model.stats.languages)
    .filter(([lang, n]) => n > 0 && ["kotlin", "csharp", "ruby", "php", "swift", "c", "cpp", "scala", "elixir"].includes(lang))
    .map(([lang]) => lang);
  if (unparsedLangs.length) out.push(`No code parser yet for: ${unparsedLangs.join(", ")}. Those files appear in the map without symbols or dependencies.`);
  out.push("Calls are resolved through imports, declarations and declared types only: dynamic dispatch (interfaces, traits), dependency-injection wiring, reflection and string-based routing are not followed.");
  if (model.limits.truncated) out.push("The file listing was truncated; some files are missing.");
  if (model.limits.aggregatedDirs.length) out.push(`${model.limits.aggregatedDirs.length} large folders are drawn as single blocks in the city.`);
  if (model.excluded.skippedDirs.length) out.push(`Skipped without scanning: ${model.excluded.skippedDirs.slice(0, 6).map((d) => d.path).join(", ")}${model.excluded.skippedDirs.length > 6 ? "…" : ""} (dependencies, build output, caches).`);
  return out;
}
