import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { ViewerLauncher } from "../cli/viewer";
import { buildDeepLink } from "../cli/viewer";
import { parseArgs } from "../cli/index";
import { MAX_RESULT_CHARS } from "./context";
import { createCodescapeServer } from "./server";

const FIXTURE = join(process.cwd(), "test", "fixtures", "ts-express-api");

/** A viewer that never starts a process: tests only care about the link. */
const fakeViewer: ViewerLauncher = {
  ensure: async () => ({ url: "http://127.0.0.1:4317", port: 4317, started: false }),
  link: buildDeepLink,
  stop: () => {},
};

let client: Client;

type ToolResult = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as ToolResult;
const text = (r: ToolResult) => r.content.map((c) => c.text ?? "").join("\n");

beforeAll(async () => {
  const { server } = await createCodescapeServer({ root: FIXTURE, viewer: fakeViewer });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client?.close();
});

describe("MCP server contract", () => {
  it("lists the seven tools with input and output schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "explain_module",
      "find_code",
      "get_codebase_overview",
      "get_dependencies",
      "get_onboarding_guide",
      "open_in_codescape",
      "trace_code_path",
    ]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema?.type).toBe("object");
      expect(t.description!.length).toBeGreaterThan(60);
    }
  });

  it("states the analysed root and honesty rules in its instructions", () => {
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain(FIXTURE);
    expect(instructions).toMatch(/heuristic/);
    expect(instructions.length).toBeLessThan(4096);
  });

  it("get_codebase_overview returns labelled, evidenced facts", async () => {
    const r = await call("get_codebase_overview");
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as { projectType: { label: string; basis: string }; technologies: { name: string; evidence: string }[]; journeys: { title: string }[]; workspace: { root: string } };
    expect(s.workspace.root).toBe(FIXTURE);
    expect(s.projectType).toMatchObject({ label: "Node.js HTTP service (Express)", basis: "heuristic" });
    expect(s.technologies).toContainEqual({ name: "Express", category: "framework", evidence: "package.json:10" });
    expect(s.journeys.map((j) => j.title)).toEqual(["POST /users", "GET /users/:id"]);
    expect(text(r)).toContain("Limitations:");
  });

  it("find_code returns symbols with locations and ids", async () => {
    const r = await call("find_code", { query: "createUser" });
    const results = (r.structuredContent as { results: { type: string; path: string; line: number; symbolId: string | null }[] }).results;
    expect(results[0]).toMatchObject({ type: "symbol", path: "src/services/userService.ts", line: 9, symbolId: "src/services/userService.ts#createUser" });
    const content = await call("find_code", { query: "select * from users", kind: "content" });
    expect((content.structuredContent as { results: { path: string; line: number }[] }).results[0]).toMatchObject({ path: "src/db/client.ts", line: 9 });
  });

  it("explain_module gathers evidence and labels the role as a hypothesis", async () => {
    const r = await call("explain_module", { target: "src/services/userService.ts" });
    const s = r.structuredContent as {
      symbols: { name: string; lines: string }[];
      importedBy: { path: string; evidence: string }[];
      roleHypothesis: { label: string; basis: string };
      relatedTests: { path: string }[];
      excerpt: { text: string };
    };
    expect(s.symbols.map((x) => [x.name, x.lines])).toEqual([
      ["getUser", "src/services/userService.ts:5-7"],
      ["createUser", "src/services/userService.ts:9-12"],
    ]);
    expect(s.importedBy).toContainEqual({ path: "src/routes/users.ts", evidence: "src/routes/users.ts:2" });
    expect(s.roleHypothesis).toMatchObject({ label: "Business logic", basis: "heuristic" });
    expect(s.relatedTests.map((t) => t.path)).toEqual(["test/userService.test.ts"]);
    expect(s.excerpt.text).toContain("export async function getUser");
  });

  it("get_dependencies resolves names and follows transitive edges", async () => {
    const r = await call("get_dependencies", { target: "getUser", direction: "downstream", depth: 2 });
    const s = r.structuredContent as { target: { id: string }; downstream: { id: string; evidence: string; depth: number }[]; externalPackages: string[] };
    expect(s.target.id).toBe("src/services/userService.ts#getUser");
    expect(s.downstream[0]).toMatchObject({ id: "src/db/client.ts#Database.findUser", evidence: "src/services/userService.ts:6", depth: 1 });
  });

  it("trace_code_path follows a route to the package boundary", async () => {
    const r = await call("trace_code_path", { query: "POST /users" });
    const s = r.structuredContent as { found: boolean; journey: { steps: { name: string; kind: string; calledAt: string | null; module: string | null }[] } };
    expect(s.found).toBe(true);
    expect(s.journey.steps.map((x) => x.name)).toEqual(["createUserHandler", "createUser", "validateUser", "Database.insertUser", "pool.query"]);
    expect(s.journey.steps[1].calledAt).toBe("src/routes/users.ts:15");
    expect(s.journey.steps[4]).toMatchObject({ kind: "external", module: "pg" });
    const none = await call("trace_code_path", { query: "zzzz nothing here" });
    expect((none.structuredContent as { found: boolean }).found).toBe(false);
  });

  it("get_onboarding_guide gives reasons and commands", async () => {
    const r = await call("get_onboarding_guide");
    const s = r.structuredContent as { readingOrder: { location: string; reason: string }[]; test: { command: string }[] };
    expect(s.readingOrder[0].location).toBe("README.md");
    expect(s.readingOrder.every((i) => i.reason.length > 0)).toBe(true);
    expect(s.test[0].command).toBe("vitest run");
    const focused = await call("get_onboarding_guide", { focus: "src/db" });
    expect((focused.structuredContent as { focus: string }).focus).toBe("src/db");
  });

  it("open_in_codescape returns a deep link for a symbol or journey", async () => {
    const r = await call("open_in_codescape", { target: "createUser" });
    const url = new URL((r.structuredContent as { url: string }).url);
    expect(url.pathname).toBe("/local");
    expect(url.searchParams.get("select")).toBe("src/services/userService.ts");
    expect(url.searchParams.get("symbol")).toBe("src/services/userService.ts#createUser");
    const bad = await call("open_in_codescape", { journey: "nope" });
    expect(bad.isError).toBe(true);
  });

  it("serves the overview resource and the prompts", async () => {
    const res = await client.readResource({ uri: "codescape://overview" });
    expect((res.contents[0] as { text: string }).text).toContain("## Entry points");
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["investigate", "onboard"]);
  });
});

