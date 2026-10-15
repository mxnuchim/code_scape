import { SHAPES, type Archetype } from "./archetypes";
import type { LayoutResult } from "./cityLayout";

/**
 * How a city style interprets building heights. The layout's heights are the
 * truthful, log-scaled code volume; a style may only stretch them
 * monotonically, so a bigger file never becomes a shorter building of the
 * same kind, and footprints and positions never move.
 */
export interface HeightProfile {
  /** Office towers and aggregated blocks: base + (h - base)^exponent * scale. */
  towers: { scale: number; exponent: number; max: number };
  /** Multiplier for low-rise kinds (docs, tests, config, data…). */
  lowRise: number;
  /** Multiplier for landmarks (town hall, clock tower, beacon, monument). */
  landmark: number;
}

const TALL: ReadonlySet<Archetype> = new Set(["tower", "block"]);
const LANDMARKS: ReadonlySet<Archetype> = new Set(["townhall", "clocktower", "lighthouse", "monument"]);

export function profileHeight(archetype: Archetype, height: number, profile: HeightProfile): number {
  if (TALL.has(archetype)) {
    const base = SHAPES[archetype].base;
    const rise = Math.max(0, height - base);
    return Math.min(profile.towers.max, base + rise ** profile.towers.exponent * profile.towers.scale);
  }
  if (LANDMARKS.has(archetype)) return height * profile.landmark;
  return height * profile.lowRise;
}

const cache = new WeakMap<LayoutResult, WeakMap<HeightProfile, LayoutResult>>();

/** The layout as a style sees it: same ids, positions and footprints; restyled heights. */
export function styleLayout(layout: LayoutResult, profile: HeightProfile): LayoutResult {
  let byProfile = cache.get(layout);
  if (!byProfile) {
    byProfile = new WeakMap();
    cache.set(layout, byProfile);
  }
  const hit = byProfile.get(profile);
  if (hit) return hit;
  const styled: LayoutResult = {
    ...layout,
    buildings: layout.buildings.map((b) => ({ ...b, height: profileHeight(b.archetype, b.height, profile) })),
  };
  byProfile.set(profile, styled);
  return styled;
}
