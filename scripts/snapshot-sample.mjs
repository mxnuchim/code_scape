#!/usr/bin/env node
// Capture a public repository's tree as a bundled, dated sample snapshot.
// Usage: node scripts/snapshot-sample.mjs pallets/flask
// Spends 3 unauthenticated GitHub API requests (metadata, branch head, tree).

import { writeFile, mkdir } from "node:fs/promises";

const slug = process.argv[2];
if (!/^[\w.-]+\/[\w.-]+$/.test(slug ?? "")) {
  console.error("Usage: node scripts/snapshot-sample.mjs owner/repo");
  process.exit(1);
}

async function api(path, accept = "application/vnd.github+json") {
  const res = await fetch(`https://api.github.com${path}`, { headers: { Accept: accept } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return accept.endsWith("sha") ? res.text() : res.json();
}

const repo = await api(`/repos/${slug}`);
const sha = (await api(`/repos/${slug}/commits/${repo.default_branch}`, "application/vnd.github.sha")).trim();
const tree = await api(`/repos/${slug}/git/trees/${sha}?recursive=1`);

const snapshot = {
  capturedAt: new Date().toISOString(),
  ref: sha,
  truncated: Boolean(tree.truncated),
  meta: {
    owner: repo.owner.login,
    repo: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    defaultBranch: repo.default_branch,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    primaryLanguage: repo.language,
    htmlUrl: repo.html_url,
    pushedAt: repo.pushed_at,
    sizeKb: repo.size,
    topics: repo.topics ?? [],
    license: repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION" ? repo.license.spdx_id : (repo.license?.name ?? null),
    isFork: repo.fork,
    archived: repo.archived,
  },
  // Compact rows: [path, type, size?]
  entries: tree.tree
    .filter((e) => e.type === "blob" || e.type === "tree" || e.type === "commit")
    .map((e) => (e.type === "blob" ? [e.path, "blob", e.size ?? 0] : [e.path, e.type])),
};

await mkdir("public/samples", { recursive: true });
const file = `public/samples/${slug.replace("/", "--")}.json`;
await writeFile(file, JSON.stringify(snapshot));
const [owner, name] = slug.split("/");
await writeFile(
  "src/state/bundledSnapshot.ts",
  `// Written by scripts/snapshot-sample.mjs alongside ${file}.
export const BUNDLED_SNAPSHOT = {
  owner: ${JSON.stringify(owner)},
  repo: ${JSON.stringify(name)},
  file: ${JSON.stringify(file.replace(/^public/, ""))},
  capturedAt: ${JSON.stringify(snapshot.capturedAt)},
  commit: ${JSON.stringify(sha)},
} as const;
`,
);
console.log(`Wrote ${file}: ${snapshot.entries.length} entries at ${sha.slice(0, 7)}`);
