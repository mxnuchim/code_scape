/**
 * A public GitHub repository analysed on the server, for the hosted MCP
 * endpoint. It reads the same bounded set of files the browser reads in
 * GitHub mode (tree from the REST API, contents from raw.githubusercontent.com)
 * and runs the shared engine on them. Nothing is executed and nothing is
 * stored beyond an in-memory cache per server instance.
 */
import type { CodeWorkspace, Excerpt, WorkspaceState } from "../../mcp/context";
import { buildRepoModel } from "../analysis/buildModel";
import { analyzeModel } from "../analysis/workspace";
import { fetchRawFile, fetchRepoMeta, fetchTree } from "../github/client";
import { GitHubError, type RepoRef, type RepoSnapshot } from "../github/types";
import { isSensitivePath, redactSecrets } from "../local/safety";
import { initNodeParsers } from "../local/wasm";

type FetchLike = typeof fetch;

export interface GitHubWorkspaceOptions {
  /** Used for every GitHub request (tests inject a fake). */
  fetchImpl?: FetchLike;
  /** GitHub token for the REST API (60 requests/hour per IP without one, 5,000 with). */
  token?: string;
  /** Files to parse. */
  cap?: number;
  maxFileBytes?: number;
  /** Stop reading new files after this long; what was parsed is kept. */
  timeBudgetMs?: number;
}

export const REMOTE_DEFAULTS = {
  cap: 600,
  maxFileBytes: 512 * 1024,
  timeBudgetMs: 40_000,
};

/** `owner/repo` names as GitHub allows them. */
export const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export class GitHubWorkspace implements CodeWorkspace {
  private state: Promise<WorkspaceState> | null = null;
  private texts = new Map<string, string>();
  private snapshot: RepoSnapshot | null = null;
  private readonly fetchImpl: FetchLike;

  constructor(
    readonly ref: RepoRef,
    private readonly options: GitHubWorkspaceOptions = {},
  ) {
    const base = options.fetchImpl ?? fetch;
    const token = options.token;
    // Only the REST API gets the token; raw file reads are anonymous.
    this.fetchImpl = token
      ? (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (!url.startsWith("https://api.github.com/")) return base(input, init);
          const headers = new Headers(init?.headers);
          headers.set("Authorization", `Bearer ${token}`);
          return base(input, { ...init, headers });
        }
      : base;
  }

  get root(): string {
    return `github.com/${this.ref.owner}/${this.ref.repo}`;
  }

  get name(): string {
    return `${this.ref.owner}/${this.ref.repo}`;
  }

  /** The analysis, built once on first use. A failed build is retried on the next call. */
  get(): Promise<WorkspaceState> {
    if (!this.state) {
      this.state = this.analyze().catch((err) => {
        this.state = null;
        throw new Error(explainGitHubError(err, this.name));
      });
    }
    return this.state;
  }

  private async analyze(): Promise<WorkspaceState> {
    const signal = AbortSignal.timeout(this.options.timeBudgetMs ? this.options.timeBudgetMs + 20_000 : 60_000);
    const meta = await fetchRepoMeta(this.ref, signal, this.fetchImpl);
    const treeRef = this.ref.ref ?? meta.defaultBranch;
    const tree = await fetchTree({ ...this.ref, ref: treeRef }, signal, undefined, this.fetchImpl);
    const snapshot: RepoSnapshot = { meta, ref: treeRef, entries: tree.entries, truncated: tree.truncated, fetchedAt: Date.now(), source: "live" };
    const model = buildRepoModel(snapshot);
    if (model.files.length === 0) throw new GitHubError("empty-repo", "This repository has no files to analyse.");
    await initNodeParsers();
    const analysis = await analyzeModel(
      model,
      snapshot,
      async (path, s) => {
        const text = await fetchRawFile(meta.owner, meta.repo, treeRef, path, s, this.fetchImpl);
        if (text !== null) this.texts.set(path, text);
        return text;
      },
      {
        signal,
        cap: this.options.cap ?? REMOTE_DEFAULTS.cap,
        maxFileBytes: this.options.maxFileBytes ?? REMOTE_DEFAULTS.maxFileBytes,
        timeBudgetMs: this.options.timeBudgetMs ?? REMOTE_DEFAULTS.timeBudgetMs,
        isWithheld: isSensitivePath,
      },
    );
    this.snapshot = snapshot;
    return { analysis, model, refreshed: false };
  }

  async excerpt(path: string, startLine = 1, endLine = startLine + 40, maxLines = 120): Promise<Excerpt> {
    const { model } = await this.get();
    const file = model.filesByPath.get(path);
    if (!file) throw new Error(`No file at ${path} in ${this.name}.`);
    if (isSensitivePath(path)) throw new Error("This file may contain secrets, so its contents are withheld.");
    let text = this.texts.get(path);
    if (text === undefined) {
      if (file.size > (this.options.maxFileBytes ?? REMOTE_DEFAULTS.maxFileBytes)) throw new Error("This file is too large to show.");
      const ref = this.snapshot?.ref ?? this.ref.ref ?? "HEAD";
      const fetched = await fetchRawFile(this.ref.owner, this.ref.repo, ref, path, AbortSignal.timeout(15_000), this.fetchImpl);
      if (fetched === null) throw new Error(`GitHub has no file at ${path}.`);
      if (fetched.includes("\u0000")) throw new Error("This looks like a binary file, so it isn't shown.");
      text = fetched;
      this.texts.set(path, text);
    }
    const lines = text.split("\n");
    const start = Math.max(1, Math.min(startLine, lines.length));
    const end = Math.max(start, Math.min(endLine, lines.length, start + maxLines - 1));
    const { text: redacted, redactions } = redactSecrets(lines.slice(start - 1, end).join("\n"));
    return { path, startLine: start, endLine: end, totalLines: lines.length, text: redacted, redactions };
  }

  /** Same ranking as LocalWorkspace.searchContent, over the files read for the analysis. */
  searchContent(terms: string[], limit = 20): { path: string; line: number; text: string; matched: number }[] {
    const needles = [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 2))];
    if (!needles.length) return [];
    const hits: { path: string; line: number; text: string; matched: number; score: number }[] = [];
    for (const [path, text] of this.texts) {
      if (isSensitivePath(path)) continue;
      const lower = text.toLowerCase();
      const fileMatched = needles.filter((n) => lower.includes(n)).length;
      if (fileMatched === 0 || fileMatched < Math.ceil(needles.length / 2)) continue;
      const lines = lower.split("\n");
      const best: { line: number; matched: number }[] = [];
      for (let i = 0; i < lines.length; i++) {
        const matched = needles.filter((n) => lines[i].includes(n)).length;
        if (matched) best.push({ line: i + 1, matched });
      }
      best.sort((a, b) => b.matched - a.matched || a.line - b.line);
      const original = text.split("\n");
      for (const b of best.slice(0, 2)) {
        hits.push({ path, line: b.line, matched: b.matched, text: redactSecrets(original[b.line - 1].trim().slice(0, 200)).text, score: b.matched * 10 + fileMatched });
      }
    }
    return hits
      .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line))
      .slice(0, limit)
      .map((h) => ({ path: h.path, line: h.line, text: h.text, matched: h.matched }));
  }
}

