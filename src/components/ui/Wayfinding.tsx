"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { LANGUAGES } from "@/lib/analysis/languages";
import { formatNumber, plural } from "@/lib/format";
import { useCity } from "@/state/store";
import { endTour, startTour, stepTour, useWayfinding } from "@/state/wayfinding";
import { BasisBadge, LocLink } from "./Evidence";
import { IconChevron, IconClose, IconRoute } from "./icons";

/**
 * Same footprint as the journey bar: bottom-centre, clear of open side panels.
 * On phones the tour bar sits under the top bar (like the journey bar) and the
 * welcome card above the bottom dock.
 */
function useBarFrame(phone: "under-top-bar" | "above-dock") {
  const leftOpen = useCity((s) => s.panel === "guide" || s.panel === "repo");
  const rightOpen = useCity((s) => s.selected !== null);
  const phonePlace = phone === "under-top-bar" ? "top-[116px] sm:top-auto" : "bottom-[76px]";
  return `pointer-events-none absolute inset-x-0 ${phonePlace} z-30 flex justify-center px-3 sm:bottom-6 ${leftOpen ? "sm:pl-[420px]" : "sm:pl-24"} ${rightOpen ? "sm:pr-[420px]" : "sm:pr-24"}`;
}

const spring = { type: "spring", stiffness: 320, damping: 30 } as const;

/**
 * Greets a newly opened city: what this repository is, how big, and one clear
 * next step. The Start-here pins rise in the city behind it.
 */
export function ArrivalCard() {
  const open = useCity((s) => s.arrivalOpen && !s.journey && !s.tour);
  // On phones the card sits above the dock, so the city stays visible above it.
  const frame = useBarFrame("above-dock");
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="arrival" className={frame} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={spring}>
          <ArrivalContent />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ArrivalContent() {
  const model = useCity((s) => s.model);
  const analysis = useCity((s) => s.analysis);
  const trace = useCity((s) => s.trace);
  const wayfinding = useWayfinding();
  if (!model) return null; // leaving the city while the card animates out
  const local = model.origin.kind === "local" ? model.origin : null;
  const name = local ? local.name : model.meta.fullName;
  const description = analysis?.overview.description?.text ?? (local ? null : model.meta.description);
  const topLanguages = Object.entries(model.stats.languages)
    .filter(([id]) => LANGUAGES[id] && id !== "other")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => LANGUAGES[id].name);
  const stops = wayfinding?.waypoints.length ?? 0;
  const close = () => useCity.getState().set({ arrivalOpen: false });

  return (
    <section aria-label={`About ${name}`} className="glass-strong pointer-events-auto w-[min(560px,100%)] rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{local ? "Local repository" : "GitHub repository"}</p>
          <h2 className="truncate text-[17px] leading-tight font-semibold tracking-tight">{name}</h2>
        </div>
        <button type="button" className="icon-btn h-8 w-8 shrink-0" onClick={close} aria-label="Close (Esc)" title="Close (Esc)">
          <IconClose size={15} />
        </button>
      </div>

      <div className="mt-2 flex items-start gap-2 text-[0.84rem] leading-snug">
        {analysis ? (
          <>
            <BasisBadge basis={analysis.overview.projectType.basis} />
            <span className="font-semibold">{analysis.overview.projectType.label}</span>
          </>
        ) : trace.status === "running" ? (
          <span className="flex items-center gap-2 text-ink-soft">
            <span className="spin block h-3.5 w-3.5 rounded-full border-2 border-teal border-t-transparent" />
            Reading the code · {trace.done}/{trace.total} files
          </span>
        ) : (
          <span className="text-ink-soft">Mapped from the file tree</span>
        )}
      </div>
      {description && <p className="mt-1.5 line-clamp-1 text-[0.8rem] leading-relaxed text-ink-soft sm:line-clamp-2">{description}</p>}
      <p className="mt-2 hidden font-mono text-[0.72rem] text-ink-faint sm:block">
        {plural(model.stats.files, "file")} · {plural(model.root.dirs.length, "top-level folder")}
        {topLanguages.length > 0 && ` · ${topLanguages.join(", ")}`}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary px-4 py-2 text-[0.84rem]" disabled={stops === 0} onClick={() => startTour(0)}>
          Show me where to start
          <IconChevron size={14} />
        </button>
        <button type="button" className="btn btn-quiet px-3 py-2 text-[0.84rem]" onClick={close}>
          Explore on my own
        </button>
        <button
          type="button"
          className="ml-auto hidden text-[0.76rem] font-semibold text-ink-faint hover:text-ink sm:block"
          onClick={() => {
            close();
            useCity.getState().set({ panel: "guide" });
          }}
        >
          Full guide (G)
        </button>
      </div>
      {stops > 0 && (
        <p className="mt-2.5 hidden text-[0.72rem] text-ink-faint sm:block">
          The numbered pins in the city are a reading order, {formatNumber(stops)} stops long. Click any of them to jump in.
        </p>
      )}
    </section>
  );
}

