import * as THREE from "three";

/** Rounded rectangle centred on the origin, in the XY plane. */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const rr = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001));
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

/**
 * A rounded slab lying flat: top face at `top`, extending `thickness` down.
 * Optional bevel softens the top edge.
 */
export function slabGeometry(
  w: number,
  d: number,
  r: number,
  thickness: number,
  top: number,
  bevel = 0,
  curveSegments = 6,
): THREE.ExtrudeGeometry {
  // The bevel grows the outline, so start from a smaller one to keep the footprint exact.
  const shape = roundedRectShape(w - 2 * bevel, d - 2 * bevel, r - bevel);
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, thickness - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevel > 0 ? 2 : 0,
    curveSegments,
  });
  // Extrusion runs along +Z; lay it flat so it rises along +Y.
  geom.rotateX(-Math.PI / 2);
  geom.computeBoundingBox();
  const maxY = geom.boundingBox!.max.y;
  geom.translate(0, top - maxY, 0);
  return geom;
}

/** Points tracing a rounded rectangle at height y, for outline lines. */
export function roundedRectPoints(cx: number, cz: number, w: number, d: number, r: number, y: number): [number, number, number][] {
  const shape = roundedRectShape(w, d, r);
  return shape.getPoints(6).map((p) => [cx + p.x, y, cz - p.y] as [number, number, number]);
}
