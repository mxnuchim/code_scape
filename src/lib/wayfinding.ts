/**
 * Wayfinding: what the city shows a newcomer so they know where to go.
 *
 * Everything here is derived from data CodeScape already has: the onboarding
 * reading order, module roles and code journeys once the analysis arrives, and
 * the file tree's landmarks (README, manifests, entry-like names) before it
 * does. Nothing new is inferred, and each item keeps its basis.
 */
import type { Basis } from "./analysis/code/types";
import type { RepoModel } from "./analysis/types";
import type { WorkspaceAnalysis } from "./analysis/workspace";
import { buildingIdForFile, type LayoutResult } from "./layout/cityLayout";

/** A numbered "Start here" stop. */
export interface Waypoint {
  /** 1-based position in the tour. */
  order: number;
  path: string;
  symbol?: string;
  buildingId: string;
  /** Short name for the pin: the file name, or `Folder/` for a block. */
  title: string;
  reason: string;
  basis: Basis;
}

/** A district (folder) labelled with what it seems to be for, anchored at its front edge. */
export interface DistrictSign {
  path: string;
  name: string;
  role: string;
  basis: Basis;
  x: number;
  y: number;
  z: number;
}

/** Where a code journey starts, as a marker the user can click to follow it. */
export interface Trailhead {
  journeyId: string;
  title: string;
  /** More journeys that start in the same building. */
  more: number;
  buildingId: string;
}

export interface Wayfinding {
  waypoints: Waypoint[];
  districts: DistrictSign[];
  trailheads: Trailhead[];
  /** True while only the file tree is known; the analysis will add entry points, roles and journeys. */
  provisional: boolean;
}

export const MAX_WAYPOINTS = 6;
export const MAX_DISTRICT_SIGNS = 6;
export const MAX_TRAILHEADS = 4;

function shortName(path: string, isBlock: boolean): string {
  const name = path.slice(path.lastIndexOf("/") + 1) || path;
  return isBlock ? `${name}/` : name;
}

export function buildWayfinding(model: RepoModel, layout: LayoutResult, analysis: WorkspaceAnalysis | null): Wayfinding {
  const buildingFor = (path: string) => {
    const file = model.filesByPath.get(path);
    return file ? buildingIdForFile(layout, file) : undefined;
  };

  // ---- Start here ------------------------------------------------------------
  const candidates: Omit<Waypoint, "order" | "buildingId" | "title">[] = analysis
    ? analysis.onboarding.readingOrder.map((r) => ({ path: r.path, ...(r.symbol ? { symbol: r.symbol } : {}), reason: r.reason, basis: r.basis }))
    : provisionalReadingOrder(model);

  const waypoints: Waypoint[] = [];
  const usedBuildings = new Set<string>();
  for (const c of candidates) {
    if (waypoints.length >= MAX_WAYPOINTS) break;
    const buildingId = buildingFor(c.path);
    // One pin per building: a file inside a block, or a second symbol in the same file, adds nothing to the map.
    if (!buildingId || usedBuildings.has(buildingId)) continue;
    usedBuildings.add(buildingId);
    const isBlock = buildingId !== c.path;
    waypoints.push({ ...c, order: waypoints.length + 1, buildingId, title: shortName(isBlock ? buildingId : c.path, isBlock) });
  }

  // ---- District signs ----------------------------------------------------------
  const districts: DistrictSign[] = [];
  if (analysis) {
    // Roles established from code (e.g. routes) before ones guessed from folder names, then bigger districts first.
    const rank = (basis: Basis) => (basis === "heuristic" ? 1 : 0);
    const modules = analysis.overview.modules
      .filter((m) => m.path !== "" && m.role)
      .sort((a, b) => rank(a.role!.basis) - rank(b.role!.basis) || b.files - a.files || (a.path < b.path ? -1 : 1));
    for (const m of modules) {
      if (districts.length >= MAX_DISTRICT_SIGNS) break;
      const plateIndex = layout.plateIndex.get(m.path);
      if (plateIndex === undefined) continue;
      const plate = layout.plates[plateIndex];
      // A street sign at the district's front edge (the side the opening view looks from), so it never covers the pins above the roofs.
      districts.push({ path: m.path, name: plate.name, role: m.role!.label, basis: m.role!.basis, x: plate.x, y: plate.top + 0.2, z: plate.z + plate.depth_ / 2 });
    }
  }

  // ---- Trailheads --------------------------------------------------------------
  const trailheads: Trailhead[] = [];
  if (analysis) {
    const byBuilding = new Map<string, Trailhead>();
    for (const j of analysis.journeys) {
      if (j.kind !== "http" && j.kind !== "main") continue;
      if (!j.steps.some((s) => s.kind === "call")) continue; // a journey that goes nowhere isn't worth following
      const buildingId = buildingFor(j.start.path);
      if (!buildingId) continue;
      const existing = byBuilding.get(buildingId);
      if (existing) {
        existing.more++;
        continue;
      }
      if (byBuilding.size >= MAX_TRAILHEADS) continue;
      byBuilding.set(buildingId, { journeyId: j.id, title: j.kind === "main" ? "Run" : j.title, more: 0, buildingId });
    }
    trailheads.push(...byBuilding.values());
  }

  return { waypoints, districts, trailheads, provisional: !analysis };
}

/** Before the code is parsed: what the file tree alone says is worth reading first. */
function provisionalReadingOrder(model: RepoModel): Omit<Waypoint, "order" | "buildingId" | "title">[] {
  const out: Omit<Waypoint, "order" | "buildingId" | "title">[] = [];
  const shallowFirst = [...model.files].sort((a, b) => a.depth - b.depth || (a.path < b.path ? -1 : 1));
  const readme = shallowFirst.find((f) => f.landmark === "readme");
  if (readme) out.push({ path: readme.path, reason: "The project's own description of what it is and how to run it.", basis: "fact" });
  for (const f of shallowFirst) {
    if (f.landmark === "manifest" && f.depth === 0) out.push({ path: f.path, reason: "Declares dependencies and the commands used to build, run and test the project.", basis: "fact" });
  }
  for (const f of shallowFirst) {
    if (f.landmark === "entry") out.push({ path: f.path, reason: "Named like an entry point. The code analysis will confirm or replace this.", basis: "heuristic" });
  }
  return out;
}
