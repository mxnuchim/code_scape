import { afterEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { clearGitHubWorkspaceCache } from "../lib/remote/githubWorkspace";
import { createRemoteMcpHandler, repoFromMcpUrl } from "./remote";

const FIXTURE = join(process.cwd(), "test", "fixtures", "ts-express-api");
const SITE = "https://codescape.example";

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** GitHub, played by a fixture on disk: the REST API for metadata and the tree, raw.githubusercontent.com for contents. */
function fakeGitHub(log: { url: string; auth: string | null }[]) {
  const files = listFiles(FIXTURE).map((f) => relative(FIXTURE, f));
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    log.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (url === "https://api.github.com/repos/acme/api") {
      return Response.json({
        name: "api",
        full_name: "acme/api",
        owner: { login: "acme" },
        description: "Fixture",
        default_branch: "main",
        stargazers_count: 1,
        forks_count: 0,
        open_issues_count: 0,
        language: "TypeScript",
        html_url: "https://github.com/acme/api",
        pushed_at: null,
        size: 10,
        license: null,
        fork: false,
        archived: false,
      });
    }
    if (url.startsWith("https://api.github.com/repos/acme/api/git/trees/main")) {
      return Response.json({ tree: files.map((path) => ({ path, type: "blob", size: statSync(join(FIXTURE, path)).size })), truncated: false });
    }
    const raw = /^https:\/\/raw\.githubusercontent\.com\/acme\/api\/main\/(.+)$/.exec(url);
    if (raw) {
      const path = decodeURIComponent(raw[1]);
      return files.includes(path) ? new Response(readFileSync(join(FIXTURE, path), "utf8")) : new Response("404", { status: 404 });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  }) as typeof fetch;
}

async function connect(path: string, log: { url: string; auth: string | null }[] = []) {
  const handler = createRemoteMcpHandler({ fetchImpl: fakeGitHub(log), token: "test-token", siteUrl: SITE });
  // The client's HTTP requests go straight into the handler, as Next's route would pass them.
  const transport = new StreamableHTTPClientTransport(new URL(path, SITE), { fetch: (input, init) => handler.fetch(new Request(input, init)) });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return { client, handler };
}

type ToolResult = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

afterEach(() => clearGitHubWorkspaceCache());

describe("hosted MCP endpoint", () => {
  it("only accepts /api/mcp/<owner>/<repo> with safe names", () => {
    expect(repoFromMcpUrl(new URL("https://x/api/mcp/pallets/flask"))).toEqual({ owner: "pallets", repo: "flask" });
    expect(repoFromMcpUrl(new URL("https://x/api/mcp/vercel/next.js?ref=canary"))).toEqual({ owner: "vercel", repo: "next.js", ref: "canary" });
    expect(repoFromMcpUrl(new URL("https://x/api/mcp/a/..%2F..%2Fetc"))).toBeNull();
    expect(repoFromMcpUrl(new URL("https://x/api/mcp/-bad/repo"))).toBeNull();
    expect(repoFromMcpUrl(new URL("https://x/api/mcp/a/b?ref=../x"))).toBeNull();
    expect(repoFromMcpUrl(new URL("https://x/api/mcp/only-owner"))).toBeNull();
  });

  it("answers a bad path with 404 and directions", async () => {
    const handler = createRemoteMcpHandler({ fetchImpl: fakeGitHub([]) });
    const res = await handler.fetch(new Request(`${SITE}/api/mcp/nope`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("/api/mcp/<owner>/<repo>");
  });

  it("serves the same tools as the local server, reading the repository from GitHub", async () => {
    const log: { url: string; auth: string | null }[] = [];
    const { client } = await connect("/api/mcp/acme/api", log);
    try {
      expect(client.getInstructions()).toContain("public GitHub repository acme/api");
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

      const overview = (await client.callTool({ name: "get_codebase_overview", arguments: {} })) as ToolResult;
      const o = overview.structuredContent as { workspace: { root: string; branch: string | null }; projectType: { label: string } };
      expect(o.workspace).toMatchObject({ root: "github.com/acme/api", branch: "main" });
      expect(o.projectType.label).toBe("Node.js HTTP service (Express)");

      const trace = (await client.callTool({ name: "trace_code_path", arguments: { query: "POST /users" } })) as ToolResult;
      const steps = (trace.structuredContent as { journey: { steps: { name: string; calledAt: string | null }[] } }).journey.steps;
      expect(steps.map((s) => s.name)).toEqual(["createUserHandler", "createUser", "validateUser", "Database.insertUser", "pool.query"]);
      expect(steps[1].calledAt).toBe("src/routes/users.ts:15");

      const explain = (await client.callTool({ name: "explain_module", arguments: { target: "src/services/userService.ts" } })) as ToolResult;
      expect((explain.structuredContent as { excerpt: { text: string } }).excerpt.text).toContain("export async function getUser");

      const found = (await client.callTool({ name: "find_code", arguments: { query: "select * from users", kind: "content" } })) as ToolResult;
      expect((found.structuredContent as { results: { path: string }[] }).results[0]).toMatchObject({ path: "src/db/client.ts" });

      // Links go to the website's city for this repository; the server never opens a browser.
      const open = (await client.callTool({ name: "open_in_codescape", arguments: { target: "src/db/client.ts", openBrowser: true } })) as ToolResult;
      expect(open.structuredContent).toMatchObject({ url: `${SITE}/acme/api?select=src%2Fdb%2Fclient.ts`, openedBrowser: false, started: false });
    } finally {
      await client.close();
    }
    // One analysis serves every call; the token goes to the REST API only.
    expect(log.filter((r) => r.url.endsWith("/repos/acme/api"))).toHaveLength(1);
    expect(log.filter((r) => r.url.startsWith("https://api.github.com/")).every((r) => r.auth === "Bearer test-token")).toBe(true);
    expect(log.filter((r) => r.url.startsWith("https://raw.githubusercontent.com/")).every((r) => r.auth === null)).toBe(true);
  });

  it("answers the plain JSON-RPC handshake from docs/DEPLOY.md", async () => {
    const handler = createRemoteMcpHandler({ fetchImpl: fakeGitHub([]), siteUrl: SITE });
    const res = await handler.fetch(
      new Request(`${SITE}/api/mcp/pallets/flask`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "1" } } }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('"name":"codescape"');
    expect(body).toContain("pallets/flask");
  });

  it("explains a missing or private repository as a tool error", async () => {
    const { client } = await connect("/api/mcp/acme/secret");
    try {
      const r = (await client.callTool({ name: "get_codebase_overview", arguments: {} })) as ToolResult;
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/wasn't found, or it is private.*public repositories only/);
    } finally {
      await client.close();
    }
  });
});