describe("MCP tools on Rust and Java repositories", () => {
  const connect = async (fixture: string) => {
    const { server } = await createCodescapeServer({ root: join(process.cwd(), "test", "fixtures", fixture), viewer: fakeViewer });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const c = new Client({ name: "test", version: "1.0.0" });
    await c.connect(clientSide);
    return c;
  };
  type Trace = { found: boolean; journey: { steps: { name: string; kind: string; calledAt: string | null; module: string | null }[]; gaps: { reason: string; location: string }[] } };

  it("traces an axum route through a workspace crate to sqlx", async () => {
    const c = await connect("rust-axum");
    try {
      const overview = (await c.callTool({ name: "get_codebase_overview", arguments: {} })) as ToolResult;
      expect((overview.structuredContent as { projectType: { label: string } }).projectType.label).toBe("Monorepo (2 packages): Rust HTTP service (axum)");
      const r = (await c.callTool({ name: "trace_code_path", arguments: { query: "POST /users" } })) as ToolResult;
      const s = r.structuredContent as Trace;
      expect(s.found).toBe(true);
      expect(s.journey.steps.map((x) => [x.name, x.calledAt, x.module])).toEqual([
        ["create_user", null, null],
        ["UserStore.insert", "crates/api/src/routes.rs:14", null],
        ["sqlx::query_scalar", "crates/storage/src/users/mod.rs:22", "sqlx"],
        ["Json", "crates/api/src/routes.rs:15", "axum"],
      ]);
    } finally {
      await c.close();
    }
  });

  it("traces a Spring mapping through injected services to JdbcTemplate, with the interface call as a gap", async () => {
    const c = await connect("java-spring");
    try {
      const r = (await c.callTool({ name: "trace_code_path", arguments: { query: "POST /users" } })) as ToolResult;
      const s = r.structuredContent as Trace;
      const J = "src/main/java/com/example/demo/";
      expect(s.journey.steps.slice(0, 4).map((x) => [x.name, x.calledAt, x.module])).toEqual([
        ["UserController.create", null, null],
        ["UserService.register", `${J}web/UserController.java:19`, null],
        ["UserRepository.insert", `${J}service/UserService.java:20`, null],
        ["jdbc.queryForObject", `${J}repo/UserRepository.java:16`, "org.springframework.jdbc.core"],
      ]);
      expect(s.journey.gaps).toEqual([expect.objectContaining({ location: `${J}service/UserService.java:21` })]);
      const deps = (await c.callTool({ name: "get_dependencies", arguments: { target: "UserService.register", direction: "downstream" } })) as ToolResult;
      expect(JSON.stringify(deps.structuredContent)).toContain(`${J}repo/UserRepository.java#UserRepository.insert`);
    } finally {
      await c.close();
    }
  });
});

