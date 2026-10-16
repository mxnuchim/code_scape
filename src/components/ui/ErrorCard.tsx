"use client";

import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { formatDate, formatDuration } from "@/lib/format";
import { repoSlug } from "@/lib/github/parseRepoUrl";
import { BUNDLED_SAMPLE, goToLanding, loadBundledSnapshot, loadRepo, retryCurrent } from "@/state/loader";
import { useCity, type CityError } from "@/state/store";
import { IconAlert, IconArrowRight, IconClock, IconGitHub } from "./icons";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

const SNAPSHOT_DATE = formatDate(BUNDLED_SAMPLE.capturedAt);

interface Copy {
  tone: "warn" | "wait";
  title: string;
  body: ReactNode;
  actions: ReactNode;
}

function editAndBack() {
  goToLanding();
}

function SampleButton({ primary = false }: { primary?: boolean }) {
  return (
    <button
      type="button"
      className={`btn ${primary ? "btn-primary" : "btn-quiet"} px-4 py-2.5 text-sm`}
      onClick={() => void loadRepo({ owner: BUNDLED_SAMPLE.owner, repo: BUNDLED_SAMPLE.repo })}
    >
      Try a sample city
    </button>
  );
}

function SnapshotButton({ primary = false }: { primary?: boolean }) {
  return (
    <button type="button" className={`btn ${primary ? "btn-primary" : "btn-quiet"} px-4 py-2.5 text-sm`} onClick={() => void loadBundledSnapshot()}>
      Explore the bundled snapshot
      <span className="font-normal opacity-75">· {SNAPSHOT_DATE}</span>
    </button>
  );
}

