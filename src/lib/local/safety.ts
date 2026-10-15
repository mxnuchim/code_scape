/**
 * Filesystem safety for local analysis. Repository contents are untrusted:
 * every path is normalised, resolved through symlinks and checked to stay
 * inside the repository root; likely-secret files are never read; text that
 * is returned is passed through secret redaction.
 */
import { realpath, stat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type PathErrorCode = "invalid-path" | "outside-root" | "not-found" | "withheld" | "too-large" | "binary" | "not-a-file";

export class PathAccessError extends Error {
  constructor(
    readonly code: PathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PathAccessError";
  }
}

/**
 * Normalise a repository-relative path. Rejects absolute paths, `..`
 * segments, NUL bytes and backslashes rather than trying to repair them.
 */
export function normalizeRepoPath(input: string): string {
  if (typeof input !== "string" || input.includes("\0") || input.includes("\\")) {
    throw new PathAccessError("invalid-path", "Paths must be repository-relative and use forward slashes.");
  }
  const trimmed = input.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (trimmed === "" || trimmed === ".") return "";
  if (isAbsolute(trimmed) || /^[A-Za-z]:/.test(trimmed)) {
    throw new PathAccessError("invalid-path", "Absolute paths are not accepted; use a path relative to the repository root.");
  }
  const segments = trimmed.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) throw new PathAccessError("outside-root", "Paths may not contain '..'.");
  return segments.join("/");
}

function isInside(rootReal: string, candidate: string): boolean {
  if (candidate === rootReal) return true;
  const rel = relative(rootReal, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes("..");
}

/** Absolute, symlink-resolved path for `repoPath`, guaranteed to be inside `rootReal`. */
export async function resolveInsideRoot(rootReal: string, repoPath: string): Promise<string> {
  const rel = normalizeRepoPath(repoPath);
  const joined = resolve(rootReal, rel);
  if (!isInside(rootReal, joined)) throw new PathAccessError("outside-root", "Path is outside the repository.");
  let real: string;
  try {
    real = await realpath(joined);
  } catch {
    throw new PathAccessError("not-found", `No such file: ${rel}`);
  }
  if (!isInside(rootReal, real)) throw new PathAccessError("outside-root", "Path resolves (via a symlink) outside the repository.");
  return real;
}

// ---- sensitive files ---------------------------------------------------------

const SENSITIVE_DIRS = /(^|\/)(\.ssh|\.aws|\.gnupg|\.docker|\.kube|\.azure|\.config\/gcloud)(\/|$)/i;
const SAFE_ENV_SUFFIX = /\.(example|sample|template|dist|defaults?)$/i;
const SENSITIVE_NAMES = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks|ppk|der|crt|cer|kdbx|tfvars|tfstate)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.(npmrc|pypirc|netrc|htpasswd|git-credentials|pgpass|my\.cnf)$/i,
  /^credentials(\..*)?$/i,
  /secret/i,
  /^service[-_]?account.*\.json$/i,
  /^.*\.(asc|gpg)$/i,
];

/** True for files whose contents should never be read or returned. */
export function isSensitivePath(repoPath: string): boolean {
  if (SENSITIVE_DIRS.test(repoPath)) return true;
  const name = repoPath.slice(repoPath.lastIndexOf("/") + 1);
  if (/^\.env/i.test(name) && SAFE_ENV_SUFFIX.test(name)) return false;
  return SENSITIVE_NAMES.some((re) => re.test(name));
}

// Redaction is pure, so it lives with the shared engine (the browser uses it too).
export { REDACTED, redactSecrets } from "../analysis/redact";

// ---- reading -------------------------------------------------------------------

export const MAX_READ_BYTES = 512 * 1024;

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Read a repository file as UTF-8 text, enforcing every rule above.
 * Throws PathAccessError with a specific code when the read is refused.
 */
export async function readRepoText(rootReal: string, repoPath: string, maxBytes = MAX_READ_BYTES): Promise<string> {
  const rel = normalizeRepoPath(repoPath);
  if (isSensitivePath(rel)) throw new PathAccessError("withheld", "This file may contain secrets, so its contents are withheld.");
  const abs = await resolveInsideRoot(rootReal, rel);
  const info = await stat(abs);
  if (!info.isFile()) throw new PathAccessError("not-a-file", `${rel} is not a file.`);
  if (info.size > maxBytes) throw new PathAccessError("too-large", `${rel} is larger than ${Math.round(maxBytes / 1024)} KB.`);
  const handle = await open(abs, "r");
  try {
    const buf = Buffer.alloc(info.size);
    await handle.read(buf, 0, info.size, 0);
    if (looksBinary(buf)) throw new PathAccessError("binary", `${rel} is a binary file.`);
    return buf.toString("utf8");
  } finally {
    await handle.close();
  }
}