/** A message the model can pass on, for the failures a hosted server sees. */
function explainGitHubError(err: unknown, name: string): string {
  if (!(err instanceof GitHubError)) return err instanceof Error ? err.message : String(err);
  switch (err.kind) {
    case "not-found-or-private":
      return `github.com/${name} wasn't found, or it is private. The hosted CodeScape server reads public repositories only; for private code, run CodeScape locally (see docs/MCP.md).`;
    case "rate-limited":
    case "secondary-rate-limit": {
      const wait = err.rateLimit?.resetAt ? ` Try again in about ${Math.max(1, Math.ceil((err.rateLimit.resetAt - Date.now()) / 60_000))} minutes.` : " Try again shortly.";
      return `GitHub's API rate limit was reached, so the repository couldn't be read.${wait}`;
    }
    case "empty-repo":
      return `github.com/${name} is empty, so there is nothing to analyse.`;
    case "blocked":
      return `GitHub blocks access to github.com/${name}.`;
    default:
      return `GitHub couldn't be read for ${name}: ${err.message}`;
  }
}

const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 24;
const cache = new Map<string, { workspace: GitHubWorkspace; at: number }>();

/**
 * One workspace per `owner/repo@ref` per server instance, kept for 15 minutes
 * so a conversation's tool calls share one analysis.
 */
export function githubWorkspace(ref: RepoRef, options: GitHubWorkspaceOptions = {}): GitHubWorkspace {
  const key = `${ref.owner}/${ref.repo}@${ref.ref ?? ""}`.toLowerCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    // Refresh recency for the LRU order.
    cache.delete(key);
    cache.set(key, hit);
    return hit.workspace;
  }
  const workspace = new GitHubWorkspace(ref, options);
  cache.set(key, { workspace, at: now });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return workspace;
}

/** For tests. */
export function clearGitHubWorkspaceCache() {
  cache.clear();
}
