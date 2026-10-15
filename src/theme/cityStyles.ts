import type { HeightProfile } from "@/lib/layout/styleHeights";

/**
 * City styles are visual interpretations of the same repository. They change
 * architecture, materials, ground, vegetation and light. They never change
 * where a building stands, what it represents, or how big its file is.
 *
 * Inspirations are real places and genres; no real-world or fictional city's
 * branded assets are reproduced.
 */
export type CityStyleId = "financial" | "thames" | "waterfront" | "noir";

export interface EnvironmentPreset {
  skyTop: string;
  skyMid: string;
  horizon: string;
  fog: string;
  /** Fog distances as multiples of the world's size. */
  fogNear: number;
  fogFar: number;
  sun: string;
  sunIntensity: number;
  /** Radians above the horizon. */
  sunElevation: number;
  sunAzimuth: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  envIntensity: number;
  water: string;
  waterDeep: string;
  windowLit: string;
  /** Emissive strength of lit windows (0 by day). */
  windowGlow: number;
  /** Share of windows that are lit. */
  litRatio: number;
  streetLight: string;
  streetGlow: number;
  stars: number;
  bloom: number;
}

export interface CityStyle {
  id: CityStyleId;
  name: string;
  inspiration: string;
  heights: HeightProfile;
  facade: {
    stone: string[];
    glass: string[];
    roof: string[];
    trim: string;
    metal: string;
    /** Floor height and window column width, in world units. */
    floor: number;
    column: number;
  };
  ground: {
    island: string;
    quay: string;
    road: string;
    lane: string;
    sidewalk: string;
    plaza: string;
    /** How much each district's identifying tint shows through (0..1). */
    districtTint: number;
  };
  trees: { density: number; foliage: string[]; pine: string[] };
  /** Smaller files become historic terraces rather than towers. */
  terraces: boolean;
  day: EnvironmentPreset;
  night: EnvironmentPreset;
}

const night = (p: Partial<EnvironmentPreset> & Pick<EnvironmentPreset, "skyTop" | "skyMid" | "horizon" | "fog">): EnvironmentPreset => ({
  fogNear: 1.2,
  fogFar: 4.2,
  sun: "#9fb3e6",
  sunIntensity: 0.32,
  sunElevation: 0.95,
  sunAzimuth: 0.9,
  hemiSky: "#2a3550",
  hemiGround: "#0b0d12",
  hemiIntensity: 0.3,
  envIntensity: 0.12,
  water: "#0d1828",
  waterDeep: "#060c16",
  windowLit: "#ffc983",
  windowGlow: 1.9,
  litRatio: 0.46,
  streetLight: "#ffb768",
  streetGlow: 2.2,
  stars: 0.8,
  bloom: 0.95,
  ...p,
});

