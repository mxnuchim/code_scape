import { describe, expect, it } from "vitest";
import { parseRepoUrl, repoPath } from "./parseRepoUrl";
import { errorFromResponse, fetchRepoMeta, fetchTree } from "./client";
import { GitHubError } from "./types";

describe("parseRepoUrl", () => {
  const ok = (input: string) => {
    const r = parseRepoUrl(input);
    if (!r.ok) throw new Error(`expected ok for ${input}, got ${r.error}`);
    return r.value;
  };

  it.each([
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["http://github.com/vercel/next.js/", "vercel", "next.js"],
    ["github.com/pmndrs/zustand", "pmndrs", "zustand"],
    ["www.github.com/pmndrs/zustand", "pmndrs", "zustand"],
    ["  pmndrs/zustand  ", "pmndrs", "zustand"],
    ["https://github.com/pmndrs/zustand.git", "pmndrs", "zustand"],
    ["git@github.com:pmndrs/zustand.git", "pmndrs", "zustand"],
    ["https://github.com/pmndrs/zustand/issues/12", "pmndrs", "zustand"],
    ["https://github.com/pmndrs/zustand?tab=readme#top", "pmndrs", "zustand"],
  ])("accepts %s", (input, owner, repo) => {
    expect(ok(input)).toEqual({ owner, repo });
  });

  it("keeps the ref from /tree and /blob URLs", () => {
    expect(ok("https://github.com/a/b/tree/develop/src")).toEqual({ owner: "a", repo: "b", ref: "develop" });
    expect(ok("github.com/a/b/blob/v1.2.0/README.md")).toEqual({ owner: "a", repo: "b", ref: "v1.2.0" });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["https://gitlab.com/a/b", "not-github"],
    ["https://gist.github.com/a/123", "not-github"],
    ["ftp://github.com/a/b", "not-github"],
    ["https://github.com/torvalds", "profile-only"],
    ["torvalds", "profile-only"],
    ["https://github.com/settings/profile", "reserved-path"],
    ["https://github.com/orgs/vercel/repositories", "reserved-path"],
    ["https://github.com/", "malformed"],
    ["hello world", "malformed"],
    ["https://github.com/-bad/repo", "malformed"],
    ["https://github.com/a/..", "malformed"],
  ])("rejects %j as %s", (input, error) => {
    const r = parseRepoUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(error);
  });

  it("builds deep-link paths", () => {
    expect(repoPath({ owner: "a", repo: "b" })).toBe("/a/b");
    expect(repoPath({ owner: "a", repo: "b", ref: "dev" })).toBe("/a/b/tree/dev");
  });
});

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("GitHub error classification", () => {
  it("does not claim to know whether a 404 repo is private or missing", async () => {
    const err = await errorFromResponse(response(404, { message: "Not Found" }), "repo");
    expect(err.kind).toBe("not-found-or-private");
  });

  it("maps a 404 tree to ref-not-found and 409 to empty-repo", async () => {
    expect((await errorFromResponse(response(404, {}), "tree")).kind).toBe("ref-not-found");
    expect((await errorFromResponse(response(409, { message: "Git Repository is empty." }), "tree")).kind).toBe("empty-repo");
  });

  it("detects primary rate limits with their reset time", async () => {
    const err = await errorFromResponse(
      response(403, { message: "API rate limit exceeded" }, {
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1700000000",
      }),
      "repo",
    );
    expect(err.kind).toBe("rate-limited");
    expect(err.rateLimit?.resetAt).toBe(1_700_000_000_000);
  });

  it("detects secondary rate limits and plain blocks", async () => {
    const secondary = await errorFromResponse(response(403, { message: "slow down" }, { "retry-after": "30" }), "repo");
    expect(secondary.kind).toBe("secondary-rate-limit");
    expect(secondary.retryAfterMs).toBe(30_000);
    const blocked = await errorFromResponse(response(403, { message: "Repository access blocked" }), "repo");
    expect(blocked.kind).toBe("blocked");
    expect((await errorFromResponse(response(502, {}), "repo")).kind).toBe("unavailable");
  });

  it("reports network failures and cancellations distinctly", async () => {
    const controller = new AbortController();
    const failing = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
    await expect(fetchRepoMeta({ owner: "a", repo: "b" }, controller.signal, failing)).rejects.toMatchObject({ kind: "network" });
    controller.abort();
    await expect(fetchRepoMeta({ owner: "a", repo: "b" }, controller.signal, failing)).rejects.toMatchObject({ kind: "aborted" });
  });

  it("parses trees and reports truncation", async () => {
    const fake = (async () =>
      response(200, {
        truncated: true,
        tree: [
          { path: "src", type: "tree" },
          { path: "src/a.ts", type: "blob", size: 10 },
          { path: "lib", type: "commit" },
        ],
      })) as typeof fetch;
    const res = await fetchTree({ owner: "a", repo: "b", ref: "main" }, new AbortController().signal, undefined, fake);
    expect(res.truncated).toBe(true);
    expect(res.entries).toEqual([
      { path: "src", type: "tree" },
      { path: "src/a.ts", type: "blob", size: 10 },
      { path: "lib", type: "commit" },
    ]);
  });

  it("is a real Error subclass", () => {
    expect(new GitHubError("network", "x")).toBeInstanceOf(Error);
  });
});
