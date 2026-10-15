/**
 * Deep links: `?select=<path>&symbol=<id>&journey=<id>` on any city URL.
 *
 * On load, the requested selection is applied once the city has assembled
 * (and the journey once the analysis is ready). After that, the URL follows
 * the selection with replaceState, so the address bar is always shareable.
 */
"use client";

import { useEffect } from "react";
import { buildingIdForFile } from "@/lib/layout/cityLayout";
import { useCity, type Target } from "./store";

interface Link {
  select?: string;
  symbol?: string;
  journey?: string;
}

export function readLink(search: string): Link {
  const params = new URLSearchParams(search);
  const link: Link = {};
  for (const key of ["select", "symbol", "journey"] as const) {
    const v = params.get(key);
    if (v) link[key] = v;
  }
  return link;
}

export function linkSearch(link: Link): string {
  const params = new URLSearchParams();
  if (link.select) params.set("select", link.select);
  if (link.symbol) params.set("symbol", link.symbol);
  if (link.journey) params.set("journey", link.journey);
  const q = params.toString();
  return q ? `?${q}` : "";
}

/** The building or district a repository path is drawn as. */
export function targetForPath(path: string): Target | null {
  const { model, layout } = useCity.getState();
  if (!model || !layout) return null;
  const file = model.filesByPath.get(path);
  if (file) {
    const id = buildingIdForFile(layout, file);
    return id ? { kind: "building", id } : null;
  }
  if (layout.buildingIndex.has(path)) return { kind: "building", id: path };
  if (model.dirsByPath.has(path)) return { kind: "district", id: path };
  return null;
}

export function useDeepLinks() {
  useEffect(() => {
    let pending: Link | null = null;
    let lastCity = -1;

    const apply = () => {
      const s = useCity.getState();
      if (s.phase !== "city") return;
      if (s.cityKey !== lastCity) {
        lastCity = s.cityKey;
        const link = readLink(window.location.search);
        pending = link.select || link.journey ? link : null;
      }
      if (!pending || !s.assembled) return;

      if (pending.select) {
        const target = targetForPath(pending.select);
        if (target) s.select(target, { symbol: pending.symbol ?? null });
        pending = { ...pending, select: undefined };
      }
      if (pending.journey) {
        const done = s.trace.status === "done" || s.trace.status === "error" || s.trace.status === "unsupported";
        const journey = s.analysis?.journeys.find((j) => j.id === pending!.journey);
        if (journey) s.playJourney(journey);
        if (journey || done) pending = { ...pending, journey: undefined };
      }
      if (!pending.select && !pending.journey) pending = null;
    };

    const write = () => {
      const s = useCity.getState();
      if (s.phase !== "city" || pending) return;
      const select = s.selected?.id && s.selected.id !== "#overflow" ? s.selected.id : undefined;
      const search = linkSearch({ select, symbol: s.symbol ?? undefined, journey: s.journey?.journey.kind !== "symbol" ? s.journey?.journey.id : undefined });
      if (search !== window.location.search) window.history.replaceState(window.history.state, "", `${window.location.pathname}${search}`);
    };

    apply();
    return useCity.subscribe((state, prev) => {
      if (
        state.phase !== prev.phase ||
        state.cityKey !== prev.cityKey ||
        state.assembled !== prev.assembled ||
        state.analysis !== prev.analysis ||
        state.trace !== prev.trace
      ) {
        apply();
      }
      if (state.selected !== prev.selected || state.symbol !== prev.symbol || state.journey !== prev.journey) write();
    });
  }, []);
}
