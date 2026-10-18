"use client";

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import type { LayoutResult } from "@/lib/layout/cityLayout";
import { useCity } from "@/state/store";
import { startTour, useWayfinding } from "@/state/wayfinding";

/** Closer than this share of the island's size, pins shrink to their numbers and district signs step aside. */
const COMPACT_RATIO = 0.62;
const BASE_STEM = 30;
const COMPACT_STEM = 14;
const MAX_STEM = 260;
/** How many label heights a pin may climb before it folds down to just its number. */
const MAX_LEVELS_FULL = 3;
/** Re-run the label layout every few frames; it only reads a handful of DOM boxes. */
const LAYOUT_EVERY = 3;

interface Tracked {
  el: HTMLElement;
  /** Width of the full label, measured while it was unfolded. */
  fullWidth?: number;
  anchor: THREE.Vector3;
  kind: "pin" | "trail" | "district";
  /** Lower goes first, and keeps the shortest stem. */
  priority: number;
}

/**
 * Wayfinding in the world: numbered "Start here" pins on stems above the
 * buildings worth reading first, street signs at districts saying what they
 * seem to be for, and trailheads where a code journey starts. At most a
 * handful of each, so the city never turns into a tag cloud. Pins that would
 * overlap on screen get taller stems, so labels stack like callouts instead of
 * covering each other; a district sign that would cover another waits for
 * the camera to come closer. Hidden while a journey plays, since the journey draws
 * its own numbered stops.
 */
export function WayfindingLayer({ layout }: { layout: LayoutResult }) {
  const wayfinding = useWayfinding();
  const tour = useCity((s) => s.tour);
  const journey = useCity((s) => s.journey);
  const assembled = useCity((s) => s.assembled);
  const selected = useCity((s) => s.selected);
  const compact = useCompact(layout);
  const tracked = useDeclutter(compact);

  const top = (id: string) => {
    const i = layout.buildingIndex.get(id);
    if (i === undefined) return null;
    const b = layout.buildings[i];
    return [b.x, b.y + b.height + 0.25, b.z] as [number, number, number];
  };

  if (!wayfinding || !assembled || journey) return null;

  return (
    <group>
      {!compact &&
        wayfinding.districts.map((d, i) => (
          <Html key={`d:${d.path}`} position={[d.x, d.y, d.z]} zIndexRange={[13, 10]}>
            <button
              ref={tracked(`d:${d.path}`, [d.x, d.y, d.z], "district", -100 + i)}
              type="button"
              className={`wf-district ${d.basis === "heuristic" ? "is-heuristic" : ""} ${selected?.kind === "district" && selected.id === d.path ? "is-selected" : ""}`}
              style={{ ["--i" as string]: i }}
              onClick={() => useCity.getState().select({ kind: "district", id: d.path })}
              title={d.basis === "heuristic" ? `${d.path}/: ${d.role} (guessed from the folder name)` : `${d.path}/: ${d.role}`}
            >
              <span className="wf-district-name">{d.name}/</span>
              <span className="wf-district-role">{d.role}</span>
            </button>
          </Html>
        ))}

      {wayfinding.waypoints.map((w, i) => {
        const at = top(w.buildingId);
        if (!at) return null;
        const current = tour?.step === i;
        return (
          <Html key={`w:${w.buildingId}`} position={at} zIndexRange={[16, 12]}>
            <button
              ref={tracked(`w:${w.buildingId}`, at, "pin", current ? -1 : i)}
              type="button"
              className={`wf-pin ${current ? "is-current" : ""} ${compact && !current ? "is-compact" : ""} ${w.basis === "heuristic" ? "is-heuristic" : ""}`}
              style={{ ["--i" as string]: i }}
              onClick={() => startTour(i)}
              title={`${w.order}. ${w.path}: ${w.reason}`}
              aria-label={`Start here, stop ${w.order}: ${w.path}`}
            >
              <span className="wf-stem" aria-hidden />
              <span className="wf-tag wf-pin-tag">
                <span className="wf-pin-num">{w.order}</span>
                {(!compact || current) && <span className="wf-pin-title">{w.title}</span>}
              </span>
            </button>
          </Html>
        );
      })}

      {wayfinding.trailheads.map((t, i) => {
        const at = top(t.buildingId);
        if (!at) return null;
        return (
          <Html key={`t:${t.journeyId}`} position={at} zIndexRange={[15, 11]}>
            <button
              ref={tracked(`t:${t.journeyId}`, at, "trail", 50 + i)}
              type="button"
              className={`wf-trail ${compact ? "is-compact" : ""}`}
              style={{ ["--i" as string]: i + wayfinding.waypoints.length }}
              onClick={() => {
                const j = useCity.getState().analysis?.journeys.find((x) => x.id === t.journeyId);
                if (j) useCity.getState().playJourney(j);
              }}
              title={`Follow ${t.title} through the code`}
              aria-label={`Follow ${t.title} through the code`}
            >
              <span className="wf-stem" aria-hidden />
              <span className="wf-tag wf-trail-pill">
                <span aria-hidden>▸</span>
                {!compact && <span className="wf-trail-title">{t.title}</span>}
                {!compact && t.more > 0 && <span className="wf-trail-more">+{t.more}</span>}
              </span>
            </button>
          </Html>
        );
      })}
    </group>
  );
}

