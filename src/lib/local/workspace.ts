/**
 * A checked-out repository on this machine, analysed with the shared engine.
 *
 * Keeps the latest analysis in memory and refreshes it when files change:
 * every access re-walks the tree (cheap: stats only) at most once per
 * `freshnessIntervalMs`, compares fingerprints and re-parses only files whose
 * size or mtime changed. Nothing here executes repository code or talks to
 * the network.
 */
import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { RepoMeta, RepoSnapshot } from "../github/types";
import { analyzeRepository, type WorkspaceAnalysis } from "../analysis/workspace";
import type { ParsedFile } from "../analysis/code/types";
import type { RepoModel } from "../analysis/types";
import { initNodeParsers } from "./wasm";
import { readGitRevision } from "./revision";
import { isSensitivePath, readRepoText, redactSecrets, PathAccessError } from "./safety";
import { walkRepository, type FileStamp, type WalkResult } from "./walk";

export interface LocalWorkspaceOptions {
  /** Max files to parse. */
  cap?: number;
  /** Max total bytes of source to parse. */
  byteBudget?: number;
  /** Max entries to walk. */
  maxEntries?: number;
  /** Stop parsing new files after this long. */
  timeBudgetMs?: number;
  /** How often to re-check the working tree for changes. */
  freshnessIntervalMs?: number;
}

export const LOCAL_DEFAULTS = {
  cap: 4000,
  byteBudget: 40 * 1024 * 1024,
  maxEntries: 100_000,
  timeBudgetMs: 60_000,
  freshnessIntervalMs: 2_000,
} satisfies Required<LocalWorkspaceOptions>;

export interface AnalysisState {
  analysis: WorkspaceAnalysis;
  model: RepoModel;
  walk: WalkResult;
  /** True when this call re-analysed because files changed since the previous analysis. */
  refreshed: boolean;
}

export class LocalWorkspace {
  private state: Promise<AnalysisState> | null = null;
  private current: AnalysisState | null = null;
  private lastCheck = 0;
  private parseCache = new Map<string, { stamp: string; parsed: ParsedFile }>();
  private texts = new Map<string, string>();
  private readonly opts: Required<LocalWorkspaceOptions>;

  private constructor(
    /** Symlink-resolved absolute path of the repository root. */
    readonly root: string,
    options: LocalWorkspaceOptions,
  ) {
    this.opts = { ...LOCAL_DEFAULTS, ...options };
  }

  static async open(root: string, options: LocalWorkspaceOptions = {}): Promise<LocalWorkspace> {
    let real: string;
    try {
      real = await realpath(root);
    } catch {
      throw new PathAccessError("not-found", `Repository folder not found: ${root}`);
    }
    if (!(await stat(real)).isDirectory()) throw new PathAccessError("not-a-file", `Not a folder: ${root}`);
    return new LocalWorkspace(real, options);
  }

  get name(): string {
    return basename(this.root);
  }

  /** The current analysis, re-analysing first if the working tree changed. */
  async get(): Promise<AnalysisState> {
    if (this.state && this.current && Date.now() - this.lastCheck < this.opts.freshnessIntervalMs) {
      return { ...this.current, refreshed: false };
    }
    if (this.state && !this.current) return this.state;
    if (this.current) {
      this.lastCheck = Date.now();
      const walk = await walkRepository(this.root, { maxEntries: this.opts.maxEntries });
      if (walk.fingerprint === this.current.analysis.fingerprint) return { ...this.current, refreshed: false };
      this.state = this.analyze(walk);
    } else {
      this.state = this.analyze();
    }
    try {
      this.current = await this.state;
      return this.current;
    } catch (err) {
      this.state = null;
      throw err;
    }
  }