export const CITY_STYLES: Record<CityStyleId, CityStyle> = {
  financial: {
    id: "financial",
    name: "Financial District",
    inspiration: "Setback towers, limestone and bronze",
    heights: { towers: { scale: 1.45, exponent: 1.3, max: 18 }, lowRise: 1.15, landmark: 1.3 },
    facade: {
      stone: ["#d8d0c2", "#cfc5b4", "#bfb6a6", "#e2dccf", "#a89f92", "#8f8a84"],
      glass: ["#71859a", "#62778c", "#8597a8", "#586c80"],
      roof: ["#6f6a63", "#8a8378", "#5d5a57"],
      trim: "#b8ad98",
      metal: "#9c8a6a",
      floor: 0.34,
      column: 0.26,
    },
    ground: {
      island: "#7f9470",
      quay: "#a8a39a",
      road: "#3b3f46",
      lane: "#e8e1cf",
      sidewalk: "#a8a399",
      plaza: "#b9b2a4",
      districtTint: 0.12,
    },
    trees: { density: 0.55, foliage: ["#5d7d4f", "#6b8a57", "#577349"], pine: ["#45614a"] },
    terraces: false,
    day: {
      skyTop: "#5d8dc2",
      skyMid: "#a7c3df",
      horizon: "#e2e4e1",
      fog: "#d2d8dc",
      fogNear: 1.6,
      fogFar: 5.2,
      sun: "#fff1dc",
      sunIntensity: 2.9,
      sunElevation: 0.72,
      sunAzimuth: -0.65,
      hemiSky: "#d2e1f2",
      hemiGround: "#8a8478",
      hemiIntensity: 0.8,
      envIntensity: 0.65,
      water: "#5e8ba0",
      waterDeep: "#355e72",
      windowLit: "#ffd9a0",
      windowGlow: 0,
      litRatio: 0.38,
      streetLight: "#ffd09a",
      streetGlow: 0,
      stars: 0,
      bloom: 0.35,
    },
    night: night({ skyTop: "#04081a", skyMid: "#0d1834", horizon: "#2b3252", fog: "#141b31" }),
  },

  thames: {
    id: "thames",
    name: "Thames",
    inspiration: "Brick terraces, Portland stone, a few glass landmarks",
    heights: { towers: { scale: 0.7, exponent: 1.62, max: 17 }, lowRise: 1, landmark: 1.15 },
    facade: {
      stone: ["#e4ded2", "#d8d1c3", "#b7704f", "#a8604a", "#9c5b45", "#c9bfae"],
      glass: ["#6f8796", "#5f7888", "#7d939f"],
      roof: ["#4f5560", "#5b5f66", "#6a6560"],
      trim: "#e8e2d6",
      metal: "#7f8a8f",
      floor: 0.36,
      column: 0.3,
    },
    ground: {
      island: "#6f8a5c",
      quay: "#b4ad9f",
      road: "#45484d",
      lane: "#f0ead8",
      sidewalk: "#b3ada1",
      plaza: "#c2bbac",
      districtTint: 0.14,
    },
    trees: { density: 0.9, foliage: ["#5f7f4c", "#6e8c55", "#55733f", "#7a9258"], pine: ["#4b6650"] },
    terraces: true,
    day: {
      skyTop: "#8c9fb1",
      skyMid: "#b5c1cb",
      horizon: "#d6d9d8",
      fog: "#c6cccf",
      fogNear: 1.2,
      fogFar: 4,
      sun: "#fff4e6",
      sunIntensity: 1.7,
      sunElevation: 0.85,
      sunAzimuth: -0.4,
      hemiSky: "#dfe5ea",
      hemiGround: "#7c7a71",
      hemiIntensity: 1.05,
      envIntensity: 0.55,
      water: "#68838c",
      waterDeep: "#465d64",
      windowLit: "#ffd6a0",
      windowGlow: 0,
      litRatio: 0.34,
      streetLight: "#ffd09a",
      streetGlow: 0,
      stars: 0,
      bloom: 0.3,
    },
    night: night({
      skyTop: "#090e19",
      skyMid: "#18212f",
      horizon: "#383d48",
      fog: "#1d232d",
      fogNear: 0.9,
      fogFar: 3.4,
      litRatio: 0.4,
      streetLight: "#ffc27a",
      stars: 0.25,
    }),
  },

  waterfront: {
    id: "waterfront",
    name: "Waterfront",
    inspiration: "Glass towers, open plazas, reflections on the river",
    heights: { towers: { scale: 1.35, exponent: 1.25, max: 16 }, lowRise: 0.95, landmark: 1.2 },
    facade: {
      stone: ["#e7e9ea", "#d6dadc", "#c4cacd", "#eef0f0"],
      glass: ["#6f9cb6", "#6190ab", "#82abc0", "#5585a0", "#8cb3c6"],
      roof: ["#c9cfd2", "#b4bbbf"],
      trim: "#eef1f2",
      metal: "#c7ced2",
      floor: 0.32,
      column: 0.22,
    },
    ground: {
      island: "#7c9a6d",
      quay: "#b59a78",
      road: "#3f444b",
      lane: "#f3f3ee",
      sidewalk: "#bcbfbc",
      plaza: "#c9cac4",
      districtTint: 0.1,
    },
    trees: { density: 0.5, foliage: ["#6a8d55", "#7a9a5e", "#5c7f4c"], pine: ["#4f6b54"] },
    terraces: false,
    day: {
      skyTop: "#4d8ad2",
      skyMid: "#9cc3eb",
      horizon: "#e8f0f5",
      fog: "#d5e3ed",
      fogNear: 1.7,
      fogFar: 5.6,
      sun: "#fff8ee",
      sunIntensity: 3.1,
      sunElevation: 0.92,
      sunAzimuth: -0.85,
      hemiSky: "#d8e8f7",
      hemiGround: "#8c8a80",
      hemiIntensity: 0.75,
      envIntensity: 0.9,
      water: "#3f86a8",
      waterDeep: "#235b78",
      windowLit: "#e9f0ff",
      windowGlow: 0,
      litRatio: 0.5,
      streetLight: "#ffd9a6",
      streetGlow: 0,
      stars: 0,
      bloom: 0.35,
    },
    night: night({
      skyTop: "#030816",
      skyMid: "#0a1630",
      horizon: "#1c3452",
      fog: "#0f1c33",
      windowLit: "#e3ecff",
      litRatio: 0.52,
      streetLight: "#ffd9a0",
      envIntensity: 0.25,
    }),
  },

  noir: {
    id: "noir",
    name: "Noir",
    inspiration: "A fictional metropolis: gothic spires, stone and haze",
    heights: { towers: { scale: 1.55, exponent: 1.35, max: 20 }, lowRise: 1.2, landmark: 1.4 },
    facade: {
      stone: ["#6d6a66", "#5d5b58", "#7a756e", "#4f4d4b", "#85807a"],
      glass: ["#3c4650", "#33404a", "#46525c"],
      roof: ["#3b3a39", "#4a4643", "#2f2f30"],
      trim: "#8a847b",
      metal: "#5f6a64",
      floor: 0.38,
      column: 0.3,
    },
    ground: {
      island: "#4e5a49",
      quay: "#6e6a63",
      road: "#26282c",
      lane: "#bfb7a3",
      sidewalk: "#6b6862",
      plaza: "#77736b",
      districtTint: 0.08,
    },
    trees: { density: 0.35, foliage: ["#3f5238", "#475a3d"], pine: ["#34443a"] },
    terraces: false,
    day: {
      skyTop: "#6c737b",
      skyMid: "#8d9298",
      horizon: "#a7a8a6",
      fog: "#979a98",
      fogNear: 0.8,
      fogFar: 3,
      sun: "#ece6da",
      sunIntensity: 1.25,
      sunElevation: 0.5,
      sunAzimuth: -1.1,
      hemiSky: "#b5b8b9",
      hemiGround: "#4d4a45",
      hemiIntensity: 0.95,
      envIntensity: 0.4,
      water: "#3e494f",
      waterDeep: "#252d32",
      windowLit: "#ffb866",
      windowGlow: 0,
      litRatio: 0.24,
      streetLight: "#ffad5a",
      streetGlow: 0,
      stars: 0,
      bloom: 0.3,
    },
    night: night({
      skyTop: "#020305",
      skyMid: "#090c11",
      horizon: "#222528",
      fog: "#15181b",
      fogNear: 0.7,
      fogFar: 2.8,
      windowLit: "#ffb866",
      litRatio: 0.26,
      streetLight: "#ffa552",
      stars: 0.1,
      sun: "#8ea3c4",
    }),
  },
};

export const CITY_STYLE_IDS = Object.keys(CITY_STYLES) as CityStyleId[];

export function isCityStyleId(v: unknown): v is CityStyleId {
  return typeof v === "string" && v in CITY_STYLES;
}
