import type { RepoRef } from "./types";

export type RepoUrlErrorKind =
  | "empty"
  | "not-github"
  | "profile-only"
  | "reserved-path"
  | "malformed";

export type ParseRepoUrlResult =
  | { ok: true; value: RepoRef }
  | { ok: false; error: RepoUrlErrorKind; detail?: string };

// GitHub usernames: alphanumerics and single hyphens, max 39 chars.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
// Repository names: alphanumerics, '.', '_' and '-', max 100 chars.
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** First path segments on github.com that are product pages, not users or orgs. */
const RESERVED = new Set([
  "about", "account", "apps", "blog", "codespaces", "collections", "contact",
  "customer-stories", "dashboard", "enterprise", "events", "explore", "features",
  "issues", "join", "login", "logout", "marketplace", "new", "notifications",
  "orgs", "organizations", "pricing", "pulls", "readme", "search", "security",
  "settings", "signup", "site", "sponsors", "stars", "team", "topics", "trending",
  "users", "watching",
]);

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

function stripGitSuffix(name: string): string {
  return name.endsWith(".git") ? name.slice(0, -4) : name;
}

function fromSegments(segments: string[]): ParseRepoUrlResult {
  if (segments.length === 0) {
    return { ok: false, error: "malformed", detail: "Add an owner and repository name." };
  }
  const [rawOwner, rawRepo, kind, ref] = segments;
  if (RESERVED.has(rawOwner.toLowerCase())) {
    return { ok: false, error: "reserved-path", detail: rawOwner };
  }
  if (!OWNER_RE.test(rawOwner)) {
    return { ok: false, error: "malformed", detail: "That owner name isn't valid on GitHub." };
  }
  if (!rawRepo) {
    return { ok: false, error: "profile-only", detail: rawOwner };
  }
  const repo = stripGitSuffix(rawRepo);
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    return { ok: false, error: "malformed", detail: "That repository name isn't valid on GitHub." };
  }
  const value: RepoRef = { owner: rawOwner, repo };
  if ((kind === "tree" || kind === "blob") && ref) value.ref = ref;
  return { ok: true, value };
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Turn whatever a person pastes into an owner/repo pair.
 * Accepts full URLs, scheme-less URLs, `owner/repo` shorthand and SSH remotes.
 */
export function parseRepoUrl(input: string): ParseRepoUrlResult {
  const text = input.trim();
  if (!text) return { ok: false, error: "empty" };

  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)\/?$/i.exec(text);
  if (ssh) return fromSegments([ssh[1], ssh[2]]);

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const looksLikeHost = /^[^/\s]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(text);

  if (!hasScheme && !looksLikeHost) {
    // owner/repo shorthand (optionally with /tree/<ref>)
    if (/\s/.test(text)) return { ok: false, error: "malformed" };
    const segments = text.split("/").filter(Boolean).map(safeDecode);
    if (segments.length === 1) {
      return RESERVED.has(segments[0].toLowerCase())
        ? { ok: false, error: "reserved-path", detail: segments[0] }
        : OWNER_RE.test(segments[0])
          ? { ok: false, error: "profile-only", detail: segments[0] }
          : { ok: false, error: "malformed" };
    }
    return fromSegments(segments);
  }

  let url: URL;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "not-github", detail: url.protocol.replace(":", "") };
  }
  const host = url.hostname.toLowerCase();
  if (!GITHUB_HOSTS.has(host)) {
    return { ok: false, error: "not-github", detail: host };
  }
  const segments = url.pathname.split("/").filter(Boolean).map(safeDecode);
  return fromSegments(segments);
}

export function repoSlug(ref: Pick<RepoRef, "owner" | "repo">): string {
  return `${ref.owner}/${ref.repo}`;
}

/** Path used for deep links inside CodeScape, e.g. `/vercel/next.js`. */
export function repoPath(ref: RepoRef): string {
  const base = `/${ref.owner}/${ref.repo}`;
  return ref.ref ? `${base}/tree/${encodeURIComponent(ref.ref)}` : base;
}
