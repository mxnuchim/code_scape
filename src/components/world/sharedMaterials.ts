import type * as THREE from "three";
import type { MaterialKind } from "./buildingGeometries";
import {
  createAccentMaterial,
  createClayMaterial,
  createFacadeMaterial,
  createGlassMaterial,
  createGlowMaterial,
  createMetalMaterial,
} from "./materials";

let shared: Record<MaterialKind, THREE.Material> | null = null;

/** Building materials are shared by every city and style for the lifetime of the canvas. */
export function getSharedMaterials(): Record<MaterialKind, THREE.Material> {
  if (!shared) {
    shared = {
      masonry: createFacadeMaterial("masonry"),
      curtain: createFacadeMaterial("curtain"),
      curtainRound: createFacadeMaterial("curtainRound"),
      clay: createClayMaterial(),
      metal: createMetalMaterial(),
      glass: createGlassMaterial(),
      accent: createAccentMaterial(),
      glow: createGlowMaterial(),
    };
  }
  return shared;
}

export function disposeSharedMaterials() {
  if (!shared) return;
  for (const m of Object.values(shared)) m.dispose();
  shared = null;
}
