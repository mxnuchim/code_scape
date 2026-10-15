import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSensitivePath, normalizeRepoPath, PathAccessError, readRepoText, redactSecrets, resolveInsideRoot } from "./safety";
import { readGitRevision } from "./revision";
import { walkRepository } from "./walk";
import { LocalWorkspace } from "./workspace";

// Built at runtime so no secret-shaped strings live in the repository.
const FAKE_TOKEN = "gh" + "p_" + "a1B2".repeat(9);
const FAKE_KEY = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEpAIBAAKCAQEA", "-----END RSA PRIVATE KEY-----"].join("\n");

let root: string;
let outside: string;
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

async function put(rel: string, content: string | Buffer) {
  const full = join(root, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
}

beforeAll(async () => {
  // realpath: on macOS the temp dir is itself behind a symlink (/var → /private/var).
  const base = await realpath(await mkdtemp(join(tmpdir(), "codescape-hostile-")));
  root = join(base, "repo");
  outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "stolen.txt"), "top secret outside the repo");

  await put("package.json", JSON.stringify({ name: "hostile", scripts: { test: "vitest" } }, null, 2));
  await put("src/app.ts", `import { helper } from "./helper";\nexport const token = "${FAKE_TOKEN}";\nexport function run() {\n  return helper();\n}\n`);
  await put("src/helper.ts", "export function helper() {\n  return 42;\n}\n");
  await put(".env", `DATABASE_PASSWORD=hunter2hunter2\nTOKEN=${FAKE_TOKEN}\n`);
  await put(".env.example", "DATABASE_PASSWORD=\n");
  await put("keys/id_rsa", FAKE_KEY);
  await put("certs/server.pem", FAKE_KEY);
  await put("assets/logo.bin", Buffer.from([0, 1, 2, 3, 0, 255]));
  await put("data/huge.ts", `export const big = "${"x".repeat(600 * 1024)}";\n`);
  await put(".gitignore", "generated/\n*.log\n");
  await put("generated/out.ts", "export const x = 1;\n");
  await put("debug.log", "log line\n");
  await put("node_modules/dep/index.js", "module.exports = 1;\n");
  await put("nested/.gitignore", "local-only.ts\n");
  await put("nested/local-only.ts", "export {};\n");
  await put("nested/kept.ts", "export {};\n");
  await symlink(join(outside, "stolen.txt"), join(root, "escape.txt"));
  await symlink(outside, join(root, "escape-dir"));
  await symlink(join(root, "src", "helper.ts"), join(root, "alias.ts"));
  await put("locked/secret-plan.ts", "export {};\n");
  if (!isRoot) await chmod(join(root, "locked"), 0o000);
});

afterAll(async () => {
  if (!isRoot) await chmod(join(root, "locked"), 0o755).catch(() => {});
  await rm(join(root, ".."), { recursive: true, force: true });
});

describe("path safety", () => {
  it("rejects traversal, absolute paths, backslashes and NUL bytes", () => {
    for (const bad of ["../etc/passwd", "src/../../x", "/etc/passwd", "C:/Windows", "src\\app.ts", "a\0b"]) {
      expect(() => normalizeRepoPath(bad), bad).toThrow(PathAccessError);
    }
    expect(normalizeRepoPath("./src//app.ts/")).toBe("src/app.ts");
    expect(normalizeRepoPath("")).toBe("");
  });

  it("refuses symlinks that resolve outside the repository", async () => {
    await expect(resolveInsideRoot(root, "escape.txt")).rejects.toMatchObject({ code: "outside-root" });
    await expect(readRepoText(root, "escape.txt")).rejects.toMatchObject({ code: "outside-root" });
    await expect(readRepoText(root, "alias.ts")).resolves.toContain("helper");
  });

  it("withholds likely secrets, binaries and oversized files", async () => {
    expect(isSensitivePath(".env")).toBe(true);
    expect(isSensitivePath("config/.env.production")).toBe(true);
    expect(isSensitivePath(".env.example")).toBe(false);
    expect(isSensitivePath("keys/id_rsa")).toBe(true);
    expect(isSensitivePath("certs/server.pem")).toBe(true);
    expect(isSensitivePath("home/.ssh/config")).toBe(true);
    expect(isSensitivePath("src/secretsManager.ts")).toBe(true);
    expect(isSensitivePath("src/app.ts")).toBe(false);
    await expect(readRepoText(root, ".env")).rejects.toMatchObject({ code: "withheld" });
    await expect(readRepoText(root, "assets/logo.bin")).rejects.toMatchObject({ code: "binary" });
    await expect(readRepoText(root, "data/huge.ts")).rejects.toMatchObject({ code: "too-large" });
  });

  it("redacts secret-shaped values", () => {
    const { text, redactions } = redactSecrets(`const a = "${FAKE_TOKEN}";\n${FAKE_KEY}\npassword: "correct-horse-battery"`);
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).not.toContain("MIIEpAIBAAKCAQEA");
    expect(text).not.toContain("correct-horse-battery");
    expect(redactions).toBe(3);
    expect(redactSecrets("const total = items.length;").redactions).toBe(0);
  });
});

