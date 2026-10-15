import type { Category } from "@/lib/analysis/types";
import type { Archetype } from "@/lib/layout/archetypes";

/**
 * Language colours: softened, clay-paint versions of the colours developers
 * already associate with each language. Tuned to read well under warm light.
 */
export const LANGUAGE_COLORS: Record<string, string> = {
  typescript: "#5b8ee6",
  javascript: "#f3cd57",
  python: "#4fae9b",
  go: "#5cc8dc",
  rust: "#df8b5e",
  java: "#d27b4f",
  kotlin: "#a885e0",
  swift: "#f4825a",
  objc: "#6f9ad6",
  c: "#8f9bb0",
  cpp: "#e46f9a",
  csharp: "#6cba68",
  fsharp: "#5fb7c9",
  ruby: "#e15a6b",
  php: "#9097db",
  scala: "#de6060",
  dart: "#53c0dc",
  elixir: "#9a78c4",
  erlang: "#c25b7c",
  haskell: "#8a74ba",
  ocaml: "#ef9a52",
  clojure: "#79b85f",
  lua: "#5868b8",
  r: "#4c86cf",
  julia: "#a170c9",
  zig: "#efaa4c",
  nim: "#f0d24f",
  solidity: "#8c8f9e",
  shell: "#93d071",
  powershell: "#5c8fd0",
  html: "#ee8559",
  css: "#a78be6",
  scss: "#dd78b0",
  less: "#8e7ec9",
  vue: "#5fc795",
  svelte: "#f47a4e",
  astro: "#f58d6c",
  markdown: "#f1e7d3",
  mdx: "#efd8a8",
  rst: "#eadfcb",
  text: "#e6dfd2",
  json: "#c3cb72",
  yaml: "#e0b062",
  toml: "#c79a74",
  xml: "#e59c6d",
  csv: "#a9cf8e",
  sql: "#eab35a",
  graphql: "#e46bb0",
  protobuf: "#9fb2c9",
  docker: "#4f9fe8",
  make: "#83a46a",
  cmake: "#7fae76",
  nix: "#8aa6dc",
  hcl: "#9b86e0",
  ini: "#c6c0b4",
  image: "#f0a9bd",
  font: "#b6aee3",
  media: "#e9a0a0",
  model3d: "#9ed6c9",
  binary: "#a9a39a",
  other: "#c4bdb1",
};

export function languageColor(id: string): string {
  return LANGUAGE_COLORS[id] ?? LANGUAGE_COLORS.other;
}

export interface CategoryMeta {
  label: string;
  plural: string;
  archetype: Archetype;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  source: { label: "Source", plural: "Source files", archetype: "tower" },
  test: { label: "Tests", plural: "Tests", archetype: "lab" },
  config: { label: "Config", plural: "Config files", archetype: "silo" },
  build: { label: "Build & CI", plural: "Build & CI files", archetype: "factory" },
  docs: { label: "Docs", plural: "Docs", archetype: "house" },
  style: { label: "Styles", plural: "Stylesheets", archetype: "pavilion" },
  data: { label: "Data", plural: "Data files", archetype: "warehouse" },
  asset: { label: "Assets", plural: "Assets", archetype: "crates" },
  other: { label: "Other", plural: "Other files", archetype: "kiosk" },
};

/** Muted ground tints for districts. */
export const DISTRICT_TINTS = [
  "#efe2c9",
  "#dde8cc",
  "#f1dacb",
  "#e2dbef",
  "#d3e5ec",
  "#f3e9c2",
  "#d3eadf",
  "#f0d6dc",
];

export const WORLD = {
  skyTop: "#7fb0e0",
  skyMid: "#b9d3ec",
  horizon: "#f6dcc2",
  fog: "#efd9c6",
  sun: "#ffe0b5",
  hemiSky: "#d4e6ff",
  hemiGround: "#efcf9f",
  grass: "#a6cc7c",
  grassDark: "#8fbd6a",
  sand: "#efd9a8",
  sandWet: "#d9bf8a",
  earth: "#b88560",
  water: "#7cc6d3",
  waterDeep: "#4f9fbd",
  road: "#7d8395",
  roadEdge: "#6b7083",
  lane: "#f7eed6",
  plaza: "#f1e6d0",
  windowLit: "#ffc96b",
  windowGlass: "#5c6f8a",
  ink: "#2f2e3a",
  dim: "#cfc8bc",
  hover: "#fff6dc",
  select: "#ffb547",
  importsOut: "#f59e2c",
  importsIn: "#2bb3a6",
} as const;

/** Roof and trim palettes per archetype, picked by each building's variant. */
export const ROOF_COLORS: Partial<Record<Archetype, string[]>> = {
  tower: ["#f3ead8", "#e7e2d6", "#f0e3cc"],
  house: ["#d9765a", "#c96a52", "#e08a5f", "#7b8fb0", "#6aa07a"],
  lab: ["#bfeee3", "#c9e6f5", "#d9f2e2"],
  silo: ["#8e95a6", "#9aa2b4", "#a5927e"],
  factory: ["#8b909e", "#9a8f86", "#7e8796"],
  pavilion: ["#7a6fb0", "#d17aa5", "#5a8fb5"],
  warehouse: ["#c7cbd4", "#b9c0cb", "#d0cbc2"],
  crates: ["#c9995f", "#b88a52", "#d4a76c"],
  kiosk: ["#e7d9c4", "#d8c8b4"],
  block: ["#efe6d6"],
};