function copyFor(error: CityError, now: number): Copy {
  const name = <b className="font-semibold text-ink">{repoSlug(error.repo)}</b>;
  const edit = (
    <button type="button" className="btn btn-quiet px-4 py-2.5 text-sm" onClick={editAndBack}>
      Edit the link
    </button>
  );
  const retry = (label = "Try again", disabled = false) => (
    <button type="button" className="btn btn-primary px-4 py-2.5 text-sm" onClick={retryCurrent} disabled={disabled}>
      {label}
    </button>
  );

  switch (error.kind) {
    case "local-unavailable":
      return {
        tone: "warn",
        title: "The local repository couldn’t be loaded",
        body: (
          <>
            {error.message ?? "The local CodeScape server didn’t return an analysis."} Local mode needs the viewer that{" "}
            <code className="font-mono text-[0.85em]">codescape view --root &lt;folder&gt;</code> starts on this machine.
          </>
        ),
        actions: (
          <>
            <button type="button" className="btn btn-quiet px-4 py-2.5 text-sm" onClick={editAndBack}>
              Open a GitHub repository
            </button>
            {retry()}
          </>
        ),
      };
    case "not-found-or-private":
      return {
        tone: "warn",
        title: "Repository not found or private",
        body: (
          <>
            We couldn&apos;t open {name}. It may be private, renamed or deleted, or it may never have existed. GitHub answers all of
            those the same way for visitors, so we can&apos;t tell which. The web app reads public repositories; for private code, run CodeScape locally
            (<code className="font-mono text-[0.85em]">codescape view</code>).
          </>
        ),
        actions: (
          <>
            {edit}
            <SampleButton primary />
          </>
        ),
      };
    case "ref-not-found":
      return {
        tone: "warn",
        title: "Branch, tag or commit not found",
        body: (
          <>
            {name} exists, but GitHub couldn&apos;t find the branch, tag or commit <code className="font-mono text-[0.85em]">{error.repo.ref}</code>.
          </>
        ),
        actions: (
          <>
            {edit}
            {error.defaultBranch && (
              <button
                type="button"
                className="btn btn-primary px-4 py-2.5 text-sm"
                onClick={() => void loadRepo({ owner: error.repo.owner, repo: error.repo.repo })}
              >
                Use {error.defaultBranch} instead
              </button>
            )}
          </>
        ),
      };
    case "empty-repo":
      return {
        tone: "warn",
        title: "This repository is empty",
        body: <>{name} has no commits yet, so there&apos;s nothing to build.</>,
        actions: (
          <>
            {edit}
            <SampleButton primary />
          </>
        ),
      };
    case "nothing-to-build":
      return {
        tone: "warn",
        title: "No project files to show",
        body: (
          <>
            Every file in {name} is a dependency, build output, lockfile or generated file. We skip those so the city shows
            the project&apos;s own code, and that left nothing standing.
          </>
        ),
        actions: (
          <>
            {edit}
            <SampleButton primary />
          </>
        ),
      };
    case "rate-limited": {
      const resetAt = error.rateLimit?.resetAt ?? now;
      const left = resetAt - now;
      const time = new Date(resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return {
        tone: "wait",
        title: "GitHub API rate limit reached",
        body: (
          <>
            GitHub allows visitors without an account {error.rateLimit?.limit ?? 60} requests an hour, and this connection has used
            them all. Each new city costs about two.{" "}
            {left > 0 ? (
              <>
                It reopens in <b className="font-semibold text-ink tabular-nums">{formatDuration(left)}</b> (at {time}).
              </>
            ) : (
              <>It should be open again now.</>
            )}
          </>
        ),
        actions: (
          <>
            {retry(left > 0 ? `Retry in ${formatDuration(left)}` : "Try again", left > 0)}
            <SnapshotButton />
          </>
        ),
      };
    }
    case "secondary-rate-limit": {
      const left = error.at + (error.retryAfterMs ?? 60_000) - now;
      return {
        tone: "wait",
        title: "GitHub asked us to slow down",
        body: <>Too many requests arrived too quickly. This short pause clears on its own.</>,
        actions: (
          <>
            {retry(left > 0 ? `Retry in ${formatDuration(left)}` : "Try again", left > 0)}
            <SnapshotButton />
          </>
        ),
      };
    }
    case "blocked":
      return {
        tone: "warn",
        title: "GitHub blocked access to this repository",
        body: (
          <>
            GitHub refused access to {name}
            {error.message ? <> (“{error.message}”)</> : null}. That&apos;s usually a legal or policy restriction on the
            repository.
          </>
        ),
        actions: (
          <>
            {edit}
            <SampleButton primary />
          </>
        ),
      };
    case "unavailable":
      return {
        tone: "wait",
        title: "GitHub is unavailable",
        body: <>GitHub&apos;s servers returned an error while we were reading {name}. These are usually brief.</>,
        actions: (
          <>
            {retry()}
            <SnapshotButton />
          </>
        ),
      };
    case "network":
      return {
        tone: "wait",
        title: "Network error",
        body: <>We couldn&apos;t reach GitHub. Check your connection, then try again.</>,
        actions: (
          <>
            {retry()}
            <SnapshotButton />
          </>
        ),
      };
    case "snapshot-unavailable":
      return {
        tone: "warn",
        title: "The sample snapshot is missing",
        body: <>The snapshot bundled with this app couldn&apos;t be loaded.</>,
        actions: (
          <>
            {retry()}
            {edit}
          </>
        ),
      };
    default:
      return {
        tone: "warn",
        title: "Something unexpected happened",
        body: (
          <>
            Building {name} failed{error.message ? <>: “{error.message}”</> : "."} Nothing is shown rather than a partial city.
          </>
        ),
        actions: (
          <>
            {retry()}
            {edit}
          </>
        ),
      };
  }
}

export function ErrorCard() {
  const error = useCity((s) => s.error);
  const counting = error?.kind === "rate-limited" || error?.kind === "secondary-rate-limit";
  const now = useNow(counting);
  if (!error) return null;
  const copy = copyFor(error, now);

  return (
    <motion.div
      className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-[7vh]"
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0, transition: { type: "spring", stiffness: 150, damping: 20, delay: 0.2 } }}
      exit={{ opacity: 0, y: 18, transition: { duration: 0.25 } }}
    >
      <section role="alert" className="glass-strong pointer-events-auto w-full max-w-[520px] rounded-xl p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-3">
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
              copy.tone === "wait" ? "bg-amber-400/10 text-amber-300" : "bg-orange-500/10 text-orange-300"
            }`}
          >
            {copy.tone === "wait" ? <IconClock size={21} /> : <IconAlert size={21} />}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-ink-faint">
              <IconGitHub size={12} />
              <span className="truncate">{repoSlug(error.repo)}</span>
            </p>
            <h2 className="text-[17px] leading-tight font-semibold tracking-tight">{copy.title}</h2>
          </div>
        </div>
        <p className="text-[0.92rem] leading-relaxed text-ink-soft">{copy.body}</p>
        <div className="mt-5 flex flex-wrap items-center gap-2">{copy.actions}</div>
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-1 text-[0.8rem] font-semibold text-ink-soft hover:text-ink"
          onClick={() => goToLanding()}
        >
          Back to the start <IconArrowRight size={14} />
        </button>
      </section>
    </motion.div>
  );
}