describe("walkRepository", () => {
  it("honours .gitignore (root and nested), skips excluded folders and unsafe symlinks", async () => {
    const walk = await walkRepository(root);
    const paths = walk.entries.map((e) => e.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).toContain("alias.ts");
    expect(paths).toContain("nested/kept.ts");
    expect(paths).not.toContain("generated/out.ts");
    expect(paths).not.toContain("debug.log");
    expect(paths).not.toContain("nested/local-only.ts");
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(walk.skippedDirs).toContainEqual({ path: "node_modules", reason: "dependencies" });
    expect(walk.symlinksSkipped).toEqual(["escape-dir", "escape.txt"]);
    if (!isRoot) expect(walk.unreadable).toContain("locked");
    // Sensitive files are listed (they exist) but their contents are never read.
    expect(paths).toContain(".env");
  });

  it("stops at the entry limit and says so", async () => {
    const walk = await walkRepository(root, { maxEntries: 3 });
    expect(walk.entries).toHaveLength(3);
    expect(walk.truncated).toBe(true);
  });
});

describe("LocalWorkspace", () => {
  it("analyses without reading withheld files and redacts what it returns", async () => {
    const ws = await LocalWorkspace.open(root);
    const { analysis } = await ws.get();
    expect(analysis.snapshot.origin).toMatchObject({ kind: "local", name: "repo" });
    expect(analysis.index.files["src/app.ts"]).toBeDefined();
    expect(analysis.index.files["data/huge.ts"]).toBeUndefined();
    expect(analysis.index.limits.skippedLarge).toBe(1);
    expect(analysis.index.callEdges).toContainEqual(expect.objectContaining({ from: "src/app.ts#run", to: "src/helper.ts#helper", lines: [4] }));
    const excerpt = await ws.excerpt("src/app.ts", 1, 5);
    expect(excerpt.text).not.toContain(FAKE_TOKEN);
    expect(excerpt.redactions).toBe(1);
    expect(ws.searchContent(["token"]).every((h) => !h.text.includes(FAKE_TOKEN))).toBe(true);
    await expect(ws.excerpt(".env")).rejects.toMatchObject({ code: "withheld" });
    await expect(ws.excerpt("../outside/stolen.txt")).rejects.toMatchObject({ code: "outside-root" });
  });

  it("notices changes, re-analyses, and reuses parses of unchanged files", async () => {
    const ws = await LocalWorkspace.open(root, { freshnessIntervalMs: 0 });
    const first = await ws.get();
    const again = await ws.get();
    expect(again.refreshed).toBe(false);
    expect(again.analysis.fingerprint).toBe(first.analysis.fingerprint);

    await put("src/added.ts", 'import { helper } from "./helper";\nexport const added = () => helper();\n');
    const later = new Date(Date.now() + 5000);
    await utimes(join(root, "src/added.ts"), later, later);
    const changed = await ws.get();
    expect(changed.refreshed).toBe(true);
    expect(changed.analysis.fingerprint).not.toBe(first.analysis.fingerprint);
    expect(changed.analysis.index.files["src/added.ts"]).toBeDefined();
    // Unchanged files come from the parse cache (same object).
    expect(changed.analysis.index.files["src/helper.ts"].symbols[0]).toBe(first.analysis.index.files["src/helper.ts"].symbols[0]);
  });

  it("respects the parse cap and reports what was skipped", async () => {
    const ws = await LocalWorkspace.open(root, { cap: 1 });
    const { analysis } = await ws.get();
    expect(analysis.index.limits.parsed).toBe(1);
    expect(analysis.index.limits.skipped).toBeGreaterThan(0);
    expect(analysis.overview.limitations.some((l) => l.startsWith("Parsed 1 of"))).toBe(true);
  });

  it("rejects a missing root", async () => {
    await expect(LocalWorkspace.open(join(root, "does-not-exist"))).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("readGitRevision", () => {
  it("reads branch and commit from loose refs, packed refs, detached HEAD and worktree pointers", async () => {
    const base = await mkdtemp(join(tmpdir(), "codescape-git-"));
    const sha = "a".repeat(40);
    const repo = join(base, "r");
    await mkdir(join(repo, ".git", "refs", "heads"), { recursive: true });
    await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(repo, ".git", "refs", "heads", "main"), `${sha}\n`);
    expect(await readGitRevision(repo)).toEqual({ branch: "main", commit: sha });

    await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/feature/x\n");
    await writeFile(join(repo, ".git", "packed-refs"), `# pack-refs\n${"b".repeat(40)} refs/heads/feature/x\n`);
    expect(await readGitRevision(repo)).toEqual({ branch: "feature/x", commit: "b".repeat(40) });

    await writeFile(join(repo, ".git", "HEAD"), `${"c".repeat(40)}\n`);
    expect(await readGitRevision(repo)).toEqual({ branch: null, commit: "c".repeat(40) });

    const wt = join(base, "wt");
    await mkdir(join(repo, ".git", "worktrees", "wt"), { recursive: true });
    await mkdir(wt);
    await writeFile(join(wt, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "wt")}\n`);
    await writeFile(join(repo, ".git", "worktrees", "wt", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(repo, ".git", "worktrees", "wt", "commondir"), "../..\n");
    expect(await readGitRevision(wt)).toEqual({ branch: "main", commit: sha });

    expect(await readGitRevision(base)).toBeNull();
    await rm(base, { recursive: true, force: true });
  });
});