describe("MCP server security and validation", () => {
  it("rejects paths outside the repository", async () => {
    for (const target of ["../../package.json", "/etc/passwd", "src/../../x"]) {
      const r = await call("explain_module", { target });
      expect(r.isError, target).toBe(true);
      expect(text(r)).toMatch(/outside|Absolute|not accepted/i);
    }
  });

  it("rejects invalid input against the schema", async () => {
    const r = await call("find_code", { query: "" });
    expect(r.isError).toBe(true);
    const r2 = await call("get_dependencies", { target: "src/app.ts", depth: 9 });
    expect(r2.isError).toBe(true);
  });

  it("keeps every result under the size ceiling", async () => {
    for (const [name, args] of [
      ["get_codebase_overview", {}],
      ["get_onboarding_guide", {}],
      ["explain_module", { target: "src" }],
    ] as const) {
      const r = await call(name, args);
      expect(text(r).length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    }
  });
});

describe("CLI", () => {
  it("resolves the root from flags, CODESCAPE_ROOT, then CLAUDE_PROJECT_DIR", () => {
    expect(parseArgs(["mcp", "--root", "/tmp/a"], {}).root).toBe("/tmp/a");
    expect(parseArgs(["mcp"], { CODESCAPE_ROOT: "/tmp/b", CLAUDE_PROJECT_DIR: "/tmp/c" }).root).toBe("/tmp/b");
    expect(parseArgs(["mcp"], { CLAUDE_PROJECT_DIR: "/tmp/c" }).root).toBe("/tmp/c");
    expect(() => parseArgs(["mcp", "--bogus"], {})).toThrow(/Unknown option/);
  });
});

describe("stdio transport (built CLI)", () => {
  const cli = join(process.cwd(), "dist", "cli.mjs");

  it.skipIf(!existsSync(cli))("speaks only JSON-RPC on stdout", async () => {
    const child = spawn(process.execPath, [cli, "mcp", "--root", FIXTURE], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: string[] = [];
    let buffer = "";
    const responses = new Map<number, Record<string, unknown>>();
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        stdout.push(line);
        const msg = JSON.parse(line) as { id?: number };
        if (typeof msg.id === "number") responses.set(msg.id, msg);
      }
    });
    const send = (msg: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
    const waitFor = async (id: number) => {
      for (let i = 0; i < 200 && !responses.has(id); i++) await new Promise((r) => setTimeout(r, 50));
      return responses.get(id);
    };

    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } } });
    const init = (await waitFor(1)) as { result?: { serverInfo?: { name: string } } };
    expect(init?.result?.serverInfo?.name).toBe("codescape");
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/call", params: { name: "get_codebase_overview", arguments: {} } });
    const overview = (await waitFor(2)) as { result?: { structuredContent?: { projectType: { label: string } } } };
    expect(overview?.result?.structuredContent?.projectType.label).toBe("Node.js HTTP service (Express)");
    child.kill();
    // Every line on stdout parsed as JSON above; nothing else was written there.
    expect(stdout.every((l) => l.startsWith("{"))).toBe(true);
  }, 30_000);
});
