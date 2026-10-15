import type * as THREE from "three";
import type { MaterialKind } from "./buildingGeometries";
import { createClayMaterial, createGlassMaterial, createGlowMaterial, createWindowMaterial } from "./materials";

let shared: Record<MaterialKind, THREE.Material> | null = null;

/** Building materials are shared by every city for the lifetime of the canvas. */
export function getSharedMaterials(): Record<MaterialKind, THREE.Material> {
  if (!shared) {
    shared = {
      clay: createClayMaterial(),
      windows: createWindowMaterial(),
      glass: createGlassMaterial(),
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