/**
 * Screen-space decluttering. In priority order, each pin's label box is placed
 * above its roof; if it would overlap a label already placed, its stem grows
 * until it clears. District signs stay put and act as obstacles. Writes a CSS
 * variable directly, so React doesn't re-render per frame.
 */
function useDeclutter(compact: boolean) {
  const items = useRef(new Map<string, Tracked>());
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const frame = useRef(0);
  const v = useRef(new THREE.Vector3());

  useFrame(() => {
    if (++frame.current % LAYOUT_EVERY !== 0 || items.current.size === 0) return;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const overlaps = (r: { x0: number; x1: number; y0: number; y1: number }) =>
      placed.some((p) => r.x0 < p.x1 + 4 && r.x1 > p.x0 - 4 && r.y0 < p.y1 + 3 && r.y1 > p.y0 - 3);
    const ordered = [...items.current.values()].sort((a, b) => a.priority - b.priority);
    for (const item of ordered) {
      const p = v.current.copy(item.anchor).project(camera);
      if (p.z > 1) continue; // behind the camera
      const x = ((p.x + 1) / 2) * size.width;
      const y = ((1 - p.y) / 2) * size.height;
      if (item.kind === "district") {
        // Signs don't move; one that would cover a bigger district's sign waits until the camera gets closer.
        const w = item.el.offsetWidth;
        const h = item.el.offsetHeight;
        const rect = { x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h }; // centred under its anchor (see .wf-district)
        const clear = !overlaps(rect);
        item.el.classList.toggle("is-crowded", !clear);
        if (clear) placed.push(rect);
        continue;
      }
      const tag = item.el.querySelector<HTMLElement>(".wf-tag");
      if (!tag) continue;
      const folded = item.el.dataset.folded === "1";
      if (!folded) item.fullWidth = tag.offsetWidth;
      const h = tag.offsetHeight;
      const base = compact ? COMPACT_STEM : BASE_STEM;
      // Try the full label a few levels up; in a tight cluster, fold to the number (the name shows on hover).
      const fit = (w: number, levels: number) => {
        let stem = base;
        for (let level = 0; level < levels && stem < MAX_STEM; level++, stem += h + 6) {
          const rect = { x0: x - w / 2, x1: x + w / 2, y0: y - stem - h, y1: y - stem };
          if (!overlaps(rect)) return { stem, rect };
        }
        return null;
      };
      const numberWidth = (tag.querySelector<HTMLElement>(".wf-pin-num")?.offsetWidth ?? 18) + 8;
      const full = fit(item.fullWidth ?? tag.offsetWidth, MAX_LEVELS_FULL);
      const placedAt = full ?? fit(numberWidth, 12) ?? { stem: base, rect: { x0: x - numberWidth / 2, x1: x + numberWidth / 2, y0: y - base - h, y1: y - base } };
      item.el.dataset.folded = full ? "0" : "1";
      placed.push(placedAt.rect);
      item.el.style.setProperty("--stem", `${placedAt.stem}px`);
    }
  });

  // A ref callback per element: registers it with its world anchor, and forgets it on unmount.
  return useCallback(
    (key: string, at: [number, number, number], kind: Tracked["kind"], priority: number) => (el: HTMLElement | null) => {
      if (el) items.current.set(key, { el, anchor: new THREE.Vector3(...at), kind, priority });
      else items.current.delete(key);
    },
    [],
  );
}

/** True when the camera is close enough that full labels would crowd the view. Updates only when it flips. */
function useCompact(layout: LayoutResult): boolean {
  const camera = useThree((s) => s.camera);
  const [compact, setCompact] = useState(false);
  const last = useRef(compact);
  const size = Math.max(layout.island.width, layout.island.depth);
  const phone = typeof window !== "undefined" && window.innerWidth < 640;
  const cx = (layout.island.minX + layout.island.maxX) / 2;
  const cz = (layout.island.minZ + layout.island.maxZ) / 2;
  useFrame(() => {
    const d = Math.hypot(camera.position.x - cx, camera.position.y, camera.position.z - cz);
    const next = phone || d < size * COMPACT_RATIO;
    if (next !== last.current) {
      last.current = next;
      setCompact(next);
    }
  });
  return compact;
}
