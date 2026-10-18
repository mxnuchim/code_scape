/**
 * The "Start here" tour over the city's wayfinding (see src/lib/wayfinding.ts):
 * which numbered stop is in focus, and moving between stops.
 */
import { useMemo } from "react";
import type { WorkspaceAnalysis } from "@/lib/analysis/workspace";
import type { LayoutResult } from "@/lib/layout/cityLayout";
import type { RepoModel } from "@/lib/analysis/types";
import { buildWayfinding, type Wayfinding } from "@/lib/wayfinding";
import { useCity } from "./store";

const cache = new WeakMap<LayoutResult, { analysis: WorkspaceAnalysis | null; value: Wayfinding }>();

/** Wayfinding for the current city, rebuilt when the analysis arrives. Cached per layout. */
export function currentWayfinding(model: RepoModel | null, layout: LayoutResult | null, analysis: WorkspaceAnalysis | null): Wayfinding | null {
  if (!model || !layout) return null;
  const hit = cache.get(layout);
  if (hit && hit.analysis === analysis) return hit.value;
  const value = buildWayfinding(model, layout, analysis);
  cache.set(layout, { analysis, value });
  return value;
}

export function useWayfinding(): Wayfinding | null {
  const model = useCity((s) => s.model);
  const layout = useCity((s) => s.layout);
  const analysis = useCity((s) => s.analysis);
  return useMemo(() => currentWayfinding(model, layout, analysis), [model, layout, analysis]);
}

function wayfindingNow(): Wayfinding | null {
  const s = useCity.getState();
  return currentWayfinding(s.model, s.layout, s.analysis);
}

/** Open the tour at a stop: select its building (the camera flies there) and show why it matters. */
export function startTour(step = 0) {
  const w = wayfindingNow();
  const s = useCity.getState();
  if (!w || w.waypoints.length === 0) return;
  const clamped = Math.max(0, Math.min(step, w.waypoints.length - 1));
  const stop = w.waypoints[clamped];
  if (s.journey) s.playJourney(null);
  s.set({ tour: { step: clamped }, arrivalOpen: false });
  s.select({ kind: "building", id: stop.buildingId }, { symbol: stop.symbol ?? null });
}

export function stepTour(delta: number) {
  const tour = useCity.getState().tour;
  if (!tour) return;
  startTour(tour.step + delta);
}

export function endTour() {
  useCity.getState().set({ tour: null });
}
