import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { initNodeParsers } from "@/lib/local/wasm";
import { LocalWorkspace } from "@/lib/local/workspace";
import { buildCityLayout } from "@/lib/layout/cityLayout";
import { parseSource, prepareLanguages } from "./parser";
import { parseWithRegex } from "./fallback";
import { dependenciesOf, relatedTests, searchSymbols } from "./queries";
import type { WorkspaceAnalysis } from "../workspace";

const FIXTURES = join(process.cwd(), "test", "fixtures");
const analyses = new Map<string, WorkspaceAnalysis>();

async function analyze(name: string) {
  if (!analyses.has(name)) {
    const ws = await LocalWorkspace.open(join(FIXTURES, name));
    analyses.set(name, (await ws.get()).analysis);
  }
  return analyses.get(name)!;
}

beforeAll(async () => {
  expect(await initNodeParsers()).toBe(true);
  await prepareLanguages(["a.ts", "a.tsx", "a.js", "a.py", "a.go"]);
});

describe("tree-sitter extraction", () => {
  it("extracts TypeScript symbols, imports, exports and routes with exact lines", () => {
    const src = [
      'import express, { Router } from "express";', // 1
      'import * as users from "./services/users";', // 2
      'import type { User } from "./types";', // 3
      'export { helper as h } from "./helper";', // 4
      "/** Builds the app. */", // 5
      "export function createApp() {", // 6
      "  const app = express();", // 7
      '  app.get("/users/:id", async (req, res) => {', // 8
      "    res.json(await users.findUser(req.params.id));", // 9
      "  });", // 10
      '  app.post("/users", createUser);', // 11
      "  return app;", // 12
      "}", // 13
      "export class Service { run() { this.helper(); } helper() {} }", // 14
      "export const svc = new Service();", // 15
      "export default createApp;", // 16
    ].join("\n");
    const p = parseSource("src/app.ts", src);
    expect(p.parser).toBe("tree-sitter");
    const byName = Object.fromEntries(p.symbols.map((s) => [s.qualifiedName, s]));
    expect(byName.createApp).toMatchObject({ kind: "function", exported: true, range: { startLine: 6, endLine: 13 }, doc: "Builds the app." });
    expect(byName["Service.run"]).toMatchObject({ kind: "method", range: { startLine: 14, endLine: 14 } });
    expect(byName.svc).toMatchObject({ kind: "variable", instanceOf: "Service" });
    expect(byName["GET /users/:id"]).toMatchObject({ kind: "handler", range: { startLine: 8, endLine: 10 } });
    expect(p.exports).toMatchObject({ createApp: "createApp", default: "createApp", Service: "Service" });

    expect(p.imports.map((i) => [i.line, i.specifier, i.kind, i.typeOnly])).toEqual([
      [1, "express", "static", false],
      [2, "./services/users", "static", false],
      [3, "./types", "static", true],
      [4, "./helper", "reexport", false],
    ]);
    expect(p.imports[0].bindings).toEqual([
      { local: "express", imported: "default" },
      { local: "Router", imported: "Router" },
    ]);
    expect(p.imports[3].bindings).toEqual([{ local: "h", imported: "helper" }]);

    expect(p.routes).toEqual([
      { method: "GET", route: "/users/:id", line: 8, framework: "express-style", handler: "src/app.ts#GET /users/:id" },
      { method: "POST", route: "/users", line: 11, framework: "express-style", handlerRef: "createUser" },
    ]);
    expect(p.calls).toContainEqual({ callee: "users.findUser", line: 9, enclosing: "src/app.ts#GET /users/:id" });
    expect(p.calls).toContainEqual({ callee: "this.helper", line: 14, enclosing: "src/app.ts#Service.run" });
  });

  it("treats rendered JSX components as references", () => {
    const p = parseSource("src/page.tsx", "export default function Page() {\n  return <Shell><UserCard id={1} /></Shell>;\n}\n");
    expect(p.calls.map((c) => c.callee)).toEqual(["Shell", "UserCard"]);
    expect(p.calls[0].enclosing).toBe("src/page.tsx#Page");
  });

  it("extracts Python routes, methods, docstrings and the __main__ guard", () => {
    const src = [
      "from flask import Flask", // 1
      "from .db import query as q", // 2
      "", // 3
      "app = Flask(__name__)", // 4
      "", // 5
      '@app.route("/items", methods=["GET", "POST"])', // 6
      "def items():", // 7
      '    """List items."""', // 8
      '    return q("select")', // 9
      "", // 10
      "class Repo:", // 11
      "    def find(self):", // 12
      "        return self.load()", // 13
      "    def load(self):", // 14
      "        pass", // 15
      "", // 16
      'if __name__ == "__main__":', // 17
      "    app.run()", // 18
    ].join("\n");
    const p = parseSource("pkg/app.py", src);
    const byName = Object.fromEntries(p.symbols.map((s) => [s.qualifiedName, s]));
    expect(byName.items).toMatchObject({ kind: "function", range: { startLine: 7, endLine: 9 }, doc: "List items." });
    expect(byName["Repo.find"]).toMatchObject({ kind: "method", range: { startLine: 12, endLine: 13 } });
    expect(p.routes.map((r) => [r.method, r.route, r.line])).toEqual([
      ["GET", "/items", 6],
      ["POST", "/items", 6],
    ]);
    expect(p.mainAt).toBe(17);
    expect(p.imports[1]).toMatchObject({ line: 2, bindings: [{ local: "q", imported: "query" }], python: { level: 1, module: "db", names: ["query"] } });
    expect(p.calls).toContainEqual({ callee: "self.load", line: 13, enclosing: "pkg/app.py#Repo.find" });
  });

  it("extracts Go functions, methods, imports and route registrations", () => {
    const src = [
      "package main", // 1
      'import store "example.com/app/internal/store"', // 2
      "// handler serves things.", // 3
      "func handler() { store.Get() }", // 4
      "func (s *Server) Start() {}", // 5
      "type Server struct{}", // 6
      'func main() { http.HandleFunc("/x", handler) }', // 7
    ].join("\n");
    const p = parseSource("main.go", src);
    expect(p.goPackage).toBe("main");
    expect(p.mainAt).toBe(7);
    expect(p.symbols.map((s) => [s.qualifiedName, s.kind, s.range.startLine, s.exported])).toEqual([
      ["handler", "function", 4, false],
      ["Server.Start", "method", 5, true],
      ["Server", "class", 6, true],
      ["main", "function", 7, false],
    ]);
    expect(p.symbols[0].doc).toBe("handler serves things.");
    expect(p.imports[0]).toMatchObject({ specifier: "example.com/app/internal/store", line: 2, bindings: [{ local: "store", imported: "*" }] });
    expect(p.routes).toEqual([{ method: "ANY", route: "/x", line: 7, framework: "go-http", handlerRef: "handler" }]);
  });

  it("falls back to line-aware regex import extraction without symbols", () => {
    const p = parseWithRegex("src/a.vue", "<script>\n// import nope from 'x'\nimport a from './a'\n</script>", undefined);
    expect(p.parser).toBe("regex");
    expect(p.symbols).toEqual([]);
    expect(p.imports).toEqual([{ specifier: "./a", line: 3, kind: "static", typeOnly: false, bindings: [] }]);
  });
});

