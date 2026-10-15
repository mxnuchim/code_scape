"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCity } from "@/state/store";
import { LocLink } from "./Evidence";
import { IconAlert, IconChevron, IconClose, IconRoute } from "./icons";

/** Controls for the journey being played: step through it with [ and ], leave with Esc. */
export function JourneyBar() {
  const focus = useCity((s) => s.journey);
  // Keep clear of the side panels on desktop; on phones sit under the top bar.
  const leftOpen = useCity((s) => s.panel === "guide" || s.panel === "repo");
  const rightOpen = useCity((s) => s.selected !== null);
  return (
    <AnimatePresence>
      {focus && (
        <motion.div
          key="journey"
          className={`pointer-events-none absolute inset-x-0 top-[116px] z-30 flex justify-center px-3 sm:top-auto sm:bottom-6 ${leftOpen ? "sm:pl-[420px]" : "sm:pl-24"} ${rightOpen ? "sm:pr-[420px]" : "sm:pr-24"}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
        >
          <JourneyControls />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function JourneyControls() {
  const focus = useCity((s) => s.journey)!;
  const { journey, step } = focus;
  const current = journey.steps[step];
  const gaps = journey.gaps.filter((g) => g.atStep === step);
  const total = journey.steps.length;
  const { stepJourney, playJourney } = useCity.getState();

  return (
    <section aria-label={`Journey ${journey.title}`} className="glass-strong pointer-events-auto w-[min(640px,100%)] rounded-xl p-3">
      <div className="flex items-center gap-2">
        <IconRoute size={16} className="shrink-0 text-[#9d8cff]" />
        <p className="min-w-0 flex-1 truncate font-mono text-[0.8rem] font-semibold">{journey.title}</p>
        <span className="shrink-0 font-mono text-[0.72rem] text-ink-faint tabular-nums" aria-live="polite">
          {step + 1} / {total}
        </span>
        <button type="button" className="icon-btn h-8 w-8" onClick={() => stepJourney(-1)} disabled={step === 0} aria-label="Previous step ([)" title="Previous step ([)">
          <IconChevron size={15} className="rotate-180" />
        </button>
        <button type="button" className="icon-btn h-8 w-8" onClick={() => stepJourney(1)} disabled={step >= total - 1} aria-label="Next step (])" title="Next step (])">
          <IconChevron size={15} />
        </button>
        <button type="button" className="icon-btn h-8 w-8" onClick={() => playJourney(null)} aria-label="Leave the journey (Esc)" title="Leave the journey (Esc)">
          <IconClose size={15} />
        </button>
      </div>
      {current && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-white/[0.07] pt-2 text-[0.78rem]">
          {current.kind === "external" ? (
            <span>
              Leaves the repository: <code className="font-mono">{current.name}</code> <span className="text-ink-soft">in {current.module}</span>
            </span>
          ) : (
            <span className="font-mono font-semibold">{current.name}</span>
          )}
          {current.kind !== "external" && current.range && <LocLink path={current.path} line={current.range.startLine} endLine={current.range.endLine} />}
          {current.via && (
            <span className="text-ink-faint">
              called at <LocLink path={current.via.path} line={current.via.line} />
            </span>
          )}
        </div>
      )}
      {gaps.map((g) => (
        <p key={`${g.path}:${g.line}:${g.reason}`} className="mt-1.5 flex items-start gap-1.5 text-[0.74rem] text-amber-300">
          <IconAlert size={13} className="mt-0.5 shrink-0" />
          <span>
            {g.reason} <LocLink path={g.path} line={g.line} label={`${g.path.split("/").pop()}:${g.line}`} />
          </span>
        </p>
      ))}
    </section>
  );
}
