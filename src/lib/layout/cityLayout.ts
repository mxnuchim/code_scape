import type { DirNode, FileNode, RepoModel } from "../analysis/types";
import { SHAPES, archetypeFor, blockHeight, heightFor } from "./archetypes";
import { createRandom, hash01, hashString } from "./random";
import { shrink, squarify, type Rect } from "./treemap";
import type {
  BuildingLayout,
  CityBounds,
  CityLayout,
  LabelLayout,
  LaneLayout,
  PlateLayout,
  TreeLayout,
} from "./types";

/** World units per building cell inside a block. */
export const CELL = 1.55;
/** Cells in the civic plaza (root files) are roomier. */
const ROOT_CELL = 2.1;
/** Street width between siblings, by the parent's depth. */
const GAPS = [1.9, 0.8, 0.42, 0.26];
const gapFor = (depth: number) => GAPS[Math.min(depth, GAPS.length - 1)];
/** Border between a plate's edge and its contents. */
const padFor = (depth: number) => (depth === 0 ? 0.6 : depth === 1 ? 0.26 : 0.16);
const ROAD_TOP = 0.04;
const PLAZA_TOP = 0.13;
const plateTop = (depth: number) => 0.2 + (depth - 1) * 0.07;
const ISLAND_MARGIN = 5;
const CITY_ASPECT = 1.3;
const MAX_TREES = 1800;

/**
 * Ground labels scale with their district (estimated from file count) so they
 * stay legible from the overview. A strip along the front edge is reserved for them.
 */
function labelSizeFor(dir: DirNode): number {
  const side = Math.sqrt(Math.max(1, dir.stats.files)) * CELL;
  if (dir.depth === 1) return Math.min(1.5, Math.max(0.62, side * 0.07));
  if (dir.depth === 2 && dir.stats.files >= 8 && !dir.aggregated) return Math.min(0.75, Math.max(0.36, side * 0.05));
  return 0;
}

function labelStripFor(dir: DirNode): number {
  const size = labelSizeFor(dir);
  return size ? size + 0.38 : 0;
}

const slot = (area: number, gap: number) => (Math.sqrt(area) + gap) ** 2;
const lotCells = (n: number) => n + (n >= 5 ? Math.floor(n * 0.15) : 0);
const blockCells = (files: number) => Math.min(10, Math.max(2, 1.5 + Math.log2(files)));

