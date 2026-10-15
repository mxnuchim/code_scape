"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildingIdForFile } from "@/lib/layout/cityLayout";
import { search, type SearchHit, type SearchItem } from "@/lib/search";
import { formatNumber } from "@/lib/format";
import { useCity } from "@/state/store";
import { languageColor } from "@/theme/palette";
import { IconFolder, IconSearch } from "./icons";

export function SearchPalette() {
  const open = useCity((s) => s.searchOpen);
  const model = useCity((s) => s.model);
  return <AnimatePresence>{open && model && <Palette key="palette" />}</AnimatePresence>;
}

/** Mounted fresh on every open, so the query always starts empty. */
function Palette() {
  const model = useCity((s) => s.model)!;
  const layout = useCity((s) => s.layout);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo<SearchItem[]>(() => {
    const out: SearchItem[] = [];
    for (const d of model.dirsByPath.values()) if (d.path) out.push({ kind: "dir", path: d.path, name: d.name });
    for (const f of model.files) out.push({ kind: "file", path: f.path, name: f.name });
    return out;
  }, [model]);

  const hits = useMemo(() => search(items, query), [items, query]);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => useCity.setState({ searchOpen: false });

  const choose = (hit: SearchHit) => {
    if (!layout) return;
    const { select } = useCity.getState();
    close();
    if (hit.kind === "file") {
      const file = model.filesByPath.get(hit.path);
      const id = file ? buildingIdForFile(layout, file) : undefined;
      if (id) select({ kind: "building", id });
      return;
    }
    const dir = model.dirsByPath.get(hit.path);
    if (!dir) return;
    // A folder inside an aggregated block is part of that block's building.
    const anyFile = model.files.find((f) => f.path.startsWith(`${dir.path}/`));
    if (anyFile?.aggregatedInto !== undefined && !layout.plateIndex.has(dir.path)) {
      select({ kind: "building", id: anyFile.aggregatedInto });
    } else {
      select({ kind: "district", id: dir.path });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[active]) choose(hits[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
        <motion.div
          className="pointer-events-auto fixed inset-0 z-40 flex items-start justify-center bg-black/45 px-3 pt-[10vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <motion.div
            role="dialog"
            aria-label="Search the city"
            className="glass-strong w-full max-w-[580px] overflow-hidden rounded-xl"
            initial={{ y: -14, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -10, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3.5">
              <IconSearch size={19} className="text-ink-soft" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={`Search ${formatNumber(model.stats.files)} files and folders`}
                className="min-w-0 flex-1 bg-transparent text-[1rem] outline-none placeholder:text-ink-faint"
                role="combobox"
                aria-expanded={hits.length > 0}
                aria-controls="search-results"
                aria-activedescendant={hits[active] ? `hit-${active}` : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="kbd">esc</span>
            </div>
            {query.trim() && (
              <ul ref={listRef} id="search-results" role="listbox" className="scroll-soft max-h-[52vh] overflow-y-auto p-1.5">
                {hits.length === 0 && <li className="px-3 py-6 text-center text-[0.86rem] text-ink-faint">Nothing in this city matches “{query}”.</li>}
                {hits.map((hit, i) => {
                  const file = hit.kind === "file" ? model.filesByPath.get(hit.path) : undefined;
                  const dir = hit.kind === "dir" ? model.dirsByPath.get(hit.path) : undefined;
                  const parent = hit.path.includes("/") ? hit.path.slice(0, hit.path.lastIndexOf("/")) : "";
                  return (
                    <li key={`${hit.kind}:${hit.path}`} id={`hit-${i}`} role="option" aria-selected={i === active} data-index={i}>
                      <button
                        type="button"
                        className="row-btn"
                        data-active={i === active}
                        onMouseMove={() => setActive(i)}
                        onClick={() => choose(hit)}
                      >
                        {file ? (
                          <span className="h-3 w-3 shrink-0 rounded-[4px] ring-1 ring-white/15" style={{ background: languageColor(file.language) }} />
                        ) : (
                          <IconFolder size={16} className="shrink-0 text-ink-faint" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.88rem] font-semibold">
                            {hit.name}
                            {dir ? "/" : ""}
                          </span>
                          <span className="block truncate font-mono text-[0.7rem] text-ink-faint">{parent || "/"}</span>
                        </span>
                        <span className="shrink-0 text-[0.7rem] text-ink-faint">
                          {dir ? `${formatNumber(dir.stats.files)} files` : file?.aggregatedInto !== undefined ? "in a block" : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex items-center gap-3 border-t border-white/[0.07] px-4 py-2 text-[0.7rem] text-ink-faint">
              <span>
                <span className="kbd">↑</span> <span className="kbd">↓</span> to move
              </span>
              <span>
                <span className="kbd">↵</span> to fly there
              </span>
            </div>
          </motion.div>
        </motion.div>
  );
}
