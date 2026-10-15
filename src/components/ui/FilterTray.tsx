"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { CATEGORIES, type Category } from "@/lib/analysis/types";
import { formatNumber } from "@/lib/format";
import { useCity } from "@/state/store";
import { CATEGORY_META, languageColor } from "@/theme/palette";
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
        className="glass pointer-events-auto flex items-center gap-2.5 rounded-full py-2 pr-4 pl-3 text-[0.82rem] transition-transform hover:-translate-y-px"
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
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.7rem] font-bold text-accent-deep tabular-nums">
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
        className={`glass-strong pointer-events-auto flex flex-col overflow-hidden rounded-[22px] ${
          mobile ? "max-h-[52vh] w-full" : "max-h-[min(560px,calc(100vh-8rem))] w-[340px]"
        }`}
        role="dialog"
        aria-label="Legend and filters"
      >
        <div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-3">
          <IconLayers size={17} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.88rem] font-bold">Legend & filters</p>
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
          {isolate !== null && (
            <div className="mb-3 flex items-center gap-2 rounded-2xl bg-[#e3f1ff] px-3 py-2 text-[0.78rem] text-[#1f5d99]">
              <IconIsolate size={16} />
              <span className="min-w-0 flex-1 truncate">
                Only <b className="font-mono">{isolate}/</b>
              </span>
              <button type="button" className="icon-btn h-7 w-7 text-[#1f5d99]" aria-label="Show every folder" onClick={() => useCity.getState().setIsolate(null)}>
                <IconClose size={14} />
              </button>
            </div>
          )}

          <p className="mb-2 text-[0.68rem] font-bold tracking-[0.08em] text-ink-faint uppercase">Shape: what a file does</p>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {CATEGORIES.filter((c) => counts.categories[c]).map((c) => {
              const meta = CATEGORY_META[c];
              const on = !hiddenCategories.has(c);
              return (
                <button key={c} type="button" className="chip" aria-pressed={on} onClick={() => toggleCategory(c)} title={on ? `Hide ${meta.plural.toLowerCase()}` : `Show ${meta.plural.toLowerCase()}`}>
                  <span className="chip-swatch text-ink-soft">
                    <ArchetypeGlyph archetype={meta.archetype} size={16} />
                  </span>
                  {meta.label}
                  <span className="text-ink-faint tabular-nums">{formatNumber(counts.categories[c] ?? 0)}</span>
                </button>
              );
            })}
          </div>

          <p className="mb-2 text-[0.68rem] font-bold tracking-[0.08em] text-ink-faint uppercase">
            Colour: language <span className="font-medium tracking-normal normal-case">· shift-click to solo</span>
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
                  <span className="chip-swatch h-3 w-3 rounded-[4px] ring-1 ring-black/10" style={{ background: languageColor(l) }} />
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
            Height follows file size. Folders become districts and blocks. Click a district to isolate it.
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
