import {
  GitHubError,
  type RateLimitInfo,
  type RepoMeta,
  type RepoRef,
  type TreeEntry,
} from "./types";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

type FetchLike = typeof fetch;

let lastRateLimit: RateLimitInfo | undefined;

/** The most recent rate-limit window GitHub reported to this browser. */
export function getLastRateLimit(): RateLimitInfo | undefined {
  return lastRateLimit;
}

export function readRateLimit(headers: Headers): RateLimitInfo | undefined {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (limit === null || remaining === null || reset === null) return undefined;
  const info = {
    limit: Number(limit),
    remaining: Number(remaining),
    resetAt: Number(reset) * 1000,
  };
  return Number.isFinite(info.limit) && Number.isFinite(info.remaining) ? info : undefined;
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message : "";
  } catch {
    return "";
  }
}

/** Map a non-OK GitHub response to a typed, user-explainable error. */
export async function errorFromResponse(
  res: Response,
  context: "repo" | "tree",
): Promise<GitHubError> {
  const rateLimit = readRateLimit(res.headers);
  const status = res.status;
  const message = await safeMessage(res);

  if (status === 404) {
    return context === "repo"
      ? new GitHubError("not-found-or-private", message || "Not Found", { status })
      : new GitHubError("ref-not-found", message || "Not Found", { status });
  }
  if (status === 409) {
    return new GitHubError("empty-repo", message || "Git Repository is empty.", { status });
  }
  if (status === 403 || status === 429) {
    if (rateLimit && rateLimit.remaining === 0) {
      return new GitHubError("rate-limited", message || "API rate limit exceeded", {
        status,
        rateLimit,
      });
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return new GitHubError("secondary-rate-limit", message, {
        status,
        rateLimit,
        retryAfterMs: retryAfter * 1000,
      });
    }
    if (/rate limit/i.test(message) || status === 429) {
      return new GitHubError("secondary-rate-limit", message, {
        status,
        rateLimit,
        retryAfterMs: 60_000,
      });
    }
    return new GitHubError("blocked", message || "Access forbidden", { status, rateLimit });
  }
  if (status === 451) {
    return new GitHubError("blocked", message || "Unavailable for legal reasons", { status });
  }
  if (status >= 500) {
    return new GitHubError("unavailable", message || `GitHub responded ${status}`, { status });
  }
  return new GitHubError("unexpected", message || `GitHub responded ${status}`, { status });
}

async function request(url: string, signal: AbortSignal, fetchImpl: FetchLike): Promise<Response> {
  let res: Response;
  try {
    // Only CORS-safelisted headers, so no preflight. The browser HTTP cache
    // revalidates with ETags on its own, and 304s don't spend rate limit.
    res = await fetchImpl(url, { signal, headers: { Accept: "application/vnd.github+json" } });
  } catch (err) {
    if (signal.aborted) throw new GitHubError("aborted", "Request cancelled");
    throw new GitHubError("network", err instanceof Error ? err.message : "Network error");
  }
  const info = readRateLimit(res.headers);
  if (info) lastRateLimit = info;
  return res;
}

interface RawRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  html_url: string;
  pushed_at: string | null;
  size: number;
  topics?: string[];
  license: { spdx_id?: string | null; name?: string } | null;
  fork: boolean;
  archived: boolean;
}

export function toRepoMeta(raw: RawRepo): RepoMeta {
  const spdx = raw.license?.spdx_id;
  return {
    owner: raw.owner.login,
    repo: raw.name,
    fullName: raw.full_name,
    description: raw.description,
    defaultBranch: raw.default_branch,
    stars: raw.stargazers_count,
    forks: raw.forks_count,
    openIssues: raw.open_issues_count,
    primaryLanguage: raw.language,
    htmlUrl: raw.html_url,
    pushedAt: raw.pushed_at,
    sizeKb: raw.size,
    topics: raw.topics ?? [],
    license: spdx && spdx !== "NOASSERTION" ? spdx : (raw.license?.name ?? null),
    isFork: raw.fork,
    archived: raw.archived,
  };
}

export async function fetchRepoMeta(
  ref: RepoRef,
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<RepoMeta> {
  const url = `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const res = await request(url, signal, fetchImpl);
  if (!res.ok) throw await errorFromResponse(res, "repo");
  return toRepoMeta((await res.json()) as RawRepo);
}

async function readTextWithProgress(
  res: Response,
  signal: AbortSignal,
  onBytes?: (bytes: number) => void,
): Promise<string> {
  try {
    if (!res.body || !onBytes) return await res.text();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
      onBytes(received);
    }
    return text + decoder.decode();
  } catch (err) {
    if (signal.aborted) throw new GitHubError("aborted", "Request cancelled");
    throw new GitHubError("network", err instanceof Error ? err.message : "Network error");
  }
}

export interface TreeResult {
  entries: TreeEntry[];
  truncated: boolean;
}

export async function fetchTree(
  ref: RepoRef & { ref: string },
  signal: AbortSignal,
  onBytes?: (bytes: number) => void,
  fetchImpl: FetchLike = fetch,
): Promise<TreeResult> {
  const url =
    `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}` +
    `/git/trees/${encodeURIComponent(ref.ref)}?recursive=1`;
  const res = await request(url, signal, fetchImpl);
  if (!res.ok) throw await errorFromResponse(res, "tree");
  const text = await readTextWithProgress(res, signal, onBytes);
  let body: { tree?: { path: string; type: string; size?: number }[]; truncated?: boolean };
  try {
    body = JSON.parse(text);
  } catch {
    throw new GitHubError("unexpected", "GitHub returned a tree we couldn't read");
  }
  const entries: TreeEntry[] = [];
  for (const item of body.tree ?? []) {
    if (item.type !== "blob" && item.type !== "tree" && item.type !== "commit") continue;
    entries.push(
      item.type === "blob"
        ? { path: item.path, type: "blob", size: item.size ?? 0 }
        : { path: item.path, type: item.type },
    );
  }
  return { entries, truncated: Boolean(body.truncated) };
}

/**
 * Read one file's text from raw.githubusercontent.com. That host serves CORS
 * and isn't counted against the REST API's rate limit.
 * Resolves to null when the file doesn't exist at that ref.
 */
export async function fetchRawFile(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `${RAW}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${encodedPath}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { signal });
  } catch (err) {
    if (signal.aborted) throw new GitHubError("aborted", "Request cancelled");
    throw new GitHubError("network", err instanceof Error ? err.message : "Network error");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError("unexpected", `raw.githubusercontent.com responded ${res.status}`, { status: res.status });
  return res.text();
}

export function githubBlobUrl(meta: RepoMeta, ref: string, path: string): string {
  return `${meta.htmlUrl}/blob/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function githubTreeUrl(meta: RepoMeta, ref: string, path: string): string {
  if (!path) return `${meta.htmlUrl}/tree/${encodeURIComponent(ref)}`;
  return `${meta.htmlUrl}/tree/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
