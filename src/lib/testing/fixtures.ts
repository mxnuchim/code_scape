import type { RepoMeta, RepoSnapshot, TreeEntry } from "../github/types";

export const fakeMeta: RepoMeta = {
  owner: "acme",
  repo: "rocket",
  fullName: "acme/rocket",
  description: "A test repository",
  defaultBranch: "main",
  stars: 1,
  forks: 0,
  openIssues: 0,
  primaryLanguage: "TypeScript",
  htmlUrl: "https://github.com/acme/rocket",
  pushedAt: null,
  sizeKb: 1,
  topics: [],
  license: "MIT",
  isFork: false,
  archived: false,
};

export function snapshotOf(paths: (string | [string, number])[], extra: Partial<RepoSnapshot> = {}): RepoSnapshot {
  const entries: TreeEntry[] = paths.map((p) =>
    Array.isArray(p) ? { path: p[0], type: "blob", size: p[1] } : { path: p, type: "blob", size: 1000 },
  );
  return {
    meta: fakeMeta,
    ref: "main",
    entries,
    truncated: false,
    fetchedAt: 0,
    source: "live",
    ...extra,
  };
}

/** A synthetic but realistic-looking repo with `n` files spread across folders. */
export function syntheticRepo(n: number, seed = 1): (string | [string, number])[] {
  const dirs = ["src", "src/components", "src/lib", "src/lib/utils", "tests", "docs", "packages/a/src", "packages/b/src", "assets/icons"];
  const out: [string, number][] = [["README.md", 4000], ["package.json", 900]];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const dir = dirs[Math.floor(rnd() * dirs.length)];
    const ext = dir.startsWith("assets") ? "svg" : dir === "docs" ? "md" : dir === "tests" ? "test.ts" : "ts";
    out.push([`${dir}/file${i}.${ext}`, Math.floor(rnd() * 20000)]);
  }
  return out;
}