describe("code index on fixtures", () => {
  it("records import edges with the lines they are written on, including tsconfig aliases", async () => {
    const { index } = await analyze("ts-express-api");
    const edge = (from: string, to: string) => index.importEdges.find((e) => e.fromPath === from && e.toPath === to);
    expect(edge("src/routes/users.ts", "src/services/userService.ts")?.lines).toEqual([2]);
    expect(edge("src/services/userService.ts", "src/db/client.ts")).toMatchObject({ lines: [1], typeOnly: false }); // "@/db/client"
    expect(edge("src/services/userService.ts", "src/lib/types.ts")?.typeOnly).toBe(true);
    expect(index.limits.aliasSource).toBe("tsconfig.json");
  });

  it("resolves calls only through real bindings", async () => {
    const { index } = await analyze("ts-express-api");
    const call = (from: string, to: string) => index.callEdges.find((e) => e.from === from && e.to === to);
    expect(call("src/routes/users.ts#createUserHandler", "src/services/userService.ts#createUser")?.lines).toEqual([15]);
    expect(call("src/routes/users.ts#GET /users/:id", "src/services/userService.ts#getUser")?.lines).toEqual([7]);
    // `db` is an exported instance of Database: db.findUser() → Database.findUser
    expect(call("src/services/userService.ts#getUser", "src/db/client.ts#Database.findUser")?.lines).toEqual([6]);
    // pool is `new Pool()` from "pg": the boundary is recorded, not invented edges.
    expect(index.external).toContainEqual(expect.objectContaining({ path: "src/db/client.ts", module: "pg", callee: "pool.query", enclosing: "src/db/client.ts#Database.findUser" }));
    // res.json() goes through a parameter: no edge, no external claim.
    expect(index.callEdges.some((e) => e.to.includes("json"))).toBe(false);
  });

  it("resolves Python relative imports and Go package calls", async () => {
    const py = await analyze("py-flask");
    expect(py.index.callEdges).toContainEqual(expect.objectContaining({ from: "app/routes.py#list_items", to: "app/service.py#list_items", lines: [11] }));
    expect(py.index.callEdges).toContainEqual(expect.objectContaining({ from: "app/service.py#list_items", to: "app/db.py#query", lines: [6] }));
    const go = await analyze("go-service");
    expect(go.index.callEdges).toContainEqual(expect.objectContaining({ from: "handlers.go#listProducts", to: "internal/store/store.go#All", lines: [12] }));
    expect(go.index.importEdges).toContainEqual(expect.objectContaining({ fromPath: "handlers.go", toPath: "internal/store/store.go", lines: [7] }));
  });

  it("produces the same ids, edges and layout every time", async () => {
    const a = (await (await LocalWorkspace.open(join(FIXTURES, "ts-express-api"))).get()).analysis;
    const b = (await (await LocalWorkspace.open(join(FIXTURES, "ts-express-api"))).get()).analysis;
    const ids = (x: WorkspaceAnalysis) => Object.values(x.index.files).flatMap((f) => f.symbols.map((s) => s.id)).sort();
    expect(ids(a)).toEqual(ids(b));
    expect(a.index.callEdges).toEqual(b.index.callEdges);
    expect(a.journeys.map((j) => j.id)).toEqual(b.journeys.map((j) => j.id));
    const { model: ma } = await (await LocalWorkspace.open(join(FIXTURES, "ts-express-api"))).get();
    const la = buildCityLayout(ma);
    const lb = buildCityLayout(ma);
    expect(la.buildings.map((x) => [x.id, x.x, x.z])).toEqual(lb.buildings.map((x) => [x.id, x.x, x.z]));
  });
});

