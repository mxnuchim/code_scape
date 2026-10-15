"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { formatCompact, formatDate, formatNumber, plural } from "@/lib/format";
import { goToLanding } from "@/state/loader";
import { useCity, type TraceState } from "@/state/store";
import { FilterTray } from "./FilterTray";
import { RepoAvatar } from "./RepoAvatar";
import {
  BrandMark,
  IconAlert,
  IconBranch,
  IconHelp,
  IconHome,
  IconLayers,
  IconPlus,
  IconSearch,
  IconStar,
  IconTransit,
  IconZoomIn,
  IconZoomOut,
} from "./icons";

function RepoChip() {
  const model = useCity((s) => s.model);
  const panel = useCity((s) => s.panel);
  if (!model) return null;
  const { meta } = model;
  const badge =
    model.source === "bundled-snapshot"
      ? `Snapshot · ${formatDate(model.capturedAt!)}`
      : model.source === "session-cache"
        ? "Cached this session"
        : null;
  return (
    <button
      type="button"
      className="glass pointer-events-auto flex max-w-[min(360px,calc(100vw-9rem))] items-center gap-2.5 rounded-[18px] py-1.5 pr-3.5 pl-1.5 text-left transition-transform hover:-translate-y-px"
      onClick={() => useCity.setState({ panel: panel === "repo" ? null : "repo", selected: null })}
      aria-expanded={panel === "repo"}
      aria-label={`About ${meta.fullName}`}
    >
      <RepoAvatar owner={meta.owner} size={34} />
      <span className="min-w-0">
        <span className="block truncate font-display text-[0.98rem] leading-tight font-bold tracking-tight">
          <span className="font-semibold text-ink-soft">{meta.owner}/</span>
          {meta.repo}
        </span>
        <span className="flex items-center gap-2 text-[0.72rem] text-ink-faint">
          <span className="inline-flex items-center gap-0.5">
            <IconStar size={12} /> {formatCompact(meta.stars)}
          </span>
          <span className="inline-flex min-w-0 items-center gap-0.5">
            <IconBranch size={12} />
            <span className="truncate">{model.source === "bundled-snapshot" ? model.ref.slice(0, 7) : model.ref}</span>
          </span>
          {badge && <span className="hidden truncate rounded-full bg-[#fff1cc] px-1.5 font-semibold text-[#8a5a00] sm:inline">{badge}</span>}
        </span>
      </span>
    </button>
  );
}

function traceSummary(trace: TraceState): string | null {
  if (trace.status === "done") {
    const g = trace.graph;
    return g.edges.length
      ? `Traced imports in ${formatNumber(g.traced.size)} of ${formatNumber(g.eligible)} source files · ${plural(g.edges.length, "connection")}`
      : `Traced ${formatNumber(g.traced.size)} files. No imports between them resolved to files in this repo`;
  }
  if (trace.status === "unsupported") return "No JavaScript, TypeScript or Python files to trace, so no connections are drawn";
  if (trace.status === "error") return "Couldn't trace imports. The city is unaffected, but no connections are drawn";
  return null;
}

