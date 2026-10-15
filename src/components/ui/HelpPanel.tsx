"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { ARCHETYPE_INFO, type Archetype } from "@/lib/layout/archetypes";
import { PARSED_LANGUAGES_AND } from "@/lib/analysis/languages";
import { useCity } from "@/state/store";
import { ArchetypeGlyph, IconClose } from "./icons";
import { useMediaQuery } from "./common";
import { BasisBadge } from "./Evidence";
import { useFocusTrap } from "./useFocusTrap";

const SHAPES: Archetype[] = ["tower", "lab", "silo", "factory", "house", "pavilion", "warehouse", "crates", "kiosk", "block"];
const LANDMARKS: Archetype[] = ["townhall", "clocktower", "lighthouse", "monument"];

export function HelpPanel() {
  const open = useCity((s) => s.panel === "help");
  const touch = useMediaQuery("(pointer: coarse)");
  const close = () => useCity.setState({ panel: null });
  const dialog = useRef<HTMLElement>(null);
  useFocusTrap(dialog, open);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <motion.section
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label="How to read the city"
            className="glass-strong scroll-soft max-h-[88dvh] w-full max-w-[680px] overflow-y-auto rounded-xl p-5 sm:p-7"
            initial={{ y: 16, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[20px] leading-tight font-semibold tracking-tight">How to read the city</h2>
                <p className="mt-1 text-[0.88rem] text-ink-soft">Everything you see comes from the repository&apos;s real files. Nothing was run.</p>
              </div>
              <button type="button" className="icon-btn shrink-0" onClick={close} aria-label="Close help">
                <IconClose />
              </button>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[0.7rem] font-semibold tracking-[0.08em] text-ink-faint uppercase">The map</h3>
                <ul className="space-y-2 text-[0.84rem] leading-snug text-ink-soft">
                  <li><b className="text-ink">Districts</b> are top-level folders, labelled on the ground. Blocks inside them are subfolders.</li>
                  <li><b className="text-ink">Buildings</b> are files. Height shows file size on a log scale; compare heights between buildings of the same shape.</li>
                  <li>
                    <b className="text-ink">Language</b> shows on each building&apos;s lit band, judged from the file extension. The
                    legend&apos;s lens can paint whole facades by language or role instead.
                  </li>
                  <li><b className="text-ink">Streets</b> separate folders. They show structure, not dependencies.</li>
                  <li>
                    <b className="text-ink">Arcs</b> are imports and calls parsed from {PARSED_LANGUAGES_AND} source. An arc is drawn only
                    when it resolves to a real file in the repo. They are static: they show code relationships, not traffic.
                  </li>
                  <li>
                    <b className="text-[#c9c0ff]">Journeys</b> (violet, numbered) follow resolved calls from an entry point, such as an HTTP route, in
                    source order. A dashed line rising out of a building means the code calls into a package.
                  </li>
                  <li>Dependencies, build output, caches and lockfiles are left out. The repo panel lists exactly what.</li>
                  <li>
                    <b className="text-ink">City styles and time of day</b> only change the look. Every style places the same files in the
                    same spots, and lit windows or streetlights never stand for runtime activity.
                  </li>
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-[0.7rem] font-semibold tracking-[0.08em] text-ink-faint uppercase">Shapes</h3>
                <ul className="grid grid-cols-1 gap-1.5">
                  {SHAPES.map((a) => (
                    <li key={a} className="flex items-start gap-2.5 text-[0.8rem]">
                      <span className="mt-0.5 text-[#5b8ee6]">
                        <ArchetypeGlyph archetype={a} size={18} />
                      </span>
                      <span>
                        <b className="font-semibold">{ARCHETYPE_INFO[a].name}</b> <span className="text-ink-soft">· {ARCHETYPE_INFO[a].meaning}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <h3 className="mt-4 mb-2 text-[0.7rem] font-semibold tracking-[0.08em] text-ink-faint uppercase">Landmarks</h3>
                <ul className="grid grid-cols-1 gap-1.5">
                  {LANDMARKS.map((a) => (
                    <li key={a} className="flex items-start gap-2.5 text-[0.8rem]">
                      <span className="mt-0.5 text-[#e0965a]">
                        <ArchetypeGlyph archetype={a} size={18} />
                      </span>
                      <span>
                        <b className="font-semibold">{ARCHETYPE_INFO[a].name}</b> <span className="text-ink-soft">· {ARCHETYPE_INFO[a].meaning}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <h3 className="mt-6 mb-2 text-[0.7rem] font-semibold tracking-[0.08em] text-ink-faint uppercase">How we know</h3>
            <ul className="grid gap-1.5 text-[0.82rem] text-ink-soft sm:grid-cols-3">
              <li className="flex items-start gap-2"><BasisBadge basis="fact" /> Read from files or manifests.</li>
              <li className="flex items-start gap-2"><BasisBadge basis="static-analysis" /> Parsed and resolved from source.</li>
              <li className="flex items-start gap-2"><BasisBadge basis="heuristic" /> Inferred from names; a hint.</li>
            </ul>

            <h3 className="mt-6 mb-2 text-[0.7rem] font-semibold tracking-[0.08em] text-ink-faint uppercase">Getting around</h3>
            {touch ? (
              <ul className="grid gap-1.5 text-[0.84rem] text-ink-soft sm:grid-cols-2">
                <li>Drag with one finger to orbit</li>
                <li>Pinch to zoom, two fingers to pan</li>
                <li>Tap a building or district for details</li>
                <li>The house button shows the whole city</li>
              </ul>
            ) : (
              <ul className="grid gap-1.5 text-[0.84rem] text-ink-soft sm:grid-cols-2">
                <li><span className="kbd">drag</span> orbit · <span className="kbd">right-drag</span> pan</li>
                <li><span className="kbd">scroll</span> zoom towards the cursor</li>
                <li><span className="kbd">W A S D</span> fly · <span className="kbd">Q E</span> turn · <span className="kbd">shift</span> faster</li>
                <li><span className="kbd">/</span> search · <span className="kbd">F</span> focus · <span className="kbd">H</span> whole city</li>
                <li><span className="kbd">G</span> guide · <span className="kbd">T</span> import flows · <span className="kbd">esc</span> step back</li>
                <li><span className="kbd">[</span> <span className="kbd">]</span> previous / next journey step</li>
                <li><span className="kbd">↑ ↓ ← →</span> fly · <span className="kbd">+ −</span> zoom</li>
                <li><span className="kbd">?</span> this help</li>
              </ul>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