  private async analyze(prewalked?: WalkResult): Promise<AnalysisState> {
    await initNodeParsers();
    const walk = prewalked ?? (await walkRepository(this.root, { maxEntries: this.opts.maxEntries }));
    this.lastCheck = Date.now();
    const revision = await readGitRevision(this.root);
    const name = this.name;
    const meta: RepoMeta = {
      owner: "local",
      repo: name,
      fullName: name,
      description: null,
      defaultBranch: revision?.branch ?? "",
      stars: 0,
      forks: 0,
      openIssues: 0,
      primaryLanguage: null,
      htmlUrl: "",
      pushedAt: null,
      sizeKb: Math.round(walk.entries.reduce((n, e) => n + (e.size ?? 0), 0) / 1024),
      topics: [],
      license: null,
      isFork: false,
      archived: false,
    };
    const snapshot: RepoSnapshot = {
      meta,
      ref: revision?.branch ?? (revision?.commit ? revision.commit.slice(0, 12) : "working tree"),
      entries: walk.entries,
      truncated: walk.truncated,
      fetchedAt: Date.now(),
      source: "local",
      origin: { kind: "local", name, root: this.root, revision },
      skippedDirs: walk.skippedDirs,
    };

    const stampKey = (s: FileStamp | undefined) => (s ? `${s.size}:${Math.round(s.mtimeMs)}` : "");
    const freshTexts = new Map<string, string>();
    const { model, analysis } = await analyzeRepository(
      snapshot,
      async (path) => {
        try {
          const text = await readRepoText(this.root, path);
          freshTexts.set(path, text);
          return text;
        } catch {
          return null;
        }
      },
      {
        cap: this.opts.cap,
        byteBudget: this.opts.byteBudget,
        timeBudgetMs: this.opts.timeBudgetMs,
        isWithheld: isSensitivePath,
        fingerprint: walk.fingerprint,
        cache: {
          get: (path) => {
            const hit = this.parseCache.get(path);
            if (!hit || hit.stamp !== stampKey(walk.stamps.get(path))) return undefined;
            const text = this.texts.get(path);
            if (text !== undefined) freshTexts.set(path, text);
            return hit.parsed;
          },
          set: (path, parsed) => this.parseCache.set(path, { stamp: stampKey(walk.stamps.get(path)), parsed }),
        },
      },
    );
    // Drop cache entries for files that no longer exist.
    for (const path of this.parseCache.keys()) if (!walk.stamps.has(path)) this.parseCache.delete(path);
    this.texts = freshTexts;
    return { analysis, model, walk, refreshed: true };
  }

  /**
   * Lines `startLine..endLine` of a file, redacted. Throws PathAccessError
   * for paths outside the repo, withheld files, binaries and oversized files.
   */
  async excerpt(path: string, startLine = 1, endLine = startLine + 40, maxLines = 120) {
    const text = this.texts.get(path) ?? (await readRepoText(this.root, path));
    const lines = text.split("\n");
    const start = Math.max(1, Math.min(startLine, lines.length));
    const end = Math.max(start, Math.min(endLine, lines.length, start + maxLines - 1));
    const { text: redacted, redactions } = redactSecrets(lines.slice(start - 1, end).join("\n"));
    return { path, startLine: start, endLine: end, totalLines: lines.length, text: redacted, redactions };
  }

  /**
   * Case-insensitive search of parsed file contents. Lines are ranked by how
   * many of the terms they contain; at most two lines per file. Snippets are
   * redacted.
   */
  searchContent(terms: string[], limit = 20): { path: string; line: number; text: string; matched: number }[] {
    const needles = [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 2))];
    if (!needles.length) return [];
    const hits: { path: string; line: number; text: string; matched: number; score: number }[] = [];
    for (const [path, text] of this.texts) {
      const lower = text.toLowerCase();
      const fileMatched = needles.filter((n) => lower.includes(n)).length;
      if (fileMatched === 0 || fileMatched < Math.ceil(needles.length / 2)) continue;
      const lines = lower.split("\n");
      const best: { line: number; matched: number }[] = [];
      for (let i = 0; i < lines.length; i++) {
        const matched = needles.filter((n) => lines[i].includes(n)).length;
        if (matched === 0) continue;
        best.push({ line: i + 1, matched });
      }
      best.sort((a, b) => b.matched - a.matched || a.line - b.line);
      const original = text.split("\n");
      for (const b of best.slice(0, 2)) {
        hits.push({
          path,
          line: b.line,
          matched: b.matched,
          text: redactSecrets(original[b.line - 1].trim().slice(0, 200)).text,
          score: b.matched * 10 + fileMatched,
        });
      }
    }
    return hits
      .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line))
      .slice(0, limit)
      .map((h) => ({ path: h.path, line: h.line, text: h.text, matched: h.matched }));
  }
}
