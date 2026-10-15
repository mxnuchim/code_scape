import type { Category, LandmarkKind } from "../analysis/types";

export const ARCHETYPES = [
  "tower",
  "lab",
  "silo",
  "factory",
  "house",
  "pavilion",
  "warehouse",
  "crates",
  "kiosk",
  "block",
  "townhall",
  "clocktower",
  "lighthouse",
  "monument",
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

const BY_CATEGORY: Record<Category, Archetype> = {
  source: "tower",
  test: "lab",
  config: "silo",
  build: "factory",
  docs: "house",
  style: "pavilion",
  data: "warehouse",
  asset: "crates",
  other: "kiosk",
};

const BY_LANDMARK: Record<LandmarkKind, Archetype> = {
  readme: "townhall",
  manifest: "clocktower",
  entry: "lighthouse",
  license: "monument",
};

export function archetypeFor(category: Category, landmark?: LandmarkKind): Archetype {
  return landmark ? BY_LANDMARK[landmark] : BY_CATEGORY[category];
}

/** Volume scale: 0 for an empty file, ~3.5 at 4 KB, ~6.7 at 40 KB, ~10 at 400 KB. */
export function volume(bytes: number): number {
  return Math.log2(1 + bytes / 400);
}

interface Shape {
  /** Height = base + perVolume * volume(bytes), clamped to max. */
  base: number;
  perVolume: number;
  max: number;
  /** Footprint as a fraction of the cell (x, z). */
  fillX: number;
  fillZ: number;
}

export const SHAPES: Record<Archetype, Shape> = {
  tower: { base: 0.7, perVolume: 0.58, max: 8.5, fillX: 0.76, fillZ: 0.76 },
  lab: { base: 0.55, perVolume: 0.2, max: 2.8, fillX: 0.74, fillZ: 0.74 },
  silo: { base: 0.6, perVolume: 0.24, max: 3.4, fillX: 0.58, fillZ: 0.58 },
  factory: { base: 0.65, perVolume: 0.2, max: 2.6, fillX: 0.8, fillZ: 0.7 },
  house: { base: 0.55, perVolume: 0.16, max: 2.2, fillX: 0.7, fillZ: 0.66 },
  pavilion: { base: 0.45, perVolume: 0.18, max: 2.2, fillX: 0.68, fillZ: 0.68 },
  warehouse: { base: 0.45, perVolume: 0.16, max: 2, fillX: 0.82, fillZ: 0.64 },
  crates: { base: 0.3, perVolume: 0.07, max: 1, fillX: 0.58, fillZ: 0.58 },
  kiosk: { base: 0.4, perVolume: 0.12, max: 1.6, fillX: 0.58, fillZ: 0.58 },
  block: { base: 1.1, perVolume: 0, max: 7, fillX: 0.78, fillZ: 0.78 },
  townhall: { base: 2.1, perVolume: 0.05, max: 2.8, fillX: 0.8, fillZ: 0.72 },
  clocktower: { base: 3.2, perVolume: 0.12, max: 4.6, fillX: 0.46, fillZ: 0.46 },
  lighthouse: { base: 2.8, perVolume: 0.22, max: 5.8, fillX: 0.5, fillZ: 0.5 },
  monument: { base: 1.3, perVolume: 0.02, max: 1.6, fillX: 0.42, fillZ: 0.42 },
};

export function heightFor(archetype: Archetype, bytes: number): number {
  const s = SHAPES[archetype];
  return Math.min(s.max, s.base + s.perVolume * volume(bytes));
}

export function blockHeight(fileCount: number): number {
  return Math.min(SHAPES.block.max, SHAPES.block.base + 0.55 * Math.log2(Math.max(1, fileCount)));
}

export const ARCHETYPE_INFO: Record<Archetype, { name: string; meaning: string }> = {
  tower: { name: "Office tower", meaning: "Source code. Height follows file size." },
  lab: { name: "Test lab", meaning: "Tests, specs, fixtures and snapshots." },
  silo: { name: "Silo", meaning: "Configuration: manifests, tool configs, dotfiles." },
  factory: { name: "Factory", meaning: "Build, CI and tooling: workflows, Dockerfiles, scripts." },
  house: { name: "House", meaning: "Documentation and prose." },
  pavilion: { name: "Pavilion", meaning: "Stylesheets." },
  warehouse: { name: "Warehouse", meaning: "Data and schemas: JSON, YAML, SQL, CSV…" },
  crates: { name: "Crates", meaning: "Assets: images, fonts, media." },
  kiosk: { name: "Kiosk", meaning: "Files of other or unknown types." },
  block: { name: "City block", meaning: "A folder drawn as one block to keep large cities smooth." },
  townhall: { name: "Town hall", meaning: "The repository's root README." },
  clocktower: { name: "Clock tower", meaning: "A package manifest. Marks a project or package root." },
  lighthouse: { name: "Lighthouse", meaning: "A likely entry point, judged by its file name and location." },
  monument: { name: "Monument", meaning: "The project license." },
};