function TraceStatus() {
  const trace = useCity((s) => s.trace);
  const assembled = useCity((s) => s.assembled);
  // The summary shows once per trace result, then retires itself.
  const [dismissed, setDismissed] = useState<TraceState | null>(null);
  const toast = assembled && dismissed !== trace ? traceSummary(trace) : null;

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setDismissed(trace), 6000);
    return () => window.clearTimeout(t);
  }, [toast, trace]);

  const running = trace.status === "running" && assembled;
  return (
    <AnimatePresence mode="wait">
      {running ? (
        <motion.div
          key="running"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="glass flex items-center gap-2.5 rounded-full py-1.5 pr-3.5 pl-2 text-[0.78rem]"
          role="status"
        >
          <span className="spin block h-3.5 w-3.5 rounded-full border-2 border-teal border-t-transparent" />
          <span className="font-semibold">Tracing imports</span>
          <span className="text-ink-faint tabular-nums">
            {formatNumber(trace.done)} / {formatNumber(trace.total)}
          </span>
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-black/10">
            <span className="block h-full rounded-full bg-teal transition-[width] duration-200" style={{ width: `${(trace.done / Math.max(1, trace.total)) * 100}%` }} />
          </span>
        </motion.div>
      ) : toast ? (
        <motion.button
          key="toast"
          type="button"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="glass pointer-events-auto max-w-[min(92vw,520px)] rounded-full px-3.5 py-1.5 text-center text-[0.78rem] font-medium"
          onClick={() => {
            setDismissed(trace);
            useCity.setState({ panel: "repo", selected: null });
          }}
          role="status"
        >
          <IconTransit size={14} className="mr-1.5 inline -translate-y-px text-teal" />
          {toast}
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}

function ControlCluster({ vertical }: { vertical: boolean }) {
  const camera = useCity((s) => s.camera);
  const trace = useCity((s) => s.trace);
  const transit = useCity((s) => s.transit);
  const panel = useCity((s) => s.panel);
  const filtersOpen = useCity((s) => s.filtersOpen);
  const traceDone = trace.status === "done";
  const transitHint =
    trace.status === "done"
      ? transit
        ? "Hide transit between districts (T)"
        : "Show transit between districts (T)"
      : trace.status === "running"
        ? `Tracing imports… ${trace.done}/${trace.total}`
        : "No traced imports to show";
  return (
    <div className={`glass pointer-events-auto flex gap-0.5 rounded-[18px] p-1 ${vertical ? "flex-col" : "flex-row"}`}>
      {!vertical && (
        <button
          type="button"
          className="icon-btn"
          aria-pressed={filtersOpen}
          aria-label="Legend and filters"
          onClick={() => useCity.setState({ filtersOpen: !filtersOpen, panel: null })}
        >
          <IconLayers />
        </button>
      )}
      <button type="button" className="icon-btn" aria-label="Show the whole city (H)" title="Whole city (H)" onClick={() => camera?.overview()}>
        <IconHome />
      </button>
      {vertical && (
        <>
          <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => camera?.zoom(1)}>
            <IconZoomIn />
          </button>
          <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => camera?.zoom(-1)}>
            <IconZoomOut />
          </button>
        </>
      )}
      <span className={vertical ? "mx-2 my-0.5 h-px bg-black/10" : "mx-0.5 my-2 w-px bg-black/10"} />
      <button
        type="button"
        className="icon-btn relative"
        aria-pressed={transit}
        aria-label={transitHint}
        title={transitHint}
        disabled={!traceDone}
        onClick={() => useCity.setState({ transit: !transit, selected: null })}
      >
        <IconTransit />
        {trace.status === "running" && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={panel === "help"}
        aria-label="How to read the city (?)"
        title="How to read the city (?)"
        onClick={() => useCity.setState({ panel: panel === "help" ? null : "help" })}
      >
        <IconHelp />
      </button>
    </div>
  );
}

function Notices() {
  const model = useCity((s) => s.model);
  if (!model) return null;
  if (!model.limits.truncated) return null;
  return (
    <button
      type="button"
      className="pointer-events-auto mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#fff1cc]/95 px-3 py-1.5 text-[0.74rem] font-semibold text-[#7a4f00] shadow-sm ring-1 ring-[#f5d27a]"
      onClick={() => useCity.setState({ panel: "repo", selected: null })}
    >
      <IconAlert size={14} /> GitHub truncated this tree. The city is partial.
    </button>
  );
}

export function Hud() {
  const searchOpen = useCity((s) => s.searchOpen);
  return (
    <motion.div
      className="absolute inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.4, duration: 0.5 } }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
    >
      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-start gap-2 p-3 sm:p-4">
        <div className="flex min-w-0 flex-col items-start">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="glass pointer-events-auto hidden h-[46px] w-[46px] place-items-center rounded-[16px] transition-transform hover:-translate-y-px sm:grid"
              onClick={() => goToLanding()}
              aria-label="CodeScape home"
              title="CodeScape"
            >
              <BrandMark size={28} />
            </button>
            <RepoChip />
          </div>
          <Notices />
        </div>
        <div className="flex-1" />
        <button
          type="button"
          className="glass pointer-events-auto absolute top-4 left-1/2 hidden h-[46px] -translate-x-1/2 items-center gap-2.5 rounded-full pr-2 pl-4 text-[0.88rem] text-ink-soft transition-transform hover:-translate-y-px lg:flex"
          onClick={() => useCity.setState({ searchOpen: !searchOpen })}
          aria-label="Search files and folders"
        >
          <IconSearch size={17} />
          <span className="w-56 text-left">Search files and folders</span>
          <span className="kbd">/</span>
        </button>
        <button
          type="button"
          className="glass pointer-events-auto grid h-[46px] w-[46px] place-items-center rounded-[16px] lg:hidden"
          onClick={() => useCity.setState({ searchOpen: true })}
          aria-label="Search files and folders"
        >
          <IconSearch size={19} />
        </button>
        <button
          type="button"
          className="btn btn-quiet glass pointer-events-auto h-[46px] w-[46px] shrink-0 sm:w-auto sm:px-4"
          onClick={() => goToLanding()}
          aria-label="Build a new city"
        >
          <IconPlus size={18} />
          <span className="hidden text-[0.88rem] sm:inline">New city</span>
        </button>
      </div>

      {/* Bottom: legend & filters (desktop), status, controls */}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:bottom-16 sm:p-4">
        <div className="hidden sm:block">
          <FilterTray />
        </div>
        <div className="flex flex-1 justify-center">
          <TraceStatus />
        </div>
        <div className="hidden sm:block">
          <ControlCluster vertical />
        </div>
      </div>

      {/* Mobile dock and filter sheet */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
        <div className="mb-11 w-full">
          <FilterTray mobile />
        </div>
        <div className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))]">
          <ControlCluster vertical={false} />
        </div>
      </div>
    </motion.div>
  );
}
