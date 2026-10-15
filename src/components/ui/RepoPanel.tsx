"use client";

import { getLastRateLimit } from "@/lib/github/client";
import { formatBytes, formatCompact, formatDate, formatNumber, plural, timeAgo } from "@/lib/format";
import { PARSED_LANGUAGES_AND, PARSED_LANGUAGES_OR } from "@/lib/analysis/languages";
import { useCity } from "@/state/store";
import { Badge, Fact, Section, languageBar } from "./common";
import { ClaudeConnect } from "./ClaudeConnect";
import { IconAlert, IconExternal, IconGitHub } from "./icons";
import { RepoAvatar } from "./RepoAvatar";
import { Sheet } from "./Sheet";

/** Everything about the repository and, honestly, about what we did and didn't analyse. */
export function RepoPanel() {
  const model = useCity((s) => s.model);
  const layout = useCity((s) => s.layout);
  const trace = useCity((s) => s.trace);
  const open = useCity((s) => s.panel === "repo");
  const analysis = useCity((s) => s.analysis);
  if (!model || !layout) return null;
  const { meta, excluded, limits } = model;
  const local = model.origin.kind === "local" ? model.origin : null;
  const rate = local ? null : getLastRateLimit();

  const header = (
    <div className="flex items-start gap-3">
      <RepoAvatar owner={meta.owner} size={44} />
      <div className="min-w-0">
        <h2 className="truncate text-[16px] leading-tight font-semibold tracking-tight">
          {!local && <span className="font-semibold text-ink-soft">{meta.owner}/</span>}
          {meta.repo}
        </h2>
        {local ? (
          <p className="truncate font-mono text-[0.72rem] text-ink-faint" title={local.root}>
            {local.root}
          </p>
        ) : (
          <a href={meta.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[0.76rem] font-semibold text-ink-soft hover:text-ink">
            <IconGitHub size={13} /> View on GitHub <IconExternal size={12} />
          </a>
        )}
      </div>
    </div>
  );

  return (
    <Sheet open={open} side="left" label="About this repository" onClose={() => useCity.setState({ panel: null })} header={header}>
      {local ? (
        <Section title="Repository">
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Branch" value={<span className="font-mono text-[0.8rem]">{local.revision?.branch ?? "detached / none"}</span>} />
            <Fact label="Commit" value={<span className="font-mono text-[0.8rem]">{local.revision?.commit?.slice(0, 10) ?? "unknown"}</span>} />
          </dl>
          <p className="mt-3 text-[0.76rem] leading-relaxed text-ink-soft">
            Read from this machine&apos;s working tree, including uncommitted changes. Branch and commit come from <span className="font-mono">.git</span> files;
            git itself is never run, and nothing is sent anywhere.
          </p>
        </Section>
      ) : (
      <Section title="Repository">
        {meta.description && <p className="mb-3 text-[0.86rem] leading-relaxed text-ink-soft">{meta.description}</p>}
        <dl className="grid grid-cols-3 gap-3">
          <Fact label="Stars" value={formatCompact(meta.stars)} />
          <Fact label="Forks" value={formatCompact(meta.forks)} />
          <Fact label="License" value={meta.license ?? "None"} />
          <Fact label="Branch" value={<span className="font-mono text-[0.8rem]">{model.source === "bundled-snapshot" ? model.ref.slice(0, 7) : model.ref}</span>} />
          <Fact label="Last push" value={meta.pushedAt ? timeAgo(Date.parse(meta.pushedAt)) : "Unknown"} />
          <Fact label="GitHub says" value={meta.primaryLanguage ?? "–"} />
        </dl>
        {(meta.archived || meta.isFork) && (
          <div className="mt-3 flex gap-1.5">
            {meta.archived && <Badge tone="amber">Archived</Badge>}
            {meta.isFork && <Badge>Fork</Badge>}
          </div>
        )}
      </Section>
      )}

      {!local && <ClaudeConnect repo={{ owner: meta.owner, repo: meta.repo, ...(model.ref !== meta.defaultBranch ? { ref: model.ref } : {}) }} />}

      <Section title="In this city">
        <dl className="mb-3 grid grid-cols-3 gap-3">
          <Fact label="Files" value={formatNumber(model.stats.files)} />
          <Fact label="Folders" value={formatNumber(model.stats.dirs)} />
          <Fact label="Buildings" value={formatNumber(layout.buildings.length)} />
        </dl>
        <p className="mb-2 text-[0.72rem] text-ink-faint">Languages by bytes of analysed files (from file extensions)</p>
        {languageBar(model.stats.languageBytes, { unit: "bytes", format: formatBytes })}
      </Section>

      <Section title="Left out on purpose">
        {excluded.files === 0 && excluded.skippedDirs.length === 0 ? (
          <p className="text-[0.82rem] text-ink-soft">Nothing. Every file in the tree is in the city.</p>
        ) : (
          <>
            <p className="mb-2 text-[0.82rem] text-ink-soft">
              {plural(excluded.files, "file")} ({formatBytes(excluded.bytes)}) weren&apos;t built: dependencies, build output, caches, lockfiles and other generated files.
            </p>
            <ul className="space-y-1 text-[0.78rem]">
              {Object.entries(excluded.byReason)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, n]) => (
                  <li key={reason} className="flex justify-between gap-2">
                    <span className="capitalize">{reason}</span>
                    <span className="text-ink-faint tabular-nums">{formatNumber(n)}</span>
                  </li>
                ))}
            </ul>
            {excluded.skippedDirs.length > 0 && (
              <p className="mt-2 text-[0.74rem] text-ink-soft">
                Not scanned at all: <span className="font-mono text-[0.7rem]">{excluded.skippedDirs.slice(0, 5).map((d) => `${d.path}/`).join("  ")}</span>
              </p>
            )}
            {excluded.topDirs.length > 0 && (
              <p className="mt-2 truncate font-mono text-[0.7rem] text-ink-faint" title={excluded.topDirs.map((d) => d.path).join(", ")}>
                {excluded.topDirs
                  .slice(0, 4)
                  .map((d) => `${d.path}/`)
                  .join("  ")}
              </p>
            )}
          </>
        )}
        {excluded.submodules.length > 0 && (
          <p className="mt-2 text-[0.78rem] text-ink-soft">
            {plural(excluded.submodules.length, "submodule")} point to other repositories and aren&apos;t explored.
          </p>
        )}
      </Section>

      {(limits.truncated || limits.aggregatedDirs.length > 0 || limits.rootOverflow > 0) && (
        <Section title="Analysis limits">
          {limits.truncated && (
            <p className="mb-2 flex gap-2 rounded-lg bg-amber-400/10 p-3 text-[0.8rem] text-amber-300">
              <IconAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                GitHub truncated the file listing because the repository is very large (over 100,000 entries or 7 MB). This city
                shows only the part GitHub returned.
              </span>
            </p>
          )}
          {limits.aggregatedDirs.length > 0 && (
            <>
              <p className="mb-1.5 text-[0.8rem] text-ink-soft">
                To keep things smooth a city holds up to {formatNumber(limits.buildingBudget)} buildings, so{" "}
                {plural(limits.aggregatedDirs.length, "folder")} {limits.aggregatedDirs.length === 1 ? "is" : "are"} drawn as single blocks:
              </p>
              <ul className="space-y-0.5 font-mono text-[0.72rem] text-ink-soft">
                {limits.aggregatedDirs.slice(0, 8).map((d) => (
                  <li key={d.path} className="flex justify-between gap-2">
                    <span className="truncate">{d.path}/</span>
                    <span className="text-ink-faint">{formatNumber(d.files)}</span>
                  </li>
                ))}
                {limits.aggregatedDirs.length > 8 && <li className="text-ink-faint">…and {limits.aggregatedDirs.length - 8} more</li>}
              </ul>
            </>
          )}
          {limits.rootOverflow > 0 && (
            <p className="mt-2 text-[0.8rem] text-ink-soft">{plural(limits.rootOverflow, "root-level file")} share one overflow block.</p>
          )}
        </Section>
      )}

      <Section title="Connections">
        {trace.status === "done" ? (
          <div className="space-y-2 text-[0.8rem] text-ink-soft">
            <p>
              Parsed {formatNumber(trace.graph.traced.size)} of {formatNumber(trace.graph.eligible)} {PARSED_LANGUAGES_AND} files and found{" "}
              <b className="text-ink">{plural(trace.graph.edges.length, "import")}</b>
              {analysis ? (
                <>
                  {" "}and <b className="text-ink">{plural(analysis.index.callEdges.length, "resolved call")}</b>
                </>
              ) : null}{" "}
              between files in this repo.
            </p>
            {trace.graph.eligible > trace.graph.cap && (
              <p>Only the first {trace.graph.cap} are read (entry points first, then source by depth), so connections are partial.</p>
            )}
            {trace.graph.failed.size > 0 && <p>{plural(trace.graph.failed.size, "file")} couldn&apos;t be downloaded.</p>}
            {trace.graph.skippedLarge > 0 && <p>{plural(trace.graph.skippedLarge, "file")} over the size limit were skipped.</p>}
            {analysis && analysis.index.limits.withheld.length > 0 && <p>{plural(analysis.index.limits.withheld.length, "file")} that may hold secrets were listed but not read.</p>}
            {trace.graph.aliasSource && (
              <p>
                Path aliases come from <span className="font-mono">{trace.graph.aliasSource}</span>.
              </p>
            )}
            <p className="text-[0.74rem] text-ink-faint">
              Only imports that resolve to a real file are drawn: relative paths, tsconfig aliases, Python modules, Go packages in this
              module, Rust crate modules and Java packages. Package imports and other languages aren&apos;t traced. Nothing is inferred
              from folders being near each other.
            </p>
          </div>
        ) : trace.status === "running" ? (
          <p className="text-[0.8rem] text-ink-soft">
            Tracing imports… {trace.done}/{trace.total} files read.
          </p>
        ) : trace.status === "unsupported" ? (
          <p className="text-[0.8rem] text-ink-soft">No {PARSED_LANGUAGES_OR} files, so no connections are traced.</p>
        ) : trace.status === "error" ? (
          <p className="text-[0.8rem] text-ink-soft">Tracing failed: {trace.message}</p>
        ) : (
          <p className="text-[0.8rem] text-ink-soft">Not started.</p>
        )}
      </Section>

      <Section title="Data">
        <p className="text-[0.8rem] text-ink-soft">
          {model.source === "bundled-snapshot" ? (
            <>
              A snapshot bundled with CodeScape, captured from GitHub on {formatDate(model.capturedAt!)} at commit{" "}
              <span className="font-mono">{model.ref.slice(0, 7)}</span>. It may differ from the repository today.
            </>
          ) : local ? (
            <>Analysed on this machine {timeAgo(analysis?.analyzedAt ?? model.fetchedAt)}. Reload the page to pick up file changes.</>
          ) : model.source === "session-cache" ? (
            <>Fetched from GitHub {timeAgo(model.fetchedAt)} and reused from this session.</>
          ) : (
            <>Fetched live from GitHub {timeAgo(model.fetchedAt)}.</>
          )}
        </p>
        {rate && (
          <p className="mt-1.5 text-[0.74rem] text-ink-faint">
            {formatNumber(rate.remaining)} of {formatNumber(rate.limit)} GitHub API requests left this hour. Resets at{" "}
            {new Date(rate.resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
          </p>
        )}
      </Section>
    </Sheet>
  );
}
