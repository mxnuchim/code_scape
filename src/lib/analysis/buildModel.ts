import type { RepoSnapshot, TreeEntry } from "../github/types";
import { classifyFile, detectLandmark, isManifest } from "./classify";
import { excludedFileReason, excludedPathMatch } from "./exclusions";
import { extensionOf } from "./languages";
import type {
  CountMap,
  DirNode,
  ExclusionSummary,
  FileNode,
  RepoModel,
  SubtreeStats,
} from "./types";

export const DEFAULT_BUILDING_BUDGET = 2500;

function emptyStats(): SubtreeStats {
  return { files: 0, bytes: 0, dirs: 0, languages: {}, languageBytes: {}, categories: {} };
}

function bump(map: CountMap, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function mergeStats(into: SubtreeStats, from: SubtreeStats) {
  into.files += from.files;
  into.bytes += from.bytes;
  into.dirs += from.dirs;
  for (const [k, v] of Object.entries(from.languages)) bump(into.languages, k, v);
  for (const [k, v] of Object.entries(from.languageBytes)) bump(into.languageBytes, k, v);
  for (const [k, v] of Object.entries(from.categories)) bump(into.categories, k, v);
}

function byPath(a: { path: string }, b: { path: string }) {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

interface FilterResult {
  kept: TreeEntry[];
  excluded: ExclusionSummary;
}

function filterEntries(entries: TreeEntry[]): FilterResult {
  const kept: TreeEntry[] = [];
  const byReason: CountMap = {};
  const dirFiles = new Map<string, { files: number; reason: string }>();
  const submodules: string[] = [];
  let files = 0;
  let bytes = 0;

  for (const entry of entries) {
    if (entry.type === "commit") {
      submodules.push(entry.path);
      continue;
    }
    if (entry.type !== "blob") continue;
    const dirMatch = excludedPathMatch(entry.path);
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    const reason = dirMatch?.reason ?? excludedFileReason(name);
    if (!reason) {
      kept.push(entry);
      continue;
    }
    files++;
    bytes += entry.size ?? 0;
    bump(byReason, reason);
    if (dirMatch) {
      const current = dirFiles.get(dirMatch.dir) ?? { files: 0, reason: dirMatch.reason };
      current.files++;
      dirFiles.set(dirMatch.dir, current);
    }
  }

  const topDirs = [...dirFiles.entries()]
    .map(([path, v]) => ({ path, files: v.files, reason: v.reason }))
    .sort((a, b) => b.files - a.files || (a.path < b.path ? -1 : 1))
    .slice(0, 12);

  return { kept, excluded: { files, bytes, byReason, topDirs, submodules: submodules.sort(), skippedDirs: [] } };
}

function makeDir(path: string, parentPath: string | null): DirNode {
  const name = path ? path.slice(path.lastIndexOf("/") + 1) : "";
  return {
    path,
    name,
    depth: path ? path.split("/").length : 0,
    parentPath,
    dirs: [],
    files: [],
    isPackage: false,
    aggregated: false,
    stats: emptyStats(),
  };
}

function computeStats(dir: DirNode): SubtreeStats {
  const stats = emptyStats();
  for (const file of dir.files) {
    stats.files++;
    stats.bytes += file.size;
    bump(stats.languages, file.language);
    bump(stats.languageBytes, file.language, file.size);
    bump(stats.categories, file.category);
  }
  for (const child of dir.dirs) {
    mergeStats(stats, computeStats(child));
    stats.dirs++;
  }
  dir.stats = stats;
  return stats;
}

/**
 * Collapse directories into single "block" buildings until the city fits the
 * building budget. Largest leaf-most clusters go first, so the upper structure
 * of the repository stays intact. Deterministic: ties break by depth, then path.
 */
function aggregateToBudget(root: DirNode, budget: number) {
  const rendered = new Map<DirNode, number>();
  const parentOf = new Map<DirNode, DirNode>();
  const countRendered = (dir: DirNode): number => {
    let n = dir.files.length;
    for (const child of dir.dirs) {
      parentOf.set(child, dir);
      n += countRendered(child);
    }
    rendered.set(dir, n);
    return n;
  };
  let total = countRendered(root);
  const aggregated: { path: string; files: number }[] = [];
  if (total <= budget) return { aggregated, rootOverflow: 0 };

  // A directory is collapsible once none of its children are still expanded.
  const isFrontier = (dir: DirNode) => dir.dirs.every((c) => c.aggregated || c.dirs.length === 0 && c.files.length <= 1);
  const better = (a: DirNode, b: DirNode) => {
    const ra = rendered.get(a)!;
    const rb = rendered.get(b)!;
    if (ra !== rb) return ra > rb;
    if (a.depth !== b.depth) return a.depth > b.depth;
    return a.path < b.path;
  };

  const frontier = new Set<DirNode>();
  const visit = (dir: DirNode) => {
    for (const child of dir.dirs) visit(child);
    if (dir !== root && isFrontier(dir)) frontier.add(dir);
  };
  visit(root);

  while (total > budget && frontier.size > 0) {
    let pick: DirNode | undefined;
    for (const d of frontier) if (!pick || better(d, pick)) pick = d;
    if (!pick) break;
    frontier.delete(pick);
    const before = rendered.get(pick)!;
    if (before <= 1) {
      // Nothing to gain by itself, but a folder that is already a single block
      // becomes one so its parent can be collapsed next.
      if (pick.dirs.length > 0) {
        pick.aggregated = true;
        aggregated.push({ path: pick.path, files: pick.stats.files });
      }
    } else {
      pick.aggregated = true;
      aggregated.push({ path: pick.path, files: pick.stats.files });
      const delta = before - 1;
      total -= delta;
      rendered.set(pick, 1);
      for (let p = parentOf.get(pick); p; p = parentOf.get(p)) rendered.set(p, rendered.get(p)! - delta);
    }
    const parent = parentOf.get(pick);
    if (parent && parent !== root && isFrontier(parent)) frontier.add(parent);
  }

  // Pathological case: more loose files at the root than the budget allows.
  let rootOverflow = 0;
  if (total > budget) rootOverflow = total - budget + 1;
  return { aggregated: aggregated.sort(byPath), rootOverflow };
}

export interface BuildModelOptions {
  budget?: number;
}

export function buildRepoModel(snapshot: RepoSnapshot, options: BuildModelOptions = {}): RepoModel {
  const budget = options.budget ?? DEFAULT_BUILDING_BUDGET;
  const sorted = [...snapshot.entries].sort(byPath);
  const { kept, excluded } = filterEntries(sorted);
  excluded.skippedDirs = [...(snapshot.skippedDirs ?? [])].sort(byPath);

  // Directories that hold a package manifest are packages.
  const packageDirs = new Set<string>();
  for (const entry of kept) {
    const slash = entry.path.lastIndexOf("/");
    if (isManifest(entry.path.slice(slash + 1))) packageDirs.add(slash > 0 ? entry.path.slice(0, slash) : "");
  }

  const root = makeDir("", null);
  root.isPackage = packageDirs.has("");
  const dirsByPath = new Map<string, DirNode>([["", root]]);
  const ensureDir = (path: string): DirNode => {
    const existing = dirsByPath.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const parentPath = slash >= 0 ? path.slice(0, slash) : "";
    const parent = ensureDir(parentPath);
    const dir = makeDir(path, parentPath);
    dir.isPackage = packageDirs.has(path);
    parent.dirs.push(dir);
    dirsByPath.set(path, dir);
    return dir;
  };

  const files: FileNode[] = [];
  const filesByPath = new Map<string, FileNode>();
  for (const entry of kept) {
    const slash = entry.path.lastIndexOf("/");
    const dirPath = slash >= 0 ? entry.path.slice(0, slash) : "";
    const name = slash >= 0 ? entry.path.slice(slash + 1) : entry.path;
    const { language, category } = classifyFile(entry.path);
    const file: FileNode = {
      path: entry.path,
      name,
      ext: extensionOf(name),
      dirPath,
      size: entry.size ?? 0,
      language,
      category,
      depth: dirPath ? dirPath.split("/").length : 0,
    };
    const landmark = detectLandmark(entry.path, category, packageDirs);
    if (landmark) file.landmark = landmark;
    ensureDir(dirPath).files.push(file);
    files.push(file);
    filesByPath.set(file.path, file);
  }

  // Children are already in path order because entries were sorted.
  const stats = computeStats(root);
  const { aggregated, rootOverflow } = aggregateToBudget(root, budget);

  // Point files at the outermost aggregated ancestor they are drawn inside.
  if (aggregated.length) {
    const mark = (dir: DirNode, into: string | undefined) => {
      const target = into ?? (dir.aggregated ? dir.path : undefined);
      if (target !== undefined) for (const f of dir.files) f.aggregatedInto = target;
      for (const child of dir.dirs) mark(child, target);
    };
    mark(root, undefined);
  }

  return {
    meta: snapshot.meta,
    ref: snapshot.ref,
    source: snapshot.source,
    origin: snapshot.origin ?? { kind: "github" },
    fetchedAt: snapshot.fetchedAt,
    capturedAt: snapshot.capturedAt,
    root,
    dirsByPath,
    files,
    filesByPath,
    stats,
    excluded,
    limits: {
      truncated: snapshot.truncated,
      buildingBudget: budget,
      aggregatedDirs: aggregated.filter(
        // Only report the outermost blocks. Nested ones are inside them anyway.
        (a) => !aggregated.some((b) => b !== a && a.path.startsWith(b.path + "/")),
      ),
      rootOverflow,
    },
  };
}
