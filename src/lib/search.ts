export interface SearchItem {
  kind: "file" | "dir";
  path: string;
  name: string;
}

export interface SearchHit extends SearchItem {
  score: number;
}

/**
 * Small, dependency-free fuzzy matcher for paths. It prefers exact names,
 * then name prefixes, then substrings, then in-order character matches
 * across the whole path.
 */
export function scoreItem(item: SearchItem, query: string): number {
  const q = query.toLowerCase();
  const name = item.name.toLowerCase();
  const path = item.path.toLowerCase();
  const base = name.replace(/\.[^.]+$/, "");
  let score = 0;
  if (name === q || base === q) score = 1000;
  else if (name.startsWith(q)) score = 800 - name.length;
  else if (name.includes(q)) score = 600 - name.indexOf(q) * 4 - name.length;
  else if (path.includes(q)) score = 400 - path.indexOf(q) - path.length * 0.5;
  else {
    // Subsequence match across the path, rewarding contiguous runs.
    let pi = 0;
    let run = 0;
    let bonus = 0;
    for (let i = 0; i < q.length; i++) {
      const found = path.indexOf(q[i], pi);
      if (found < 0) return 0;
      run = found === pi ? run + 1 : 0;
      bonus += run * 3 + (found === 0 || "/._-".includes(path[found - 1]) ? 6 : 0);
      pi = found + 1;
    }
    score = 100 + bonus - path.length * 0.3;
  }
  if (item.kind === "dir") score += 15;
  return Math.max(1, score);
}

export function search(items: SearchItem[], query: string, limit = 40): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const item of items) {
    const score = scoreItem(item, q);
    if (score > 0) hits.push({ ...item, score });
  }
  hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  return hits.slice(0, limit);
}
