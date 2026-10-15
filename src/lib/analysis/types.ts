import type { RepoMeta, SnapshotSource } from "../github/types";

export const CATEGORIES = [
  "source",
  "test",
  "config",
  "build",
  "docs",
  "style",
  "data",
  "asset",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type LandmarkKind = "readme" | "manifest" | "entry" | "license";

export interface FileNode {
  /** The repository path. Unique, and used as the id everywhere. */
  path: string;
  name: string;
  ext: string;
  dirPath: string;
  size: number;
  language: string;
  category: Category;
  landmark?: LandmarkKind;
  depth: number;
  /** Set when this file is rendered as part of an aggregated block. */
  aggregatedInto?: string;
}

export type CountMap = Record<string, number>;

export interface SubtreeStats {
  files: number;
  bytes: number;
  dirs: number;
  /** File counts per language id. */
  languages: CountMap;
  /** Byte counts per language id. */
  languageBytes: CountMap;
  categories: CountMap;
}

export interface DirNode {
  /** The repository path; "" for the root. */
  path: string;
  name: string;
  depth: number;
  parentPath: string | null;
  dirs: DirNode[];
  files: FileNode[];
  /** Directory contains a package manifest (package.json, Cargo.toml, …). */
  isPackage: boolean;
  /** When true, the whole subtree is drawn as one block building. */
  aggregated: boolean;
  stats: SubtreeStats;
}

export interface ExclusionSummary {
  files: number;
  bytes: number;
  byReason: CountMap;
  /** Excluded directories (outermost match) with file counts, largest first. */
  topDirs: { path: string; files: number; reason: string }[];
  submodules: string[];
}

export interface AnalysisLimits {
  /** GitHub reported that the tree listing was truncated. */
  truncated: boolean;
  buildingBudget: number;
  /** Directories drawn as a single block to stay within the building budget. */
  aggregatedDirs: { path: string; files: number }[];
  /** Root-level files folded into one overflow block, if any. */
  rootOverflow: number;
}

export interface RepoModel {
  meta: RepoMeta;
  ref: string;
  source: SnapshotSource;
  fetchedAt: number;
  capturedAt?: string;
  root: DirNode;
  dirsByPath: Map<string, DirNode>;
  /** Every analyzed file, including files inside aggregated blocks. */
  files: FileNode[];
  filesByPath: Map<string, FileNode>;
  stats: SubtreeStats;
  excluded: ExclusionSummary;
  limits: AnalysisLimits;
}
