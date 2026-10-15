"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DirNode, FileNode } from "@/lib/analysis/types";
import { targetForPath } from "@/state/deepLinks";
import { useCity } from "@/state/store";
import { languageColor } from "@/theme/palette";
import { IconChevron, IconFolder } from "./icons";

interface Row {
  path: string;
  name: string;
  depth: number;
  dir: DirNode | null;
  file: FileNode | null;
}

const MAX_ROWS = 800;

/**
 * Every folder and file as a keyboard-navigable tree: the accessible way to
 * reach anything in the city without pointing at buildings.
 * ↑/↓ move · → expand · ← collapse or go to parent · Enter selects · Home/End.
 */
export function FileTree() {
  const model = useCity((s) => s.model);
  const selected = useCity((s) => s.selected);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [focusIndex, setFocusIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    if (!model) return out;
    const walk = (dir: DirNode, depth: number) => {
      for (const d of dir.dirs) {
        if (out.length >= MAX_ROWS) return;
        out.push({ path: d.path, name: d.name, depth, dir: d, file: null });
        if (expanded.has(d.path)) walk(d, depth + 1);
      }
      for (const f of dir.files) {
        if (out.length >= MAX_ROWS) return;
        out.push({ path: f.path, name: f.name, depth, dir: null, file: f });
      }
    };
    walk(model.root, 1);
    return out;
  }, [model, expanded]);

  if (!model) return null;
  const selectedPath = selected?.id;

  const focusRow = (i: number) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, i));
    setFocusIndex(clamped);
    listRef.current?.querySelector<HTMLElement>(`[data-row="${clamped}"]`)?.focus();
  };
  const toggle = (path: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const shouldOpen = open ?? !next.has(path);
      if (shouldOpen) next.add(path);
      else next.delete(path);
      return next;
    });
  const choose = (row: Row) => {
    const target = targetForPath(row.path);
    if (target) useCity.getState().select(target);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    const row = rows[i];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(i - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (row.dir && !expanded.has(row.path)) toggle(row.path, true);
        else if (row.dir) focusRow(i + 1);
        break;
      case "ArrowLeft": {
        e.preventDefault();
        if (row.dir && expanded.has(row.path)) toggle(row.path, false);
        else {
          const parent = row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : null;
          const pi = parent === null ? -1 : rows.findIndex((r) => r.path === parent);
          if (pi >= 0) focusRow(pi);
        }
        break;
      }
      case "Home":
        e.preventDefault();
        focusRow(0);
        break;
      case "End":
        e.preventDefault();
        focusRow(rows.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(row);
        if (row.dir && e.key === " ") toggle(row.path);
        break;
    }
    // Keep global shortcuts (/, G, T…) from firing while navigating the tree.
    e.stopPropagation();
  };

  return (
    <div className="px-3 py-3">
      <p className="mb-2 px-2 text-[0.7rem] text-ink-faint">
        <span className="kbd">↑</span> <span className="kbd">↓</span> move · <span className="kbd">→</span> open · <span className="kbd">←</span> close ·{" "}
        <span className="kbd">↵</span> show in the city
      </p>
      <ul ref={listRef} role="tree" aria-label="Files and folders" className="space-y-px">
        {rows.map((row, i) => {
          const isOpen = row.dir ? expanded.has(row.path) : undefined;
          const isSelected = selectedPath === row.path;
          return (
            <li
              key={row.path}
              role="treeitem"
              aria-level={row.depth}
              aria-expanded={isOpen}
              aria-selected={isSelected}
              tabIndex={i === focusIndex ? 0 : -1}
              data-row={i}
              onKeyDown={(e) => onKeyDown(e, i)}
              onFocus={() => setFocusIndex(i)}
              onClick={() => {
                setFocusIndex(i);
                if (row.dir) toggle(row.path);
                choose(row);
              }}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-[0.8rem] outline-none hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-accent/70 ${isSelected ? "bg-accent-soft text-ink" : "text-ink-soft"}`}
              style={{ paddingLeft: `${(row.depth - 1) * 14 + 6}px` }}
            >
              {row.dir ? (
                <>
                  <IconChevron size={12} className={`shrink-0 text-ink-faint transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  <IconFolder size={14} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{row.name}</span>
                  <span className="shrink-0 font-mono text-[0.66rem] text-ink-faint">{row.dir.stats.files}</span>
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: languageColor(row.file!.language) }} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.76rem]">{row.name}</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length >= MAX_ROWS && <p className="mt-2 px-2 text-[0.7rem] text-ink-faint">Showing the first {MAX_ROWS} rows; collapse folders or use search (/).</p>}
    </div>
  );
}
