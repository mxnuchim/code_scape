"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { CATEGORIES, type Category } from "@/lib/analysis/types";
import { formatNumber } from "@/lib/format";
import { useCity } from "@/state/store";
import { CATEGORY_COLORS, CATEGORY_META, languageColor } from "@/theme/palette";
import type { ColorLens } from "@/state/preferences";

const LENSES: { id: ColorLens; label: string; hint: string }[] = [
  { id: "architectural", label: "Material", hint: "Believable materials; language shown on each building's band" },
  { id: "language", label: "Language", hint: "Facades painted by programming language" },
  { id: "role", label: "Role", hint: "Facades painted by what the file does" },
];
import { languageName } from "./common";
import { ArchetypeGlyph, IconClose, IconIsolate, IconLayers } from "./icons";

const LANG_LIMIT = 9;

/** Legend and filters in one: every chip shows how a building looks and toggles it. */
export function FilterTray({ mobile = false }: { mobile?: boolean }) {
  const model = useCity((s) => s.model);
  const layout = useCity((s) => s.layout);
  const open = useCity((s) => s.filtersOpen);
  const hiddenCategories = useCity((s) => s.hiddenCategories);
  const hiddenLanguages = useCity((s) => s.hiddenLanguages);
  const isolate = useCity((s) => s.isolate);
  const toggleCategory = useCity((s) => s.toggleCategory);
  const toggleLanguage = useCity((s) => s.toggleLanguage);
  const soloLanguage = useCity((s) => s.soloLanguage);
  const lens = useCity((s) => s.colorLens);
  const setPreference = useCity((s) => s.setPreference);
  const clearFilters = useCity((s) => s.clearFilters);
  const [allLangs, setAllLangs] = useState(false);

  const counts = useMemo(() => {
    const categories: Partial<Record<Category, number>> = {};
    const languages: Record<string, number> = {};
    let shown = 0;
    for (const b of layout?.buildings ?? []) {
      categories[b.category] = (categories[b.category] ?? 0) + 1;
      languages[b.language] = (languages[b.language] ?? 0) + 1;
      const visible =
        !hiddenCategories.has(b.category) &&
        !hiddenLanguages.has(b.language) &&
        (isolate === null || b.dirPath === isolate || b.dirPath.startsWith(`${isolate}/`) || b.id === isolate || b.id.startsWith(`${isolate}/`));
      if (visible) shown++;
    }
    const langs = Object.entries(languages).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return { categories, langs, shown, total: layout?.buildings.length ?? 0 };
  }, [layout, hiddenCategories, hiddenLanguages, isolate]);

  if (!model || !layout) return null;
  const filtered = hiddenCategories.size > 0 || hiddenLanguages.size > 0 || isolate !== null;
  const langs = allLangs ? counts.langs : counts.langs.slice(0, LANG_LIMIT);
  const setOpen = (v: boolean) => useCity.setState({ filtersOpen: v });

  if (!open) {
    if (mobile) return null;
    return (
      <button
        type="button"
        className="glass pointer-events-auto flex items-center gap-2.5 rounded-lg py-2 pr-3.5 pl-3 text-[0.82rem] transition-transform hover:-translate-y-px"
        onClick={() => setOpen(true)}
        aria-expanded={false}
      >
        <IconLayers size={17} />
        <span className="font-semibold">Legend & filters</span>
        <span className="flex -space-x-1">
          {counts.langs.slice(0, 4).map(([l]) => (
            <span key={l} className="h-3 w-3 rounded-[4px] ring-2 ring-white/80" style={{ background: languageColor(l) }} />
          ))}
        </span>
        {filtered && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10.5px] text-accent tabular-nums">
            {formatNumber(counts.shown)}/{formatNumber(counts.total)}
          </span>
        )}
      </button>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className={`glass-strong pointer-events-auto flex flex-col overflow-hidden rounded-xl ${
          mobile ? "max-h-[52vh] w-full" : "max-h-[min(560px,calc(100vh-8rem))] w-[340px]"
        }`}
        role="dialog"
        aria-label="Legend and filters"
      >
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
          <IconLayers size={17} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.88rem] font-semibold">Legend & filters</p>
            <p className="text-[0.72rem] text-ink-faint tabular-nums">
              {filtered ? `Showing ${formatNumber(counts.shown)} of ${formatNumber(counts.total)} buildings` : `All ${formatNumber(counts.total)} buildings`}
            </p>
          </div>
          {filtered && (
            <button type="button" className="btn btn-quiet px-2.5 py-1 text-[0.72rem]" onClick={clearFilters}>
              Reset
            </button>
          )}
          <button type="button" className="icon-btn h-8 w-8" onClick={() => setOpen(false)} aria-label="Close legend">
            <IconClose size={16} />
          </button>
        </div>

        <div className="scroll-soft overflow-y-auto px-4 py-3">
          <p className="eyebrow mb-2">Colour facades by</p>
          <div className="seg-group mb-4 w-full" role="radiogroup" aria-label="Colour facades by">
            {LENSES.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={lens === l.id}
                className="seg flex-1 justify-center"
                title={l.hint}
                onClick={() => setPreference({ colorLens: l.id })}
              >
                {l.label}
              </button>
            ))}
          </div>

          {isolate !== null && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-sky-400/10 px-3 py-2 text-[0.78rem] text-sky-300">
              <IconIsolate size={16} />
              <span className="min-w-0 flex-1 truncate">
                Only <b className="font-mono">{isolate}/</b>
              </span>
              <button type="button" className="icon-btn h-7 w-7 text-sky-300" aria-label="Show every folder" onClick={() => useCity.getState().setIsolate(null)}>
                <IconClose size={14} />
              </button>
            </div>
          )}

          <p className="eyebrow mb-2">Shape · what a file does</p>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {CATEGORIES.filter((c) => counts.categories[c]).map((c) => {
              const meta = CATEGORY_META[c];
              const on = !hiddenCategories.has(c);
              return (
                <button key={c} type="button" className="chip" aria-pressed={on} onClick={() => toggleCategory(c)} title={on ? `Hide ${meta.plural.toLowerCase()}` : `Show ${meta.plural.toLowerCase()}`}>
                  <span className="chip-swatch" style={{ color: lens === "role" ? CATEGORY_COLORS[c] : "var(--ink-soft)" }}>
                    <ArchetypeGlyph archetype={meta.archetype} size={15} />
                  </span>
                  {meta.label}
                  <span className="text-ink-faint tabular-nums">{formatNumber(counts.categories[c] ?? 0)}</span>
                </button>
              );
            })}
          </div>

          <p className="eyebrow mb-1">Language</p>
          <p className="mb-2 text-[11.5px] text-ink-faint">
            {lens === "language" ? "Facades are painted by language." : "Shown on each building's lit band."} Shift-click to solo.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {langs.map(([l, n]) => {
              const on = !hiddenLanguages.has(l);
              return (
                <button
                  key={l}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  onClick={(e) => (e.shiftKey ? soloLanguage(l) : toggleLanguage(l))}
                >
                  <span className="chip-swatch h-3 w-3 rounded-[4px] ring-1 ring-white/15" style={{ background: languageColor(l) }} />
                  {languageName(l)}
                  <span className="text-ink-faint tabular-nums">{formatNumber(n)}</span>
                </button>
              );
            })}
            {counts.langs.length > LANG_LIMIT && (
              <button type="button" className="chip text-ink-soft" onClick={() => setAllLangs(!allLangs)}>
                {allLangs ? "Fewer" : `+${counts.langs.length - LANG_LIMIT} more`}
              </button>
            )}
          </div>
          <p className="mt-4 text-[0.72rem] leading-relaxed text-ink-faint">
            Height shows file size on a log scale, comparable between buildings of the same shape. Folders become districts and blocks.
            Select a district, then use Isolate to hide everything else.
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