describe("journeys", () => {
  it("follows an HTTP route through service, validation and persistence to the package boundary", async () => {
    const { journeys } = await analyze("ts-express-api");
    const post = journeys.find((j) => j.title === "POST /users")!;
    expect(post.steps.map((s) => [s.kind, s.name])).toEqual([
      ["entry", "createUserHandler"],
      ["call", "createUser"],
      ["call", "validateUser"],
      ["call", "Database.insertUser"],
      ["external", "pool.query"],
    ]);
    expect(post.steps[1].via).toEqual({ path: "src/routes/users.ts", line: 15 });
    expect(post.steps[4].module).toBe("pg");
    expect(post.gaps).toEqual([]);
  });

  it("covers Flask, Next.js and Go entry points", async () => {
    const flask = (await analyze("py-flask")).journeys.find((j) => j.title === "GET /items")!;
    expect(flask.steps.map((s) => s.name)).toEqual(["list_items", "list_items", "query", "sqlite3.connect", "jsonify"]);
    const next = (await analyze("next-app")).journeys.find((j) => j.title === "GET /api/orders")!;
    expect(next.steps.map((s) => [s.name, s.module])).toEqual([
      ["GET", undefined],
      ["listOrders", undefined],
      ["prisma.order.findMany", "@prisma/client"],
    ]);
    const go = (await analyze("go-service")).journeys.find((j) => j.title === "ANY /products")!;
    expect(go.steps.map((s) => s.name)).toEqual(["listProducts", "All", "json.NewEncoder"]);
  });

  it("reports an unresolvable handler as a gap instead of guessing", async () => {
    const ws = await LocalWorkspace.open(join(FIXTURES, "ts-express-api"));
    const { analysis } = await ws.get();
    // Simulate a route whose handler reference can't be resolved.
    const { findJourneyStarts, traceFrom } = await import("./journeys");
    const { buildRepoModel } = await import("../buildModel");
    const model = buildRepoModel(analysis.snapshot);
    const file = analysis.index.files["src/routes/users.ts"];
    const index = { ...analysis.index, files: { ...analysis.index.files, [file.path]: { ...file, routes: [{ method: "GET", route: "/ghost", line: 3, framework: "express-style" as const, handlerRef: "missingHandler" }] } } };
    const start = findJourneyStarts(model, index).find((s) => s.title === "GET /ghost")!;
    const j = traceFrom(index, start);
    expect(j.steps).toHaveLength(1);
    expect(j.gaps[0].reason).toMatch(/could not be resolved/);
  });
});