/** The "Start here" tour: one stop at a time, with why it matters and a way into a code journey. */
export function TourBar() {
  const open = useCity((s) => s.tour !== null && !s.journey);
  const frame = useBarFrame("under-top-bar");
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="tour" className={frame} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={spring}>
          <TourContent />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TourContent() {
  // Keep the last stop while the bar animates out (the tour is already cleared by then).
  const live = useCity((s) => s.tour);
  const [shown, setShown] = useState(live);
  if (live && live !== shown) setShown(live);
  const tour = live ?? shown;
  const analysis = useCity((s) => s.analysis);
  const wayfinding = useWayfinding();
  const stops = wayfinding?.waypoints ?? [];
  const stop = tour ? stops[tour.step] : undefined;
  if (!tour || !wayfinding || !stop) return null;
  const last = tour.step >= stops.length - 1;

  // A journey that starts at this stop, or, at the end of the tour, the guide's representative one.
  const trail = wayfinding.trailheads.find((t) => t.buildingId === stop.buildingId);
  const journeyId = trail?.journeyId ?? (last ? (analysis?.onboarding.representativeJourney ?? wayfinding.trailheads[0]?.journeyId) : undefined);
  const journey = journeyId ? analysis?.journeys.find((j) => j.id === journeyId) : undefined;

  return (
    <section aria-label="Start here" className="glass-strong pointer-events-auto w-[min(640px,100%)] rounded-xl p-3">
      <div className="flex items-center gap-2">
        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1 font-mono text-[11px] font-bold text-[#1a1206]">{stop.order}</span>
        <p className="min-w-0 flex-1 truncate text-[0.8rem] font-semibold">Start here</p>
        <span className="shrink-0 font-mono text-[0.72rem] text-ink-faint tabular-nums" aria-live="polite">
          {tour.step + 1} / {stops.length}
        </span>
        <button type="button" className="icon-btn h-8 w-8" onClick={() => stepTour(-1)} disabled={tour.step === 0} aria-label="Previous stop ([)" title="Previous stop ([)">
          <IconChevron size={15} className="rotate-180" />
        </button>
        <button type="button" className="icon-btn h-8 w-8" onClick={() => (last ? endTour() : stepTour(1))} aria-label={last ? "Finish the tour" : "Next stop (])"} title={last ? "Finish" : "Next stop (])"}>
          {last ? <IconClose size={15} /> : <IconChevron size={15} />}
        </button>
        {!last && (
          <button type="button" className="icon-btn h-8 w-8" onClick={endTour} aria-label="Leave the tour (Esc)" title="Leave the tour (Esc)">
            <IconClose size={15} />
          </button>
        )}
      </div>
      <div className="mt-2 border-t border-white/[0.07] pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <LocLink path={stop.path} />
          <BasisBadge basis={stop.basis} />
        </div>
        <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-soft">{stop.reason}</p>
        {wayfinding.provisional && <p className="mt-1 text-[0.72rem] text-ink-faint">Still reading the code: entry points and journeys will join the tour when it finishes.</p>}
      </div>
      {(journey || !last) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {!last && (
            <button type="button" className="btn btn-primary px-3 py-1.5 text-[0.8rem]" onClick={() => stepTour(1)}>
              Next: {stops[tour.step + 1].title}
              <IconChevron size={13} />
            </button>
          )}
          {journey && (
            <button
              type="button"
              className="btn btn-quiet px-3 py-1.5 text-[0.8rem] text-[#cfc8ff]"
              onClick={() => useCity.getState().playJourney(journey)}
              title="Follow this operation through the code, one call at a time"
            >
              <IconRoute size={14} />
              Follow {journey.kind === "main" ? "the program" : journey.title}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
