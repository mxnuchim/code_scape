"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useCity } from "@/state/store";
import { CITY_STYLES, CITY_STYLE_IDS } from "@/theme/cityStyles";
import { autoNightFactor, describeNightFactor, type TimeMode } from "@/theme/timeOfDay";
import { IconAuto, IconBuildings, IconCheck, IconChevron, IconMoon, IconSun } from "./icons";

function useAutoLabel() {
  const [label, setLabel] = useState(() => describeNightFactor(autoNightFactor(new Date())));
  useEffect(() => {
    const t = window.setInterval(() => setLabel(describeNightFactor(autoNightFactor(new Date()))), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return label;
}

const TIME_OPTIONS: { mode: TimeMode; label: string; icon: typeof IconSun }[] = [
  { mode: "auto", label: "Auto", icon: IconAuto },
  { mode: "day", label: "Day", icon: IconSun },
  { mode: "night", label: "Night", icon: IconMoon },
];

/**
 * City style and time of day. Both are visual interpretations only; switching
 * them never changes which buildings exist or what they represent.
 */
export function EnvironmentControl({ compact = false }: { compact?: boolean }) {
  const cityStyle = useCity((s) => s.cityStyle);
  const timeMode = useCity((s) => s.timeMode);
  const setPreference = useCity((s) => s.setPreference);
  const autoLabel = useAutoLabel();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const style = CITY_STYLES[cityStyle];

  return (
    <div ref={root} className="glass pointer-events-auto relative flex items-center gap-1 rounded-lg p-1">
      <button
        type="button"
        className="btn h-8 gap-2 rounded-md px-2.5 text-[12.5px] text-ink hover:bg-white/[0.07]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`City style: ${style.name}`}
        onClick={() => setOpen(!open)}
      >
        <IconBuildings size={15} className="text-ink-soft" />
        {!compact && <span>{style.name}</span>}
        <IconChevron size={13} className={`text-ink-faint transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      <span className="mx-0.5 h-5 w-px bg-white/10" />
      <div className="flex gap-0.5" role="radiogroup" aria-label="Time of day">
        {TIME_OPTIONS.map(({ mode, label, icon: Icon }) => {
          const active = timeMode === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={active}
              className="seg h-8"
              title={mode === "auto" ? `Follow your local time (now: ${autoLabel})` : `Always ${label.toLowerCase()}`}
              onClick={() => setPreference({ timeMode: mode })}
            >
              <Icon size={14} />
              {(!compact || active) && (
                <span>
                  {label}
                  {mode === "auto" && active && <span className="text-ink-faint"> · {autoLabel}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="City style"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="glass-strong absolute top-[calc(100%+6px)] right-0 z-30 w-[280px] rounded-lg p-1"
          >
            <p className="eyebrow px-2.5 pt-2 pb-1.5">City style</p>
            {CITY_STYLE_IDS.map((id) => {
              const s = CITY_STYLES[id];
              const active = id === cityStyle;
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className="row-btn items-start"
                  onClick={() => {
                    setPreference({ cityStyle: id });
                    setOpen(false);
                  }}
                >
                  <span className="mt-1 flex h-3 w-3 shrink-0 overflow-hidden rounded-sm ring-1 ring-white/15">
                    <span className="w-1/2" style={{ background: s.facade.stone[0] }} />
                    <span className="w-1/2" style={{ background: s.facade.glass[0] }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">{s.name}</span>
                    <span className="block text-[11.5px] text-ink-faint">{s.inspiration}</span>
                  </span>
                  {active && <IconCheck size={15} className="mt-0.5 text-accent" />}
                </button>
              );
            })}
            <p className="px-2.5 pt-1.5 pb-2 text-[11px] leading-snug text-ink-faint">
              Styles reinterpret the same files. Positions, sizes and connections never change.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
