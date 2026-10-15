export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit taken from a /tree/<ref> URL. Absent means "default branch". */
  ref?: string;
}

export interface RepoMeta {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  openIssues: number;
  primaryLanguage: string | null;
  htmlUrl: string;
  pushedAt: string | null;
  sizeKb: number;
  topics: string[];
  license: string | null;
  isFork: boolean;
  archived: boolean;
}

export type TreeEntryType = "blob" | "tree" | "commit";

export interface TreeEntry {
  path: string;
  type: TreeEntryType;
  /** Bytes. Only present for blobs. */
  size?: number;
}

export type SnapshotSource = "live" | "session-cache" | "bundled-snapshot" | "local";

/** Branch and commit read from `.git` metadata files (git itself is never run). */
export interface GitRevision {
  branch: string | null;
  commit: string | null;
}

/** Where a snapshot came from. GitHub snapshots link to github.com; local ones to an editor. */
export type RepoOrigin =
  | { kind: "github" }
  | {
      kind: "local";
      /** Folder name shown in the UI. */
      name: string;
      /** Absolute path of the repository root on this machine (for editor links). */
      root: string;
      revision: GitRevision | null;
    };

export interface RepoSnapshot {
  meta: RepoMeta;
  /** The ref the tree was read from (branch, tag or commit SHA). */
  ref: string;
  entries: TreeEntry[];
  /** GitHub stopped listing entries (over 100k entries or 7 MB). */
  truncated: boolean;
  fetchedAt: number;
  source: SnapshotSource;
  /** For bundled snapshots: when the data was captured from GitHub. */
  capturedAt?: string;
  /** Defaults to GitHub. */
  origin?: RepoOrigin;
  /** Excluded folders that were not walked at all (local scans skip e.g. node_modules). */
  skippedDirs?: { path: string; reason: string }[];
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  /** Epoch milliseconds at which the window resets. */
  resetAt: number;
}

export type GitHubErrorKind =
  | "not-found-or-private"
  | "ref-not-found"
  | "empty-repo"
  | "rate-limited"
  | "secondary-rate-limit"
  | "blocked"
  | "unavailable"
  | "network"
  | "aborted"
  | "unexpected";

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status?: number;
  readonly rateLimit?: RateLimitInfo;
  readonly retryAfterMs?: number;

  constructor(
    kind: GitHubErrorKind,
    message: string,
    opts: { status?: number; rateLimit?: RateLimitInfo; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "GitHubError";
    this.kind = kind;
    this.status = opts.status;
    this.rateLimit = opts.rateLimit;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof GitHubError && err.kind === "aborted") ||
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