function byValueThenKey<T extends { value: number; key: string }>(a: T, b: T) {
  if (b.value !== a.value) return b.value - a.value;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function bySizeThenPath(a: FileNode, b: FileNode) {
  if (b.size !== a.size) return b.size - a.size;
  return a.path < b.path ? -1 : 1;
}

function dominant(map: Record<string, number>, fallback: string): string {
  let best = fallback;
  let bestN = -1;
  for (const key of Object.keys(map).sort()) {
    if (map[key] > bestN) {
      best = key;
      bestN = map[key];
    }
  }
  return best;
}

export interface LayoutResult extends CityLayout {
  /** Root files folded into the "#overflow" block, if any. */
  overflowFiles: Set<string>;
}

export function buildCityLayout(model: RepoModel): LayoutResult {
  const seed = hashString(model.meta.fullName.toLowerCase());
  const rand = createRandom(seed);

  const buildings: BuildingLayout[] = [];
  const plates: PlateLayout[] = [];
  const trees: TreeLayout[] = [];
  const lanes: LaneLayout[] = [];
  const labels: LabelLayout[] = [];
  const overflowFiles = new Set<string>();
  let plaza: CityLayout["plaza"] = null;

  // Root overflow: the smallest root files fold into one block.
  const rootFiles = [...model.root.files].sort(bySizeThenPath);
  const overflow = model.limits.rootOverflow;
  if (overflow > 0) {
    for (const f of rootFiles.slice(rootFiles.length - overflow)) overflowFiles.add(f.path);
  }
  const lotFilesOf = (dir: DirNode) =>
    dir.depth === 0 ? rootFiles.filter((f) => !overflowFiles.has(f.path)) : [...dir.files].sort(bySizeThenPath);
  const lotCount = (dir: DirNode) => lotFilesOf(dir).length + (dir.depth === 0 && overflow > 0 ? 1 : 0);

  // Percentiles drive footprint size, so a repo's biggest files read as its biggest buildings.
  const sizes = model.files.filter((f) => !f.aggregatedInto).map((f) => f.size).sort((a, b) => a - b);
  const percentile = (size: number) => {
    if (sizes.length <= 1) return 0.5;
    let lo = 0;
    let hi = sizes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sizes[mid] < size) lo = mid + 1;
      else hi = mid;
    }
    return lo / (sizes.length - 1);
  };

  // Bottom-up areas, memoised.
  const areaCache = new Map<DirNode, number>();
  const area = (dir: DirNode): number => {
    const cached = areaCache.get(dir);
    if (cached !== undefined) return cached;
    let result: number;
    if (dir.aggregated) {
      const side = Math.sqrt(blockCells(dir.stats.files) * CELL * CELL) + 2 * padFor(dir.depth);
      result = side * (side + labelStripFor(dir));
    } else {
      const g = gapFor(dir.depth);
      const cell = dir.depth === 0 ? ROOT_CELL : CELL;
      let inner = 0;
      const n = lotCount(dir);
      if (n > 0) inner += slot(lotCells(n) * cell * cell, g);
      for (const child of dir.dirs) inner += slot(area(child), g);
      const side = Math.sqrt(inner) + 2 * padFor(dir.depth);
      result = side * (side + labelStripFor(dir)) * 1.03;
    }
    areaCache.set(dir, result);
    return result;
  };

  // The root rectangle is slightly wider than deep, to suit landscape screens.
  const rootArea = area(model.root);
  const cityW = Math.sqrt(rootArea * CITY_ASPECT);
  const cityH = Math.sqrt(rootArea / CITY_ASPECT);
  const cityRect: Rect = { x: -cityW / 2, y: -cityH / 2, w: cityW, h: cityH };

  const district = (path: string) => (path ? path.split("/")[0] : "");

  const addLabel = (dir: DirNode, plate: Rect, top: number, pad: number) => {
    const strip = labelStripFor(dir);
    if (!strip) return;
    const size = labelSizeFor(dir);
    const maxWidth = plate.w - 2 * pad - 0.1;
    if (maxWidth < size * 2) return;
    const maxChars = Math.max(3, Math.floor(maxWidth / (size * 0.6)));
    const name = dir.name + (dir.isPackage ? "" : "/");
    const text = name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
    labels.push({
      id: dir.path,
      text,
      x: plate.x + pad + 0.05,
      z: plate.y + plate.h - pad - strip / 2 + 0.05,
      y: top + 0.006,
      size,
      depth: dir.depth,
      maxWidth,
    });
  };

  const placeTree = (x: number, z: number, y: number, scale: number) => {
    if (trees.length >= MAX_TREES) return;
    const r = rand();
    trees.push({ x, y, z, scale, kind: r < 0.62 ? 0 : r < 0.9 ? 1 : 2, variant: rand() });
  };

  const placeBlock = (dir: DirNode, inner: Rect, top: number) => {
    const s = SHAPES.block;
    const width = Math.min(inner.w * s.fillX, inner.h * s.fillZ * 1.6);
    const depth = Math.min(inner.h * s.fillZ, inner.w * s.fillX * 1.6);
    buildings.push({
      id: dir.path,
      kind: "block",
      archetype: "block",
      x: inner.x + inner.w / 2,
      z: inner.y + inner.h / 2,
      y: top,
      width,
      depth,
      height: blockHeight(dir.stats.files),
      language: dominant(dir.stats.languages, "other"),
      category: dominant(dir.stats.categories, "other") as BuildingLayout["category"],
      dirPath: dir.path,
      district: district(dir.path),
      variant: hash01(dir.path),
      delay: 0,
    });
  };

  const placeLot = (dir: DirNode, rect: Rect, top: number) => {
    const files = lotFilesOf(dir);
    const hasOverflow = dir.depth === 0 && overflow > 0;
    const n = files.length + (hasOverflow ? 1 : 0);
    if (n === 0) return;
    const total = lotCells(n);
    let cols = Math.max(1, Math.round(Math.sqrt((total * rect.w) / Math.max(rect.h, 0.01))));
    let rows = Math.ceil(total / cols);
    if (cols > 1 && (cols - 1) * rows >= total) {
      cols -= 1;
      rows = Math.ceil(total / cols);
    }
    const cw = rect.w / cols;
    const ch = rect.h / rows;
    const cx = rect.x + rect.w / 2;
    const cz = rect.y + rect.h / 2;
    const cells: { x: number; z: number; r: number; c: number; d: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = rect.x + (c + 0.5) * cw;
        const z = rect.y + (r + 0.5) * ch;
        cells.push({ x, z, r, c, d: (x - cx) ** 2 + (z - cz) ** 2 });
      }
    }
    // Biggest files take the most central cells: every block gets a little downtown.
    cells.sort((a, b) => a.d - b.d || a.r - b.r || a.c - b.c);

    const cellLimit = (dir.depth === 0 ? ROOT_CELL : CELL) * 1.2;
    const base = Math.min(cw, ch, cellLimit);
    files.forEach((file, i) => {
      const cell = cells[i];
      const archetype = archetypeFor(file.category, file.landmark);
      const s = SHAPES[archetype];
      const grow = 0.86 + 0.14 * percentile(file.size);
      buildings.push({
        id: file.path,
        kind: "file",
        archetype,
        x: cell.x,
        z: cell.z,
        y: top,
        width: base * s.fillX * grow,
        depth: base * s.fillZ * grow,
        height: heightFor(archetype, file.size),
        language: file.language,
        category: file.category,
        dirPath: dir.path,
        district: district(dir.path),
        variant: hash01(file.path),
        delay: 0,
      });
    });
    if (hasOverflow) {
      const cell = cells[files.length];
      const langs: Record<string, number> = {};
      for (const p of overflowFiles) {
        const f = model.filesByPath.get(p);
        if (f) langs[f.language] = (langs[f.language] ?? 0) + 1;
      }
      buildings.push({
        id: "#overflow",
        kind: "block",
        archetype: "block",
        x: cell.x,
        z: cell.z,
        y: top,
        width: base * 0.8,
        depth: base * 0.8,
        height: blockHeight(overflowFiles.size),
        language: dominant(langs, "other"),
        category: "other",
        dirPath: "",
        district: "",
        variant: hash01("#overflow"),
        delay: 0,
      });
    }
    // Leftover cells become small parks.
    for (let i = n; i < cells.length; i++) {
      const cell = cells[i];
      if (rand() < 0.15) continue;
      const scale = Math.min(1.25, Math.max(0.55, Math.min(cw, ch) / CELL)) * (0.78 + rand() * 0.35);
      placeTree(cell.x + (rand() - 0.5) * cw * 0.3, cell.z + (rand() - 0.5) * ch * 0.3, top, scale);
    }
  };

  const layoutDir = (dir: DirNode, rect: Rect) => {
    const isRoot = dir.depth === 0;
    const pad = padFor(dir.depth);
    const top = isRoot ? ROAD_TOP : plateTop(dir.depth);
    if (!isRoot) {
      plates.push({
        id: dir.path,
        name: dir.name,
        depth: dir.depth,
        x: rect.x + rect.w / 2,
        z: rect.y + rect.h / 2,
        width: rect.w,
        depth_: rect.h,
        top,
        thickness: top - (dir.depth === 1 ? ROAD_TOP : plateTop(dir.depth - 1)) + 0.02,
        aggregated: dir.aggregated,
        isPackage: dir.isPackage,
        tint: hash01(`tint:${dir.path}`),
      });
      addLabel(dir, rect, top, pad);
    }
    const strip = labelStripFor(dir);
    const padded = shrink(rect, pad);
    const inner: Rect = { ...padded, h: Math.max(0.2, padded.h - strip) };

    if (dir.aggregated) {
      placeBlock(dir, inner, top);
      return;
    }

    const g = gapFor(dir.depth);
    const cell = isRoot ? ROOT_CELL : CELL;
    type Item = { kind: "lot" } | { kind: "dir"; dir: DirNode };
    const items: { item: Item; value: number; key: string }[] = [];
    const n = lotCount(dir);
    if (n > 0) items.push({ item: { kind: "lot" }, value: slot(lotCells(n) * cell * cell, g), key: "" });
    for (const child of dir.dirs) items.push({ item: { kind: "dir", dir: child }, value: slot(area(child), g), key: child.path });
    items.sort(byValueThenKey);

    const cells = squarify(items, inner);
    for (const { item, rect: slotRect } of cells) {
      if (isRoot) {
        const right = slotRect.x + slotRect.w;
        const bottom = slotRect.y + slotRect.h;
        if (right < inner.x + inner.w - 0.05) lanes.push({ x1: right, z1: slotRect.y, x2: right, z2: bottom });
        if (bottom < inner.y + inner.h - 0.05) lanes.push({ x1: slotRect.x, z1: bottom, x2: right, z2: bottom });
      }
      const r = shrink(slotRect, g / 2);
      if (item.kind === "dir") {
        layoutDir(item.dir, r);
      } else if (isRoot) {
        plaza = { dirPath: "", x: r.x + r.w / 2, z: r.y + r.h / 2, width: r.w, depth: r.h, top: PLAZA_TOP };
        placeLot(dir, shrink(r, 0.3), PLAZA_TOP);
      } else {
        placeLot(dir, r, top);
      }
    }
  };

  layoutDir(model.root, cityRect);

  // Assembly order: a wave from the centre outwards.
  const maxR = Math.max(1, ...buildings.map((b) => Math.hypot(b.x, b.z)));
  let assemblyDuration = 0;
  for (const b of buildings) {
    b.delay = 0.12 + (Math.hypot(b.x, b.z) / maxR) * 1.5 + b.variant * 0.3;
    assemblyDuration = Math.max(assemblyDuration, b.delay + 0.9);
  }

  const city: CityBounds = {
    minX: cityRect.x,
    maxX: cityRect.x + cityRect.w,
    minZ: cityRect.y,
    maxZ: cityRect.y + cityRect.h,
    width: cityRect.w,
    depth: cityRect.h,
  };
  const margin = ISLAND_MARGIN + Math.min(6, Math.max(cityW, cityH) * 0.04);
  const island: CityBounds = {
    minX: city.minX - margin,
    maxX: city.maxX + margin,
    minZ: city.minZ - margin,
    maxZ: city.maxZ + margin,
    width: city.width + 2 * margin,
    depth: city.depth + 2 * margin,
  };

  // A ring of greenery between the city and the island's edge.
  const occupied = new Set<string>();
  const ringCount = Math.min(MAX_TREES - trees.length, Math.round((island.width + island.depth) * 1.7));
  for (let i = 0, attempts = 0; i < ringCount && attempts < ringCount * 6; attempts++) {
    const x = island.minX + 1.1 + rand() * (island.width - 2.2);
    const z = island.minZ + 1.1 + rand() * (island.depth - 2.2);
    const inCity = x > city.minX - 0.9 && x < city.maxX + 0.9 && z > city.minZ - 0.9 && z < city.maxZ + 0.9;
    if (inCity) continue;
    // Keep corners rounded like the island.
    const cornerR = 3.2;
    const qx = Math.max(0, Math.abs(x - (island.minX + island.maxX) / 2) - (island.width / 2 - cornerR));
    const qz = Math.max(0, Math.abs(z - (island.minZ + island.maxZ) / 2) - (island.depth / 2 - cornerR));
    if (Math.hypot(qx, qz) > cornerR - 1.1) continue;
    const key = `${Math.round(x / 1.15)}:${Math.round(z / 1.15)}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    placeTree(x, z, 0, 0.8 + rand() * 0.6);
    i++;
  }

  const buildingIndex = new Map<string, number>();
  buildings.forEach((b, i) => buildingIndex.set(b.id, i));
  const plateIndex = new Map<string, number>();
  plates.forEach((p, i) => plateIndex.set(p.id, i));

  return {
    seed,
    buildings,
    buildingIndex,
    plates,
    plateIndex,
    plaza,
    trees,
    lanes,
    labels,
    city,
    island,
    assemblyDuration,
    overflowFiles,
  };
}

/** Which building a file is drawn in: its own, or the block that contains it. */
export function buildingIdForFile(
  layout: LayoutResult,
  file: Pick<FileNode, "path" | "aggregatedInto">,
): string | undefined {
  if (layout.buildingIndex.has(file.path)) return file.path;
  if (file.aggregatedInto !== undefined && layout.buildingIndex.has(file.aggregatedInto)) return file.aggregatedInto;
  if (layout.overflowFiles.has(file.path)) return "#overflow";
  return undefined;
}
