/**
 * Walk a checked-out repository into the same `TreeEntry[]` shape the GitHub
 * API returns, so the shared model builder can't tell the difference.
 *
 * - `.gitignore` files (root and nested) and `.git/info/exclude` are honoured,
 *   approximating "tracked files" without running git.
 * - Excluded folders (node_modules, build output, caches…) are skipped without
 *   being descended into.
 * - Symlinks are followed only when they point at a file inside the root;
 *   symlinked directories are never followed (no cycles, no escapes).
 * - The walk stops at `maxEntries` and reports truncation.
 */
import { lstat, opendir, readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import type { TreeEntry } from "../github/types";
import { excludedDirReason } from "../analysis/exclusions";

export const DEFAULT_MAX_ENTRIES = 100_000;

export interface FileStamp {
  size: number;
  mtimeMs: number;
}

export interface WalkResult {
  entries: TreeEntry[];
  stamps: Map<string, FileStamp>;
  truncated: boolean;
  skippedDirs: { path: string; reason: string }[];
  ignoredByGitignore: number;
  /** Symlinks not followed: directories, or targets outside the repository. */
  symlinksSkipped: string[];
  unreadable: string[];
  /** Changes whenever a file is added, removed, resized or modified. */
  fingerprint: string;
}

interface IgnoreScope {
  base: string;
  ig: Ignore;
}

async function loadIgnore(absDir: string, relDir: string, files: string[]): Promise<IgnoreScope | null> {
  const ig = ignore();
  let any = false;
  for (const f of files) {
    try {
      ig.add(await readFile(join(absDir, f), "utf8"));
      any = true;
    } catch {
      // Missing or unreadable ignore files are simply not applied.
    }
  }
  return any ? { base: relDir, ig } : null;
}

function isIgnored(scopes: IgnoreScope[], relPath: string, isDir: boolean): boolean {
  for (const { base, ig } of scopes) {
    const sub = base ? relPath.slice(base.length + 1) : relPath;
    if (!sub) continue;
    if (ig.ignores(isDir ? `${sub}/` : sub)) return true;
  }
  return false;
}

export async function walkRepository(rootReal: string, options: { maxEntries?: number } = {}): Promise<WalkResult> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries: TreeEntry[] = [];
  const stamps = new Map<string, FileStamp>();
  const skippedDirs: WalkResult["skippedDirs"] = [];
  const symlinksSkipped: string[] = [];
  const unreadable: string[] = [];
  let ignoredByGitignore = 0;
  let truncated = false;

  const rootScope = await loadIgnore(rootReal, "", [".gitignore", join(".git", "info", "exclude")]);
  const stack: { abs: string; rel: string; scopes: IgnoreScope[] }[] = [
    { abs: rootReal, rel: "", scopes: rootScope ? [rootScope] : [] },
  ];

  while (stack.length > 0 && !truncated) {
    const { abs, rel, scopes } = stack.pop()!;
    let names: { name: string; isDir: boolean; isFile: boolean; isLink: boolean }[] = [];
    try {
      const dir = await opendir(abs);
      for await (const d of dir) names.push({ name: d.name, isDir: d.isDirectory(), isFile: d.isFile(), isLink: d.isSymbolicLink() });
    } catch {
      unreadable.push(rel || ".");
      continue;
    }
    names = names.sort((a, b) => (a.name < b.name ? -1 : 1));

    let localScopes = scopes;
    if (rel && names.some((n) => n.name === ".gitignore" && n.isFile)) {
      const scope = await loadIgnore(abs, rel, [".gitignore"]);
      if (scope) localScopes = [...scopes, scope];
    }

    for (const n of names) {
      if (n.name === ".git") continue;
      const childRel = rel ? `${rel}/${n.name}` : n.name;
      const childAbs = join(abs, n.name);

      if (n.isDir) {
        const reason = excludedDirReason(n.name);
        // build/out/target only count as output near the top (mirrors excludedPathMatch).
        const depth = childRel.split("/").length - 1;
        if (reason && !((n.name === "build" || n.name === "out" || n.name === "target") && depth > 2)) {
          skippedDirs.push({ path: childRel, reason });
          continue;
        }
        if (isIgnored(localScopes, childRel, true)) {
          ignoredByGitignore++;
          continue;
        }
        stack.push({ abs: childAbs, rel: childRel, scopes: localScopes });
        continue;
      }

      if (isIgnored(localScopes, childRel, false)) {
        ignoredByGitignore++;
        continue;
      }

      let size: number;
      let mtimeMs: number;
      try {
        if (n.isLink) {
          const target = await realpath(childAbs).catch(() => null);
          const rel2 = target ? relative(rootReal, target) : "..";
          if (!target || rel2.startsWith("..") || rel2.split(sep).includes("..")) {
            symlinksSkipped.push(childRel);
            continue;
          }
          const info = await stat(target);
          if (!info.isFile()) {
            symlinksSkipped.push(childRel);
            continue;
          }
          size = info.size;
          mtimeMs = info.mtimeMs;
        } else if (n.isFile) {
          const info = await lstat(childAbs);
          size = info.size;
          mtimeMs = info.mtimeMs;
        } else continue; // sockets, fifos, devices
      } catch {
        unreadable.push(childRel);
        continue;
      }

      entries.push({ path: childRel, type: "blob", size });
      stamps.set(childRel, { size, mtimeMs });
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
    }
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : 1));
  return {
    entries,
    stamps,
    truncated,
    skippedDirs: skippedDirs.sort((a, b) => (a.path < b.path ? -1 : 1)),
    ignoredByGitignore,
    symlinksSkipped: symlinksSkipped.sort(),
    unreadable: unreadable.sort(),
    fingerprint: fingerprintOf(stamps),
  };
}

export function fingerprintOf(stamps: Map<string, FileStamp>): string {
  const hash = createHash("sha1");
  for (const path of [...stamps.keys()].sort()) {
    const s = stamps.get(path)!;
    hash.update(`${path}\0${s.size}\0${Math.round(s.mtimeMs)}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}
