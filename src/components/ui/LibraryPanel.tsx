"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { analysisHint, LIBRARY, LIBRARY_MEASURED_ON, LIBRARY_SIZE, searchLibrary, type AnalysisDepth, type LibraryRepo } from "@/lib/repoLibrary";
import { TRACE_FILE_CAP } from "@/lib/analysis/imports/trace";
import { formatCompact } from "@/lib/format";
import { languageColor } from "@/theme/palette";
import { loadRepo } from "@/state/loader";
import { useCity } from "@/state/store";
import { languageName, useIsMobile, useMediaQuery } from "./common";
import { IconAlert, IconClose, IconSearch } from "./icons";
import { RepoAvatar } from "./RepoAvatar";
import { useFocusTrap } from "./useFocusTrap";

const MEASURED = new Date(`${LIBRARY_MEASURED_ON}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const DEPTH_STYLE: Record<AnalysisDepth, string> = {
  full: "text-ink-soft ring-1 ring-white/20",
  partial: "text-ink-faint ring-1 ring-white/10",
  map: "text-ink-faint border border-dashed border-white/20",
};

function DepthBadge({ depth, label }: { depth: AnalysisDepth; label: string }) {
  return <span className={`rounded-[4px] px-1.5 py-px font-mono text-[9.5px] tracking-[0.06em] uppercase ${DEPTH_STYLE[depth]}`}>{label}</span>;
}

/**
 * The repository library: a browsable list of famous public repositories,
 * grouped by category, with search. A modal dialog that slides in from the
 * right on desktop and up from the bottom on phones.
 */
export function LibraryPanel() {
  const open = useCity((s) => s.panel === "library");
  return <AnimatePresence>{open && <LibraryDialog key="library" />}</AnimatePresence>;
}

/** Mounted only while open, so search and filter start fresh each time. */
function LibraryDialog() {
  const mobile = useIsMobile();
  const touch = useMediaQuery("(pointer: coarse)");
  const dialog = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  useFocusTrap(dialog, true);

  // Start in the search field, except on touch screens where the keyboard would cover the
  // list: there the dialog itself takes focus. Runs again when the breakpoint remounts it.
  useEffect(() => {
    if (touch) dialog.current?.focus({ preventScroll: true });
    else search.current?.focus({ preventScroll: true });
  }, [touch, mobile]);

  const close = () => useCity.setState({ panel: null });

  const shown = useMemo(() => {
    const found = searchLibrary(query, languageName);
    return category ? found.filter((c) => c.id === category) : found;
  }, [query, category]);
  const count = shown.reduce((n, c) => n + c.repos.length, 0);
  const categoryTitle = LIBRARY.find((c) => c.id === category)?.title;

  const pick = (r: LibraryRepo) => {
    useCity.setState({ panel: null });
    void loadRepo({ owner: r.owner, repo: r.repo });
  };

  // Up and down arrows move between entries, and up from the first returns to search.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[data-library-item]") ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at === -1 && document.activeElement !== search.current) return;
    e.preventDefault();
    const next = e.key === "ArrowDown" ? Math.min(at + 1, items.length - 1) : at - 1;
    if (next < 0) search.current?.focus();
    else items[next].focus();
  };

  return (
    <motion.div
      // No backdrop-filter here: it would stop the panel's own glass blur from seeing the page behind.
      className="pointer-events-auto fixed inset-0 z-40 bg-black/45"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.section
        // Remount when the breakpoint resolves after the first render, so the phone
        // slide never inherits a half-finished desktop fade.
        key={mobile ? "m" : "d"}
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={
          mobile
            ? "glass-strong absolute inset-x-2 outline-none top-[max(0.5rem,env(safe-area-inset-top))] bottom-[max(0.5rem,env(safe-area-inset-bottom))] flex flex-col overflow-hidden rounded-xl"
            : "glass-strong absolute top-3 outline-none right-3 bottom-3 flex w-[min(460px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl"
        }
        initial={mobile ? { y: "100%", opacity: 1 } : { x: 48, opacity: 0 }}
        animate={mobile ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }}
        exit={mobile ? { y: "100%", opacity: 1 } : { x: 48, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 32 }}
      >
        <div className="px-4 pt-4 pb-3 sm:px-5 sm:pt-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Repository library</p>
              <h2 id="library-title" className="mt-1 text-[19px] leading-tight font-semibold tracking-tight text-ink">
                Explore famous codebases
              </h2>
              <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                {LIBRARY_SIZE} public repositories, from big tech to the infrastructure under it. Pick one to build its city.
              </p>
            </div>
            <button type="button" className="icon-btn -mt-1 -mr-2 h-9 w-9 shrink-0" onClick={close} aria-label="Close library">
              <IconClose size={17} />
            </button>
          </div>

          <div className="mt-3 flex h-10 items-center gap-2.5 rounded-lg border border-white/10 bg-black/30 px-3 focus-within:border-accent/70">
            <IconSearch size={15} className="shrink-0 text-ink-faint" />
            <input
              ref={search}
              id="library-search"
              aria-label="Search the library"
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search by name, company or language"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-controls="library-list"
              aria-describedby="library-count"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                className="icon-btn -mr-1.5 h-7 w-7"
                onClick={() => {
                  setQuery("");
                  search.current?.focus();
                }}
                aria-label="Clear search text"
              >
                <IconClose size={14} />
              </button>
            )}
          </div>

          <div className="-mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:-mx-5 sm:px-5" role="group" aria-label="Filter by category">
            <button type="button" className="chip shrink-0" aria-pressed={category === null} onClick={() => setCategory(null)}>
              All
            </button>
            {LIBRARY.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip shrink-0"
                aria-pressed={category === c.id}
                onClick={() => setCategory(category === c.id ? null : c.id)}
              >
                {c.title}
              </button>
            ))}
          </div>
          <p id="library-count" className="sr-only" aria-live="polite">
            {count === 1 ? "1 repository" : `${count} repositories`}
          </p>
        </div>

        <div ref={list} id="library-list" className="scroll-soft min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-white/[0.07] pb-3">
          {shown.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-[13px] text-ink-soft">
                No repository {categoryTitle ? <>in &ldquo;{categoryTitle}&rdquo; </> : "in the library "}matches &ldquo;{query.trim()}&rdquo;.
              </p>
              <p className="mt-1 text-[12px] text-ink-faint">Any public GitHub repository works: paste its link on the start card.</p>
              <button
                type="button"
                className="btn btn-quiet mt-3 h-8 px-3 text-[12px]"
                onClick={() => {
                  setQuery("");
                  setCategory(null);
                  search.current?.focus();
                }}
              >
                Clear search
              </button>
            </div>
          ) : (
            shown.map((c) => (
              <section key={c.id} aria-labelledby={`library-cat-${c.id}`}>
                <div className="sticky top-0 z-10 border-b border-white/[0.05] bg-[var(--panel-strong)] px-4 pt-3 pb-2 backdrop-blur-md sm:px-5">
                  <h3 id={`library-cat-${c.id}`} className="eyebrow text-ink-soft">
                    {c.title}
                  </h3>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-ink-faint">{c.blurb}</p>
                </div>
                <ul className="px-2 pt-1 sm:px-3">
                  {c.repos.map((r) => (
                    <LibraryItem key={`${r.owner}/${r.repo}`} repo={r} onPick={pick} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="border-t border-white/[0.07] px-4 py-3 text-[11px] leading-snug text-ink-faint sm:px-5">
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <DepthBadge depth="full" label="Full analysis" /> every source file
            </li>
            <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <DepthBadge depth="partial" label="Partial" /> some
            </li>
            <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <DepthBadge depth="map" label="Map only" /> no imports traced
            </li>
          </ul>
          <p className="mt-1.5">
            Counts measured from GitHub on {MEASURED}, without dependencies or build output. The browser parses up to {TRACE_FILE_CAP} source
            files; for more, clone the repository and run{" "}
            <code className="font-mono whitespace-nowrap text-ink-soft">codescape view --root .</code>
          </p>
        </div>
      </motion.section>
    </motion.div>
  );
}

function LibraryItem({ repo: r, onPick }: { repo: LibraryRepo; onPick: (r: LibraryRepo) => void }) {
  const hint = analysisHint(r, languageName);
  const slug = `${r.owner}/${r.repo}`;
  const descId = `library-desc-${slug.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  return (
    <li>
      <button
        type="button"
        data-library-item
        className="row-btn py-2.5"
        onClick={() => onPick(r)}
        aria-label={`${r.title}, ${slug}`}
        aria-describedby={descId}
      >
        <span className="flex w-full min-w-0 items-start gap-3">
          <span className="mt-0.5">
            <RepoAvatar owner={r.owner} size={30} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13.5px] font-semibold text-ink">{r.title}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-ink-faint">{slug}</span>
            </span>
            <span id={descId} className="mt-0.5 block text-[12.5px] leading-snug text-ink-soft">
              {r.hook}
              <span className="sr-only">
                {" "}
                {languageName(r.language)}, {formatCompact(r.files)} files. {hint.label}: {hint.detail}
              </span>
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-faint" aria-hidden>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[3px]" style={{ background: languageColor(r.language) }} />
                {languageName(r.language)}
              </span>
              <span className="font-mono">
                {r.truncated ? "≥ " : ""}
                {formatCompact(r.files)} files
              </span>
              <span title={hint.detail}>
                <DepthBadge depth={hint.depth} label={hint.label} />
              </span>
              {r.truncated && (
                <span className="inline-flex items-center gap-1" title="GitHub truncates this file listing, so the city is incomplete.">
                  <IconAlert size={11} /> listing truncated
                </span>
              )}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}
