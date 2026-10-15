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
  await prepareLanguages(["a.ts", "a.tsx", "a.js", "a.py", "a.go", "a.rs", "a.java"]);
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

  it("extracts Rust items, impl methods, use trees, typed receivers and routes", () => {
    const src = [
      "use crate::store::{self, Store, User as U};", // 1
      "pub use users::UserStore;", // 2
      "use super::util::*;", // 3
      "mod routes;", // 4
      "/// Fetches one user.", // 5
      '#[get("/users/{id}")]', // 6
      "pub async fn get_user(State(db): State<Arc<Store>>, id: u32) -> String {", // 7
      "    let cached: Option<U> = None;", // 8
      "    db.find(id).await;", // 9
      "    store::helper();", // 10
      "    Store::open();", // 11
      '    println!("{}", id);', // 12
      "    String::new()", // 13
      "}", // 14
      "pub struct Service { repo: Store }", // 15
      "impl Service {", // 16
      "    pub fn run(&self) { self.repo.find(1); self.stop(); Self::make(); }", // 17
      "    fn stop(&self) {}", // 18
      "}", // 19
      "impl Display for Service { fn fmt(&self) {} }", // 20
      "pub trait Repo { fn find(&self, id: u32); }", // 21
      "fn main() {", // 22
      '    let app = Router::new().route("/users", get(list).post(routes::create));', // 23
      "}", // 24
    ].join("\n");
    const p = parseSource("crates/api/src/main.rs", src);
    expect(p.parser).toBe("tree-sitter");
    expect(p.partial).toBeUndefined();
    expect(p.mainAt).toBe(22);
    const byName = Object.fromEntries(p.symbols.map((s) => [s.qualifiedName, s]));
    expect(byName.get_user).toMatchObject({ kind: "function", exported: true, range: { startLine: 7, endLine: 14 }, doc: "Fetches one user." });
    expect(byName["Service.run"]).toMatchObject({ kind: "method", exported: true, range: { startLine: 17, endLine: 17 } });
    expect(byName["Service.stop"]).toMatchObject({ kind: "method", exported: false });
    expect(byName["Service.fmt"]).toMatchObject({ kind: "method", exported: true });
    expect(byName.Service).toMatchObject({ kind: "class", range: { startLine: 15, endLine: 15 } });
    expect(byName.Repo).toMatchObject({ kind: "interface" });
    expect(byName["Repo.find"]).toMatchObject({ kind: "method", range: { startLine: 21, endLine: 21 } });

    expect(p.imports.map((i) => [i.line, i.specifier, i.kind, i.bindings])).toEqual([
      [1, "crate::store", "static", [{ local: "store", imported: "store" }]],
      [1, "crate::store::Store", "static", [{ local: "Store", imported: "Store" }]],
      [1, "crate::store::User", "static", [{ local: "U", imported: "User" }]],
      [2, "users::UserStore", "reexport", [{ local: "UserStore", imported: "UserStore" }]],
      [3, "super::util::*", "static", [{ local: "*", imported: "*" }]],
      [4, "mod routes", "static", [{ local: "routes", imported: "*" }]],
    ]);
    expect(p.imports[5].rust).toEqual({ path: ["self", "routes"], glob: false, isMod: true });

    const calls = p.calls.map((c) => [c.callee, c.line, c.receiverType, c.enclosing?.split("#")[1]]);
    expect(calls).toContainEqual(["db.find", 9, "Store", "get_user"]);
    expect(calls).toContainEqual(["store::helper", 10, undefined, "get_user"]);
    expect(calls).toContainEqual(["Store::open", 11, undefined, "get_user"]);
    expect(calls).toContainEqual(["String::new", 13, undefined, "get_user"]);
    expect(calls).toContainEqual(["self.repo.find", 17, "Store", "Service.run"]);
    expect(calls).toContainEqual(["self.stop", 17, undefined, "Service.run"]);
    expect(calls).toContainEqual(["Service::make", 17, undefined, "Service.run"]);
    expect(calls.some((c) => c[0] === "println")).toBe(false);

    expect(p.routes).toEqual([
      { method: "GET", route: "/users/{id}", line: 6, framework: "rust-attribute", handler: "crates/api/src/main.rs#get_user" },
      { method: "GET", route: "/users", line: 23, framework: "axum", handlerRef: "list" },
      { method: "POST", route: "/users", line: 23, framework: "axum", handlerRef: "routes::create" },
    ]);
    // `fn main` only counts in a binary crate root.
    expect(parseSource("crates/api/src/lib.rs", "fn main() {}").mainAt).toBeUndefined();
    // Routes built in tests aren't the product's routes.
    const tests = parseSource(
      "src/lib.rs",
      ['#[cfg(test)]', "mod tests {", '    fn app() { Router::new().route("/x", get(h)); }', "}", "#[tokio::test]", 'async fn it_works() { Router::new().route("/y", get(h)); }', '#[get("/z")]', "#[test]", "fn attr() {}"].join("\n"),
    );
    expect(tests.routes).toEqual([]);
    expect(tests.symbols.map((s) => s.qualifiedName)).toEqual(["tests.app", "it_works", "attr"]);
  });

  it("extracts Java types, overloads, typed receivers, imports and Spring mappings", () => {
    const src = [
      "package com.example.web;", // 1
      "import com.example.service.UserService;", // 2
      "import com.example.util.*;", // 3
      "import static com.example.util.Strings.trim;", // 4
      "/** Users API. */", // 5
      "@RestController", // 6
      '@RequestMapping("/users")', // 7
      "public class UserController {", // 8
      "  private final UserService service;", // 9
      "  public UserController(UserService service) { this.service = service; }", // 10
      '  @GetMapping("/{id}")', // 11
      "  public User get(@PathVariable long id) { return service.find(id); }", // 12
      '  @RequestMapping(path = "/search", method = RequestMethod.POST)', // 13
      "  public void search(String q) {", // 14
      "    var found = new Finder(q);", // 15
      "    found.run(trim(q));", // 16
      "    this.service.find(1, 2);", // 17
      "    helper();", // 18
      "  }", // 19
      "  void helper() {}", // 20
      "  void helper(int x) {}", // 21
      "  interface Hook { void on(); }", // 22
      "  public static void main(String[] args) { SpringApplication.run(UserController.class, args); }", // 23
      "}", // 24
    ].join("\n");
    const p = parseSource("src/main/java/com/example/web/UserController.java", src);
    expect(p.parser).toBe("tree-sitter");
    expect(p.javaPackage).toBe("com.example.web");
    expect(p.mainAt).toBe(23);
    const byId = Object.fromEntries(p.symbols.map((s) => [s.id.split("#")[1], s]));
    expect(byId.UserController).toMatchObject({ kind: "class", exported: true, range: { startLine: 6, endLine: 24 }, doc: "Users API." });
    expect(byId["UserController.service"]).toMatchObject({ kind: "variable", instanceOf: "UserService", exported: false });
    expect(byId["UserController.UserController"]).toMatchObject({ kind: "method", params: 1, range: { startLine: 10, endLine: 10 } });
    expect(byId["UserController.get"]).toMatchObject({ kind: "method", exported: true, params: 1, range: { startLine: 11, endLine: 12 } });
    expect(byId["UserController.helper"]).toMatchObject({ params: 0, range: { startLine: 20, endLine: 20 } });
    expect(byId["UserController.helper@21"]).toMatchObject({ params: 1 });
    expect(byId["UserController.Hook"]).toMatchObject({ kind: "interface" });
    expect(byId["UserController.Hook.on"]).toMatchObject({ kind: "method", exported: true });

    expect(p.imports.map((i) => [i.line, i.specifier, i.bindings, i.java])).toEqual([
      [2, "com.example.service.UserService", [{ local: "UserService", imported: "UserService" }], { static: false, wildcard: false }],
      [3, "com.example.util.*", [{ local: "*", imported: "*" }], { static: false, wildcard: true }],
      [4, "com.example.util.Strings.trim", [{ local: "trim", imported: "Strings.trim" }], { static: true, wildcard: false }],
    ]);

    const calls = p.calls.map((c) => [c.callee, c.line, c.receiverType, c.argCount, c.enclosing?.split("#")[1]]);
    expect(calls).toContainEqual(["service.find", 12, "UserService", 1, "UserController.get"]);
    expect(calls).toContainEqual(["new:Finder", 15, undefined, 1, "UserController.search"]);
    expect(calls).toContainEqual(["found.run", 16, "Finder", 1, "UserController.search"]);
    expect(calls).toContainEqual(["trim", 16, undefined, 1, "UserController.search"]);
    expect(calls).toContainEqual(["this.service.find", 17, "UserService", 2, "UserController.search"]);
    expect(calls).toContainEqual(["helper", 18, undefined, 0, "UserController.search"]);
    expect(calls).toContainEqual(["SpringApplication.run", 23, undefined, 2, "UserController.main"]);

    expect(p.routes).toEqual([
      { method: "GET", route: "/users/{id}", line: 11, framework: "spring", handler: "src/main/java/com/example/web/UserController.java#UserController.get" },
      { method: "POST", route: "/users/search", line: 13, framework: "spring", handler: "src/main/java/com/example/web/UserController.java#UserController.search" },
    ]);
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

  it("resolves Rust module paths across a Cargo workspace, mod.rs and `pub use`", async () => {
    const { index } = await analyze("rust-axum");
    expect(index.rustCrates?.map((c) => [c.name, c.lib ?? null, c.bins])).toEqual([
      ["storage", "crates/storage/src/lib.rs", []],
      ["api", null, ["crates/api/src/main.rs"]],
    ]);
    const imports = index.importEdges.map((e) => [e.fromPath, e.toPath, e.lines]);
    expect(imports).toEqual([
      ["crates/api/src/main.rs", "crates/api/src/routes.rs", [1]], // mod routes;
      ["crates/api/src/main.rs", "crates/storage/src/lib.rs", [5]], // use storage::UserStore (workspace crate)
      ["crates/api/src/routes.rs", "crates/storage/src/lib.rs", [4]],
      ["crates/storage/src/lib.rs", "crates/storage/src/users/mod.rs", [2, 4]], // pub mod users; pub use users::{…}
    ]);
    const calls = index.callEdges.map((e) => [e.from.split("/src/")[1], e.to.split("/src/")[1], e.lines]);
    expect(calls).toEqual([
      // `UserStore::connect` through `use storage::UserStore` and the crate's `pub use`.
      ["main.rs#main", "users/mod.rs#UserStore.connect", [10]],
      ["routes.rs#create_user", "routes.rs#normalize", [13]],
      // `store` is declared `State(store): State<UserStore>`.
      ["routes.rs#create_user", "users/mod.rs#UserStore.insert", [14]],
      ["routes.rs#get_user", "users/mod.rs#UserStore.find", [19]],
    ]);
    expect(index.external).toContainEqual({ path: "crates/storage/src/users/mod.rs", line: 22, module: "sqlx", callee: "sqlx::query_scalar", enclosing: "crates/storage/src/users/mod.rs#UserStore.insert" });
    expect(index.external).toContainEqual(expect.objectContaining({ line: 16, module: "sqlx", callee: "PgPool::connect" }));
    // Prelude types are neither edges nor claimed packages.
    expect(index.external.some((x) => x.module === "String" || x.module === "Vec")).toBe(false);
  });

  it("resolves Java imports, same-package types and constructor-injected fields", async () => {
    const { index } = await analyze("java-spring");
    const J = "src/main/java/com/example/demo/";
    const short = (p: string) => p.replace(J, "");
    expect(index.importEdges.map((e) => [short(e.fromPath), short(e.toPath), e.lines])).toEqual([
      ["repo/UserRepository.java", "model/User.java", [3]],
      ["service/UserService.java", "model/User.java", [3]],
      ["service/UserService.java", "repo/UserRepository.java", [4]],
      ["web/UserController.java", "model/User.java", [3]],
      ["web/UserController.java", "service/UserService.java", [4]],
    ]);
    const call = (from: string, to: string) => index.callEdges.find((e) => e.from === `${J}${from}` && e.to === `${J}${to}`)?.lines;
    // `users` is a field declared `UserService users`, assigned from the constructor.
    expect(call("web/UserController.java#UserController.create", "service/UserService.java#UserService.register")).toEqual([19]);
    expect(call("service/UserService.java#UserService.register", "repo/UserRepository.java#UserRepository.insert")).toEqual([20]);
    // AuditLog is in the same package, so it needs no import.
    expect(call("service/UserService.java#UserService.register", "service/AuditLog.java#AuditLog.record")).toEqual([21]);
    expect(call("service/UserService.java#UserService.register", "service/UserService.java#UserService.normalize")).toEqual([19]);
    expect(index.external).toContainEqual({
      path: `${J}repo/UserRepository.java`,
      line: 16,
      module: "org.springframework.jdbc.core",
      callee: "jdbc.queryForObject",
      enclosing: `${J}repo/UserRepository.java#UserRepository.insert`,
    });
    // `input.name()` is a record component accessor, not a declared method: no edge.
    expect(index.callEdges.some((e) => e.to.endsWith("#User.name"))).toBe(false);
  });

  it("picks Java overloads by argument count and draws no edge when that is ambiguous", async () => {
    const { buildRepoModel } = await import("../buildModel");
    const { snapshotOf } = await import("../../testing/fixtures");
    const { SymbolResolver } = await import("./buildIndex");
    const path = "src/main/java/a/A.java";
    const p = parseSource(
      path,
      ["package a;", "class A {", "  void run() { f(); g(1); }", "  void f() {}", "  void f(int x) {}", "  void g(int x) {}", "  void g(String s) {}", "}"].join("\n"),
    );
    const resolver = new SymbolResolver({ [path]: p }, buildRepoModel(snapshotOf([path])));
    const [f, g] = p.calls;
    expect(resolver.resolveCall(p, f)).toMatchObject({ kind: "symbol", symbol: { id: `${path}#A.f`, params: 0 } });
    expect(resolver.resolveCall(p, g)).toBeUndefined();
  });

  it("produces the same ids, edges and layout every time", async () => {
    const a = (await (await LocalWorkspace.open(join(FIXTURES, "ts-express-api"))).get()).analysis;
    const b = (await (await LocalWorkspace.open(join(FIXTURES, "ts-express-api"))).get()).analysis;
    const ids = (x: WorkspaceAnalysis) => Object.values(x.index.files).flatMap((f) => f.symbols.map((s) => s.id)).sort();
    expect(ids(a)).toEqual(ids(b));
    expect(a.index.callEdges).toEqual(b.index.callEdges);
    expect(a.journeys.map((j) => j.id)).toEqual(b.journeys.map((j) => j.id));
    for (const name of ["rust-axum", "java-spring"]) {
      const x = (await (await LocalWorkspace.open(join(FIXTURES, name))).get()).analysis;
      const y = (await (await LocalWorkspace.open(join(FIXTURES, name))).get()).analysis;
      expect(ids(x)).toEqual(ids(y));
      expect(x.index.callEdges).toEqual(y.index.callEdges);
      expect(x.journeys.map((j) => j.id)).toEqual(y.journeys.map((j) => j.id));
    }
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

  it("follows Rust and Java routes to the repository and the package boundary", async () => {
    const rust = await analyze("rust-axum");
    const post = rust.journeys.find((j) => j.title === "POST /users")!;
    expect(post.start).toEqual({ path: "crates/api/src/main.rs", line: 12, label: "axum route" });
    expect(post.steps.map((s) => [s.kind, s.name, s.via ? `${s.via.path}:${s.via.line}` : null, s.module ?? null])).toEqual([
      ["entry", "create_user", null, null],
      ["call", "UserStore.insert", "crates/api/src/routes.rs:14", null],
      ["external", "sqlx::query_scalar", "crates/storage/src/users/mod.rs:22", "sqlx"],
      ["external", "Json", "crates/api/src/routes.rs:15", "axum"],
    ]);
    expect(post.gaps).toEqual([]);
    const main = rust.journeys.find((j) => j.kind === "main")!;
    expect(main.steps.slice(0, 3).map((s) => s.name)).toEqual(["main", "UserStore.connect", "PgPool::connect"]);

    const java = await analyze("java-spring");
    const create = java.journeys.find((j) => j.title === "POST /users")!;
    expect(create.start).toMatchObject({ line: 17, label: "spring route" });
    expect(create.steps.map((s) => [s.kind, s.name, s.module ?? null])).toEqual([
      ["entry", "UserController.create", null],
      ["call", "UserService.register", null],
      ["call", "UserRepository.insert", null],
      ["external", "jdbc.queryForObject", "org.springframework.jdbc.core"],
      ["call", "AuditLog.record", null],
      ["call", "User", null],
    ]);
    // An interface call reaches the declaration; what runs there is decided at runtime.
    expect(create.gaps).toEqual([
      {
        atStep: 4,
        reason: "`AuditLog.record` is declared on an interface; the implementation is chosen at runtime and isn't followed",
        path: "src/main/java/com/example/demo/service/UserService.java",
        line: 21,
      },
    ]);
    expect(java.journeys.find((j) => j.title === "GET /users/{id}")).toBeDefined();
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

  it("reads Cargo.toml and pom.xml for Rust and Java projects", async () => {
    const rust = (await analyze("rust-axum")).overview;
    expect(rust.projectType.label).toBe("Monorepo (2 packages): Rust HTTP service (axum)");
    expect(rust.technologies).toContainEqual(expect.objectContaining({ name: "axum", basis: "fact", evidence: { path: "crates/api/Cargo.toml", startLine: 7, endLine: 7 } }));
    expect(rust.technologies).toContainEqual(expect.objectContaining({ name: "SQLx", evidence: { path: "crates/storage/Cargo.toml", startLine: 7, endLine: 7 } }));
    expect(rust.entryPoints.map((e) => [e.kind, e.path, e.evidence.startLine])).toEqual([
      ["main", "crates/api/src/main.rs", 9],
      ["http-route", "crates/api/src/main.rs", 12],
    ]);
    expect(rust.commands.map((c) => c.command)).toEqual(["cargo build", "cargo test", "cargo run -p api"]);
    expect(rust.limitations.join(" ")).not.toMatch(/No code parser yet/);

    const java = (await analyze("java-spring")).overview;
    expect(java.projectType.label).toBe("Java web application (Spring Boot)");
    expect(java.technologies).toContainEqual(expect.objectContaining({ name: "Spring MVC", evidence: { path: "pom.xml", startLine: 17, endLine: 17 } }));
    expect(java.technologies.map((t) => t.name)).not.toContain("demo");
    expect(java.entryPoints.map((e) => [e.kind, e.path.split("/").pop(), e.evidence.startLine])).toEqual([
      ["main", "DemoApplication.java", 8],
      ["http-route", "UserController.java", 17],
    ]);
    expect(java.commands.map((c) => [c.command, c.evidence.startLine])).toEqual([
      ["mvn test", 2],
      ["mvn spring-boot:run", 33],
    ]);
  });

  it("reads Gradle builds and Cargo dependency tables", async () => {
    const { buildOverview } = await import("./overview");
    const { buildRepoModel } = await import("../buildModel");
    const { snapshotOf } = await import("../../testing/fixtures");
    const index = { files: {}, importEdges: [], callEdges: [], external: [], limits: { eligible: 0, parsed: 0, skipped: 0, skippedLarge: 0, failed: [], withheld: [], fallback: 0, cap: 0, aliasSource: null, timedOut: false } };
    const gradle = buildOverview(
      buildRepoModel(snapshotOf(["build.gradle.kts", "gradlew", "src/main/java/a/App.java"])),
      index,
      new Map([["build.gradle.kts", 'plugins {\n  id("org.springframework.boot") version "3.3.4"\n}\ndependencies {\n  implementation("org.springframework.boot:spring-boot-starter-webflux")\n  testImplementation("org.junit.jupiter:junit-jupiter")\n}\n']]),
    );
    expect(gradle.projectType.label).toBe("Java web application (Spring Boot)");
    expect(gradle.technologies.map((t) => [t.name, t.evidence.startLine])).toEqual(expect.arrayContaining([["Spring Boot", 2], ["Spring WebFlux", 5], ["JUnit 5", 6]]));
    expect(gradle.commands.map((c) => c.command)).toEqual(["./gradlew test", "./gradlew bootRun"]);

    const cargo = buildOverview(
      buildRepoModel(snapshotOf(["Cargo.toml", "src/lib.rs"])),
      { ...index, rustCrates: [{ name: "kit", dir: "", lib: "src/lib.rs", bins: [] }] },
      new Map([["Cargo.toml", '[package]\nname = "kit"\n\n[dependencies.tokio]\nversion = "1"\n\n[dev-dependencies]\nreqwest = "0.12"\n']]),
    );
    expect(cargo.projectType.label).toBe("Rust library");
    expect(cargo.technologies.map((t) => [t.name, t.evidence.startLine])).toEqual(expect.arrayContaining([["Tokio", 4], ["reqwest", 8]]));
    expect(cargo.commands.map((c) => c.command)).toEqual(["cargo build", "cargo test"]);

    // The axum repository's own crates depend on axum: that doesn't make it an axum service.
    const own = buildOverview(
      buildRepoModel(snapshotOf(["Cargo.toml", "axum/Cargo.toml", "axum/src/lib.rs", "axum-extra/Cargo.toml", "axum-extra/src/lib.rs"])),
      { ...index, rustCrates: [{ name: "axum", dir: "axum", lib: "axum/src/lib.rs", bins: [] }, { name: "axum_extra", dir: "axum-extra", lib: "axum-extra/src/lib.rs", bins: [] }] },
      new Map([["axum-extra/Cargo.toml", '[package]\nname = "axum-extra"\n\n[dependencies]\naxum = { path = "../axum" }\n']]),
    );
    expect(own.technologies.map((t) => t.name)).not.toContain("axum");
    expect(own.projectType.label).toBe("Monorepo (2 packages): Rust library");
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
