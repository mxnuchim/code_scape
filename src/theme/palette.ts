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

/** Interaction colours shared by the world and the interface. */
export const WORLD = {
  dim: "#7b7f86",
  hover: "#ffffff",
  select: "#f5a524",
  importsOut: "#f5a524",
  importsIn: "#3cc6b8",
} as const;

/** Facade colours for the "Role" lens; also used in composition bars. */
export const CATEGORY_COLORS: Record<Category, string> = {
  source: "#6d8fd8",
  test: "#4fb3a2",
  config: "#9aa3b2",
  build: "#c97a5a",
  docs: "#d9c49a",
  style: "#a990e0",
  data: "#d9a95a",
  asset: "#e39bb2",
  other: "#a7a29a",
};
