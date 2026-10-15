/**
 * Read the checked-out branch and commit from `.git` metadata files.
 *
 * We deliberately never run `git` against an analysed repository: repo-local
 * configuration (core.fsmonitor, hooks, aliases) can execute arbitrary
 * commands. Reading HEAD and refs as plain files is enough for "which
 * revision is this", and it can't run anything.
 */
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { GitRevision } from "../github/types";

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

/** Locate the git dir: `.git` may be a directory or a `gitdir:` pointer file (worktrees, submodules). */
async function gitDirFor(root: string): Promise<string | null> {
  const dotGit = join(root, ".git");
  try {
    const info = await stat(dotGit);
    if (info.isDirectory()) return dotGit;
    const pointer = await readTextOrNull(dotGit);
    const m = pointer ? /^gitdir:\s*(.+)$/m.exec(pointer) : null;
    return m ? resolve(root, m[1].trim()) : null;
  } catch {
    return null;
  }
}

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

async function resolveRef(gitDir: string, commonDir: string, ref: string): Promise<string | null> {
  if (!/^refs\/[\w./-]+$/.test(ref) || ref.includes("..")) return null;
  for (const dir of [gitDir, commonDir]) {
    const loose = await readTextOrNull(join(dir, ref));
    if (loose && SHA.test(loose)) return loose;
  }
  const packed = await readTextOrNull(join(commonDir, "packed-refs"));
  for (const line of packed?.split("\n") ?? []) {
    const [sha, name] = line.trim().split(" ");
    if (name === ref && sha && SHA.test(sha)) return sha;
  }
  return null;
}

export async function readGitRevision(root: string): Promise<GitRevision | null> {
  const gitDir = await gitDirFor(root);
  if (!gitDir) return null;
  const commonPointer = await readTextOrNull(join(gitDir, "commondir"));
  const commonDir = commonPointer ? resolve(gitDir, commonPointer) : gitDir;
  const head = await readTextOrNull(join(gitDir, "HEAD"));
  if (!head) return null;
  if (SHA.test(head)) return { branch: null, commit: head };
  const m = /^ref:\s*(refs\/[^\s]+)$/.exec(head);
  if (!m) return null;
  const branch = m[1].replace(/^refs\/heads\//, "");
  return { branch, commit: await resolveRef(gitDir, commonDir, m[1]) };
}
