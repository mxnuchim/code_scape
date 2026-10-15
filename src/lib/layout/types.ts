import type { Category } from "../analysis/types";
import type { Archetype } from "./archetypes";

export interface BuildingLayout {
  /** File path for files, folder path for blocks, "#overflow" for root overflow. */
  id: string;
  kind: "file" | "block";
  archetype: Archetype;
  /** Centre of the footprint, in world units. */
  x: number;
  z: number;
  /** Ground level the building stands on. */
  y: number;
  width: number;
  depth: number;
  height: number;
  /** Language id used for the body colour. */
  language: string;
  category: Category;
  /** The folder whose lot this building stands in. */
  dirPath: string;
  /** The top-level district ("" for the civic centre at the root). */
  district: string;
  /** Stable 0..1 value for visual variation (roof style, windows, tint). */
  variant: number;
  /** Seconds after the city starts assembling that this building rises. */
  delay: number;
}

export interface PlateLayout {
  /** Folder path. */
  id: string;
  name: string;
  depth: number;
  x: number;
  z: number;
  width: number;
  depth_: number;
  /** Top surface height. */
  top: number;
  thickness: number;
  aggregated: boolean;
  isPackage: boolean;
  /** Stable 0..1 used for tinting. */
  tint: number;
}

export interface LotLayout {
  dirPath: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  top: number;
}

export interface TreeLayout {
  x: number;
  y: number;
  z: number;
  scale: number;
  kind: 0 | 1 | 2;
  variant: number;
}

export interface LaneLayout {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface LampLayout {
  x: number;
  z: number;
}

export interface LabelLayout {
  id: string;
  text: string;
  x: number;
  z: number;
  y: number;
  size: number;
  depth: number;
  maxWidth: number;
}

export interface CityBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
}

export interface CityLayout {
  seed: number;
  buildings: BuildingLayout[];
  buildingIndex: Map<string, number>;
  plates: PlateLayout[];
  plateIndex: Map<string, number>;
  /** The civic plaza under the root's own files, if there are any. */
  plaza: LotLayout | null;
  trees: TreeLayout[];
  lanes: LaneLayout[];
  /** Streetlights along the avenues and the ring road. */
  lamps: LampLayout[];
  labels: LabelLayout[];
  /** The road surface: the whole built area. */
  city: CityBounds;
  /** The island the city sits on. */
  island: CityBounds;
  /** Longest assembly delay plus rise time, in seconds. */
  assemblyDuration: number;
}