describe("overview and onboarding", () => {
  it("identifies project types from manifests, with evidence", async () => {
    expect((await analyze("ts-express-api")).overview.projectType.label).toBe("Node.js HTTP service (Express)");
    expect((await analyze("py-flask")).overview.projectType.label).toBe("Python web application (Flask)");
    expect((await analyze("next-app")).overview.projectType.label).toBe("Next.js web application");
    expect((await analyze("go-service")).overview.projectType.label).toBe("Go HTTP service");
    const { overview } = await analyze("ts-express-api");
    expect(overview.entryPoints[0]).toMatchObject({ path: "src/server.ts", kind: "manifest", basis: "fact", evidence: { path: "package.json", startLine: 4 } });
    expect(overview.technologies.find((t) => t.name === "Express")?.evidence).toMatchObject({ path: "package.json", startLine: 10 });
    expect(overview.commands.map((c) => c.name)).toEqual(["dev", "test"]);
    const flask = (await analyze("py-flask")).overview;
    expect(flask.entryPoints).toContainEqual(expect.objectContaining({ path: "app/cli.py", symbol: "main", kind: "manifest" }));
  });

  it("doesn't mistake a Python project's own name for a dependency", async () => {
    const { buildOverview } = await import("./overview");
    const { buildRepoModel } = await import("../buildModel");
    const { snapshotOf } = await import("../../testing/fixtures");
    const model = buildRepoModel(snapshotOf(["pyproject.toml", "src/flask/app.py"]));
    const index = { files: {}, importEdges: [], callEdges: [], external: [], limits: { eligible: 0, parsed: 0, skipped: 0, skippedLarge: 0, failed: [], withheld: [], fallback: 0, cap: 0, aliasSource: null, timedOut: false } };
    const texts = new Map([["pyproject.toml", '[project]\nname = "flask"\ndependencies = [\n  "werkzeug>=3",\n  "click>=8",\n]\n']]);
    const overview = buildOverview(model, index, texts);
    expect(overview.technologies.map((t) => t.name)).not.toContain("Flask");
    expect(overview.technologies.find((t) => t.name === "Click")?.evidence).toMatchObject({ path: "pyproject.toml", startLine: 5 });
  });

  it("builds a reading order where every item says why", async () => {
    const { onboarding } = await analyze("ts-express-api");
    expect(onboarding.readingOrder.slice(0, 3).map((i) => i.path)).toEqual(["README.md", "package.json", "src/server.ts"]);
    expect(onboarding.readingOrder.every((i) => i.reason.length > 10)).toBe(true);
    expect(onboarding.test).toEqual([expect.objectContaining({ name: "test", command: "vitest run" })]);
    expect(onboarding.representativeJourney).toMatch(/^http-/);
  });
});

describe("queries", () => {
  it("returns upstream and downstream dependencies with evidence", async () => {
    const a = await analyze("ts-express-api");
    const { buildRepoModel } = await import("../buildModel");
    const model = buildRepoModel(a.snapshot);
    const deps = dependenciesOf(model, a.index, { kind: "file", id: "src/services/userService.ts" });
    expect(deps.upstream.filter((r) => r.kind === "import").map((r) => r.path).sort()).toEqual(["src/routes/users.ts", "test/userService.test.ts"]);
    expect(deps.downstream.filter((r) => r.kind === "import").map((r) => r.path)).toContain("src/db/client.ts");
    expect(deps.downstream.find((r) => r.id === "src/db/client.ts#Database.findUser")?.evidence).toEqual({ path: "src/services/userService.ts", lines: [6] });
    expect(relatedTests(model, a.index, "src/services/userService.ts")).toEqual([
      { path: "test/userService.test.ts", basis: "static-analysis", reason: "imports src/services/userService.ts (line 2)" },
    ]);
  });

  it("ranks symbol search by name match", async () => {
    const a = await analyze("ts-express-api");
    const hits = searchSymbols(a.index, "createUser");
    expect(hits[0].symbol.qualifiedName).toBe("createUser");
    expect(hits.map((h) => h.symbol.qualifiedName)).toContain("createUserHandler");
    expect(searchSymbols(a.index, "find user").map((h) => h.symbol.qualifiedName)).toContain("Database.findUser");
  });
});
