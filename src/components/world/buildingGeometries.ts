import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Archetype } from "@/lib/layout/archetypes";
import type { BuildingLayout } from "@/lib/layout/types";
import type { CityStyleId } from "@/theme/cityStyles";

/*
 * Architecture kits. Unit geometries have their base at y = 0, a footprint
 * centred on the origin and height 1. Each part is scaled per building by its
 * `place` function, so one geometry serves every instance of that part.
 *
 * A style picks a kit per archetype. The archetype (what the file does) and
 * the footprint (where it is, how big) come from the data and never change;
 * only the architecture that expresses them does.
 */

const cache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, build: () => THREE.BufferGeometry): () => THREE.BufferGeometry {
  return () => {
    let g = cache.get(key);
    if (!g) {
      g = build();
      g.computeBoundingSphere();
      cache.set(key, g);
    }
    return g;
  };
}

export function disposeBuildingGeometries() {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    if (!g.getAttribute("uv")) {
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
    }
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    }
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error("Could not merge geometries");
  return merged;
}

/* ------------------------------------------------------------- Primitives */

/** Crisp box with a hairline bevel: reads as architecture, not toy. */
const block = cached("block", () => new RoundedBoxGeometry(1, 1, 1, 1, 0.012).translate(0, 0.5, 0));
const box = cached("box", () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
const cylinder = (top = 0.5, bottom = 0.5, seg = 24) =>
  cached(`cyl:${top}:${bottom}:${seg}`, () => new THREE.CylinderGeometry(top, bottom, 1, seg).translate(0, 0.5, 0));
const cone = (seg = 24) => cached(`cone:${seg}`, () => new THREE.ConeGeometry(0.5, 1, seg).translate(0, 0.5, 0));
const pyramid = cached("pyramid", () => new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0));
const dome = cached("dome", () => new THREE.SphereGeometry(0.5, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1));

/** Square frustum narrowing to a point: the "shard". */
const shard = cached("shard", () =>
  new THREE.CylinderGeometry(Math.SQRT1_2 * 0.08, Math.SQRT1_2, 1, 4, 6).rotateY(Math.PI / 4).translate(0, 0.5, 0),
);

/** A rounded, tapering tower profile. */
const rounded = cached("rounded", () => {
  const pts: THREE.Vector2[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = 0.5 * Math.pow(Math.sin(Math.PI * (0.18 + 0.78 * t)), 0.55) * (1 - 0.15 * t);
    pts.push(new THREE.Vector2(Math.max(0.02, r), t));
  }
  return new THREE.LatheGeometry(pts, 28);
});

/** Pitched (gable) roof with its ridge along x. */
const gable = cached("gable", () => {
  const shape = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5).rotateY(Math.PI / 2);
});

/** Mansard: steep sides and a flat top, all round. */
const mansard = cached("mansard", () =>
  new THREE.CylinderGeometry(Math.SQRT1_2 * 0.72, Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
);

const barrel = cached("barrel", () => {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI;
    pts.push(new THREE.Vector2(Math.cos(t) * 0.5, Math.sin(t)));
  }
  return new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 1, bevelEnabled: false, curveSegments: 16 })
    .translate(0, 0, -0.5)
    .rotateY(Math.PI / 2);
});

const sawtooth = cached("sawtooth", () => {
  const teeth: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const x0 = -0.5 + i / 3;
    const shape = new THREE.Shape([new THREE.Vector2(x0, 0), new THREE.Vector2(x0 + 1 / 3, 0), new THREE.Vector2(x0 + 1 / 3, 1)]);
    teeth.push(new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5));
  }
  return merge(teeth);
});

/** Stepped art-deco crown finishing in a needle. */
const decoCrown = cached("decoCrown", () =>
  merge([
    new THREE.BoxGeometry(0.86, 0.34, 0.86).translate(0, 0.17, 0),
    new THREE.BoxGeometry(0.62, 0.26, 0.62).translate(0, 0.47, 0),
    new THREE.BoxGeometry(0.38, 0.18, 0.38).translate(0, 0.69, 0),
    new THREE.ConeGeometry(0.1, 0.22, 8).translate(0, 0.89, 0),
  ]),
);

/** Gothic crown: a tall central spire with four corner pinnacles. */
const gothicCrown = cached("gothicCrown", () => {
  const p = (x: number, z: number, r: number, h: number) =>
    new THREE.ConeGeometry(r, h, 4).rotateY(Math.PI / 4).translate(x, h / 2, z);
  return merge([
    new THREE.BoxGeometry(0.9, 0.18, 0.9).translate(0, 0.09, 0),
    p(0, 0, 0.42, 1).translate(0, 0.1, 0).scale(1, 0.92, 1),
    p(0.36, 0.36, 0.09, 0.55).translate(0, 0.16, 0),
    p(-0.36, 0.36, 0.09, 0.55).translate(0, 0.16, 0),
    p(0.36, -0.36, 0.09, 0.55).translate(0, 0.16, 0),
    p(-0.36, -0.36, 0.09, 0.55).translate(0, 0.16, 0),
  ]);
});

const colonnade = cached("colonnade", () =>
  merge(Array.from({ length: 6 }, (_, i) => new THREE.CylinderGeometry(0.04, 0.045, 1, 10).translate(-0.42 + i * (0.84 / 5), 0.5, 0))),
);

const clockFaces = cached("clockfaces", () => {
  const disc = () => new THREE.CylinderGeometry(0.3, 0.3, 0.05, 24);
  return merge([
    disc().rotateX(Math.PI / 2).translate(0, 0.5, 0.5),
    disc().rotateX(Math.PI / 2).translate(0, 0.5, -0.5),
    disc().rotateZ(Math.PI / 2).translate(0.5, 0.5, 0),
    disc().rotateZ(Math.PI / 2).translate(-0.5, 0.5, 0),
  ]);
});

const legs = cached("legs", () =>
  merge(
    [
      [0.3, 0.3],
      [-0.3, 0.3],
      [0.3, -0.3],
      [-0.3, -0.3],
    ].map(([x, z]) => new THREE.CylinderGeometry(0.035, 0.045, 1, 6).translate(x, 0.5, z)),
  ),
);

const obelisk = cached("obelisk", () => new THREE.CylinderGeometry(0.3, 0.5, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0));

/* ---------------------------------------------------------------- Kits */

/**
 * - masonry: punched windows in a solid wall (stone, brick)
 * - curtain / curtainRound: glass curtain wall, flat or wrapped round a curve
 * - clay: plain matte surfaces (roofs, plinths)
 * - metal: satin metal (crowns, spires, mechanical rooms)
 * - glass: glossy glass without a window grid (domes)
 * - accent: the language band, self-lit so it reads by day and glows by night
 * - glow: lamps and beacons
 */
export type MaterialKind = "masonry" | "curtain" | "curtainRound" | "clay" | "metal" | "glass" | "accent" | "glow";

export type ColorRole = "body" | "roof" | "trim" | "metal" | "language" | "stone" | "brick" | "lamp" | "patina" | "gold" | "red";

export interface Dims {
  w: number;
  d: number;
  h: number;
  v: number;
}

/** [sx, sy, sz, ox, oy, oz] */
export type Placement = [number, number, number, number, number, number];

export interface PartDef {
  key: string;
  geometry: () => THREE.BufferGeometry;
  material: MaterialKind;
  color: ColorRole;
  place: (d: Dims) => Placement;
  shadow?: boolean;
}

export interface StyleDef {
  parts: PartDef[];
}

const P = (
  key: string,
  geometry: () => THREE.BufferGeometry,
  material: MaterialKind,
  color: ColorRole,
  place: (d: Dims) => Placement,
  shadow = material !== "accent" && material !== "glow",
): PartDef => ({ key, geometry, material, color, place, shadow });

const m = (d: Dims) => Math.min(d.w, d.d);
const BAND = 0.07;

/** The thin language band every building wears near its top. */
const band = (key: string, at: (d: Dims) => number, scale = 1.02, offX = 0, offZ = 0): PartDef =>
  P(key, box, "accent", "language", (d) => [d.w * scale, BAND, d.d * scale, offX * d.w, at(d), offZ * d.d]);

/* Towers ------------------------------------------------------------------ */

const setbackTower: StyleDef = {
  parts: [
    P("t1", block, "masonry", "body", (d) => [d.w, d.h * 0.58, d.d, 0, 0, 0]),
    P("t2", block, "masonry", "body", (d) => [d.w * 0.8, d.h * 0.24, d.d * 0.8, 0, d.h * 0.58, 0]),
    P("t3", block, "masonry", "body", (d) => [d.w * 0.58, d.h * 0.12, d.d * 0.58, 0, d.h * 0.82, 0]),
    band("band", (d) => d.h * 0.82, 0.6),
    P("cap", pyramid, "metal", "metal", (d) => [d.w * 0.5, d.h * 0.06, d.d * 0.5, 0, d.h * 0.94, 0]),
  ],
};

const curtainOnPodium: StyleDef = {
  parts: [
    P("podium", block, "masonry", "trim", (d) => [d.w, d.h * 0.12, d.d, 0, 0, 0]),
    P("shaft", block, "curtain", "body", (d) => [d.w * 0.86, d.h * 0.84, d.d * 0.86, 0, d.h * 0.12, 0]),
    band("band", (d) => d.h * 0.96 - BAND, 0.88),
    P("mech", block, "metal", "metal", (d) => [d.w * 0.42, d.h * 0.04, d.d * 0.36, 0, d.h * 0.96, 0]),
  ],
};

const decoSpire: StyleDef = {
  parts: [
    P("shaft", block, "masonry", "body", (d) => [d.w * 0.92, d.h * 0.76, d.d * 0.92, 0, 0, 0]),
    band("band", (d) => d.h * 0.76 - BAND, 0.94),
    P("crown", decoCrown, "masonry", "body", (d) => [d.w * 0.86, d.h * 0.24, d.d * 0.86, 0, d.h * 0.76, 0]),
  ],
};

const stonePalazzo: StyleDef = {
  // A mid-rise stone block with a mansard roof.
  parts: [
    P("body", block, "masonry", "body", (d) => [d.w, d.h - Math.min(d.h * 0.3, m(d) * 0.42), d.d, 0, 0, 0]),
    band("band", (d) => d.h - Math.min(d.h * 0.3, m(d) * 0.42) - BAND),
    P("roof", mansard, "clay", "roof", (d) => [d.w, Math.min(d.h * 0.3, m(d) * 0.42), d.d, 0, d.h - Math.min(d.h * 0.3, m(d) * 0.42), 0]),
  ],
};

const brickGable: StyleDef = {
  parts: [
    P("body", block, "masonry", "body", (d) => [d.w, Math.max(0.3, d.h - m(d) * 0.5), d.d, 0, 0, 0]),
    band("band", (d) => Math.max(0.3, d.h - m(d) * 0.5) - BAND),
    P("roof", gable, "clay", "roof", (d) => [d.w * 1.04, m(d) * 0.5, d.d * 1.02, 0, Math.max(0.3, d.h - m(d) * 0.5), 0]),
    P("chimney", box, "clay", "brick", (d) => [0.1, m(d) * 0.4, 0.1, d.w * 0.3, Math.max(0.3, d.h - m(d) * 0.5) + m(d) * 0.12, d.d * 0.18]),
  ],
};

const glassShard: StyleDef = {
  parts: [
    P("shard", shard, "curtain", "body", (d) => [d.w * 1.02, d.h, d.d * 1.02, 0, 0, 0]),
    band("band", (d) => d.h * 0.08, 1.04),
  ],
};

const roundedTower: StyleDef = {
  parts: [
    P("body", rounded, "curtainRound", "body", (d) => [d.w, d.h, d.d, 0, 0, 0]),
    band("band", () => 0.25, 0.92),
  ],
};

const glassSlab: StyleDef = {
  parts: [
    P("shaft", block, "curtain", "body", (d) => [d.w, d.h * 0.92, d.d * 0.78, 0, 0, 0]),
    band("band", (d) => d.h * 0.92 - BAND, 1.01, 0, 0),
    P("crown", gable, "metal", "metal", (d) => [d.w * 0.98, d.h * 0.08, d.d * 0.76, 0, d.h * 0.92, 0]),
  ],
};

const glassSetback: StyleDef = {
  parts: [
    P("lower", block, "curtain", "body", (d) => [d.w, d.h * 0.68, d.d, 0, 0, 0]),
    band("band", (d) => d.h * 0.68 - BAND, 1.01),
    P("upper", block, "curtain", "body", (d) => [d.w * 0.72, d.h * 0.28, d.d * 0.72, d.w * 0.1, d.h * 0.68, -d.d * 0.06]),
    P("mast", cylinder(0.5, 0.5, 6), "metal", "metal", (d) => [0.05, d.h * 0.1 + 0.4, 0.05, d.w * 0.1, d.h * 0.96, -d.d * 0.06]),
  ],
};

const glassCylinder: StyleDef = {
  parts: [
    P("body", cylinder(0.5, 0.5, 28), "curtainRound", "body", (d) => [d.w, d.h * 0.96, d.d, 0, 0, 0]),
    band("band", (d) => d.h * 0.96 - BAND, 0.98),
    P("cap", cylinder(0.5, 0.5, 28), "metal", "metal", (d) => [d.w * 0.9, d.h * 0.04, d.d * 0.9, 0, d.h * 0.96, 0]),
  ],
};

const gothicTower: StyleDef = {
  parts: [
    P("shaft", block, "masonry", "body", (d) => [d.w, d.h * 0.78, d.d, 0, 0, 0]),
    band("band", (d) => d.h * 0.78 - BAND),
    P("crown", gothicCrown, "masonry", "roof", (d) => [d.w * 0.96, d.h * 0.22, d.d * 0.96, 0, d.h * 0.78, 0]),
  ],
};

const steppedMass: StyleDef = {
  parts: [
    P("t1", block, "masonry", "body", (d) => [d.w, d.h * 0.5, d.d, 0, 0, 0]),
    P("t2", block, "masonry", "body", (d) => [d.w * 0.82, d.h * 0.28, d.d * 0.82, 0, d.h * 0.5, 0]),
    P("t3", block, "masonry", "body", (d) => [d.w * 0.6, d.h * 0.14, d.d * 0.6, 0, d.h * 0.78, 0]),
    band("band", (d) => d.h * 0.78 - BAND, 0.84),
    P("spire", cone(8), "metal", "metal", (d) => [0.14, d.h * 0.1, 0.14, 0, d.h * 0.92, 0]),
  ],
};

/* Low-rise ---------------------------------------------------------------- */

const brownstone: StyleDef = {
  parts: [
    P("body", block, "masonry", "body", (d) => [d.w, d.h - 0.08, d.d, 0, 0, 0]),
    band("band", (d) => d.h - 0.08 - BAND),
    P("cornice", block, "clay", "trim", (d) => [d.w * 1.06, 0.08, d.d * 1.06, 0, d.h - 0.08, 0]),
  ],
};

const modernTownhouse: StyleDef = {
  parts: [
    P("body", block, "masonry", "body", (d) => [d.w, d.h * 0.7, d.d, 0, 0, 0]),
    band("band", (d) => d.h * 0.7 - BAND),
    P("top", block, "curtain", "body", (d) => [d.w * 0.9, d.h * 0.3, d.d * 0.9, 0, d.h * 0.7, 0]),
  ],
};

const steepGothic: StyleDef = {
  parts: [
    P("body", block, "masonry", "body", (d) => [d.w, Math.max(0.3, d.h - m(d) * 0.8), d.d, 0, 0, 0]),
    band("band", (d) => Math.max(0.3, d.h - m(d) * 0.8) - BAND),
    P("roof", gable, "clay", "roof", (d) => [d.w * 1.04, m(d) * 0.8, d.d * 1.02, 0, Math.max(0.3, d.h - m(d) * 0.8), 0]),
  ],
};

const atriumLab: StyleDef = {
  parts: [
    P("body", block, "masonry", "body", (d) => [d.w, Math.max(0.3, d.h - m(d) * 0.3), d.d, 0, 0, 0]),
    band("band", (d) => Math.max(0.3, d.h - m(d) * 0.3) - BAND),
    P("dome", dome, "glass", "trim", (d) => [m(d) * 0.66, m(d) * 0.3, m(d) * 0.66, 0, Math.max(0.3, d.h - m(d) * 0.3), 0]),
  ],
};

const waterTower: StyleDef = {
  parts: [
    P("plinth", block, "masonry", "body", (d) => [d.w, d.h * 0.45, d.d, 0, 0, 0]),
    band("band", (d) => d.h * 0.45 - BAND),
    P("legs", legs, "metal", "metal", (d) => [d.w * 0.7, d.h * 0.18, d.d * 0.7, 0, d.h * 0.45, 0]),
    P("tank", cylinder(0.5, 0.5, 18), "clay", "roof", (d) => [d.w * 0.6, d.h * 0.24, d.d * 0.6, 0, d.h * 0.63, 0]),
    P("hat", cone(18), "clay", "roof", (d) => [d.w * 0.66, d.h * 0.13, d.d * 0.66, 0, d.h * 0.87, 0]),
  ],
};

const workshop: StyleDef = {
  parts: [
    P("body", block, "masonry", "body", (d) => [d.w, d.h - 0.28, d.d, 0, 0, 0]),
    band("band", (d) => d.h - 0.28 - BAND),
    P("saw", sawtooth, "clay", "roof", (d) => [d.w, 0.28, d.d, 0, d.h - 0.28, 0]),
    P("chimney", cylinder(0.42, 0.5, 10), "clay", "brick", (d) => [0.16, d.h * 0.5 + 0.4, 0.16, d.w * 0.3, d.h - 0.28, d.d * 0.22]),
  ],
};

const glassPavilion: StyleDef = {
  parts: [
    P("body", block, "curtain", "body", (d) => [d.w * 0.92, d.h - 0.07, d.d * 0.92, 0, 0, 0]),
    band("band", (d) => d.h - 0.07 - BAND, 0.94),
    P("canopy", block, "metal", "metal", (d) => [d.w * 1.12, 0.07, d.d * 1.12, 0, d.h - 0.07, 0]),
  ],
};

const depot: StyleDef = {
  parts: [
    P("body", block, "masonry", "body", (d) => [d.w, d.h - d.d * 0.3, d.d, 0, 0, 0]),
    band("band", (d) => d.h - d.d * 0.3 - BAND),
    P("roof", barrel, "metal", "metal", (d) => [d.w * 1.01, d.d * 0.3, d.d * 1.01, 0, d.h - d.d * 0.3, 0]),
  ],
};

const storeroom: StyleDef = {
  parts: [
    P("body", block, "masonry", "body", (d) => [d.w, d.h, d.d, 0, 0, 0]),
    band("band", (d) => d.h - BAND),
  ],
};

const booth: StyleDef = {
  parts: [
    P("body", block, "masonry", "body", (d) => [d.w * 0.86, d.h - 0.07, d.d * 0.86, 0, 0, 0]),
    band("band", (d) => d.h - 0.07 - BAND, 0.88),
    P("canopy", block, "metal", "metal", (d) => [d.w * 1.1, 0.07, d.d * 1.1, 0, d.h - 0.07, 0]),
  ],
};

const masonryBlock: StyleDef = {
  parts: [
    P("l1", block, "masonry", "body", (d) => [d.w, d.h * 0.5, d.d, 0, 0, 0]),
    P("l2", block, "masonry", "body", (d) => [d.w * 0.8, d.h * 0.32, d.d * 0.8, 0, d.h * 0.5, 0]),
    band("band", (d) => d.h * 0.82 - BAND, 0.82),
    P("l3", block, "masonry", "body", (d) => [d.w * 0.56, d.h * 0.18, d.d * 0.56, 0, d.h * 0.82, 0]),
  ],
};

const glassBlock: StyleDef = {
  parts: [
    P("l1", block, "curtain", "body", (d) => [d.w, d.h * 0.55, d.d, 0, 0, 0]),
    P("l2", block, "curtain", "body", (d) => [d.w * 0.78, d.h * 0.45, d.d * 0.78, d.w * 0.06, d.h * 0.55, 0]),
    band("band", (d) => d.h * 0.55 - BAND, 1.01),
  ],
};

/* Landmarks --------------------------------------------------------------- */

const townhall: StyleDef = {
  parts: [
    P("podium", block, "clay", "stone", (d) => [d.w, 0.22, d.d, 0, 0, 0]),
    P("hall", box, "masonry", "stone", (d) => [d.w * 0.84, d.h * 0.42, d.d * 0.62, 0, 0.22, -d.d * 0.06]),
    P("columns", colonnade, "clay", "stone", (d) => [d.w * 0.84, d.h * 0.42, 1, 0, 0.22, d.d * 0.32]),
    P("roof", block, "clay", "stone", (d) => [d.w * 0.92, 0.12, d.d * 0.82, 0, 0.22 + d.h * 0.42, 0.02]),
    band("band", (d) => 0.34 + d.h * 0.42, 0.44),
    P("drum", cylinder(0.5, 0.5, 24), "clay", "stone", (d) => [m(d) * 0.42, d.h * 0.14, m(d) * 0.42, 0, 0.34 + d.h * 0.42, -d.d * 0.04]),
    P("dome", dome, "metal", "patina", (d) => [m(d) * 0.46, m(d) * 0.26, m(d) * 0.46, 0, 0.34 + d.h * 0.56, -d.d * 0.04]),
  ],
};

const clocktower: StyleDef = {
  parts: [
    P("base", block, "clay", "stone", (d) => [d.w, d.h * 0.16, d.d, 0, 0, 0]),
    P("shaft", box, "masonry", "body", (d) => [d.w * 0.76, d.h * 0.62, d.d * 0.76, 0, d.h * 0.16, 0]),
    P("faces", clockFaces, "glow", "lamp", (d) => [d.w * 0.78, d.w * 0.78, d.d * 0.78, 0, d.h * 0.6, 0], false),
    band("band", (d) => d.h * 0.78 - BAND, 0.8),
    P("cornice", block, "clay", "stone", (d) => [d.w * 0.9, 0.1, d.d * 0.9, 0, d.h * 0.78, 0]),
    P("roof", pyramid, "metal", "metal", (d) => [d.w * 0.86, d.h * 0.22, d.d * 0.86, 0, d.h * 0.78 + 0.1, 0]),
  ],
};

/** Entry points: a slender beacon tower with a lit lantern. */
const beacon: StyleDef = {
  parts: [
    P("base", block, "clay", "stone", (d) => [d.w * 1.05, 0.2, d.d * 1.05, 0, 0, 0]),
    P("shaft", cylinder(0.36, 0.5, 20), "masonry", "body", (d) => [d.w * 0.8, d.h * 0.7, d.d * 0.8, 0, 0.2, 0]),
    band("band", (d) => 0.2 + d.h * 0.7 - BAND, 0.62),
    P("gallery", cylinder(0.5, 0.5, 20), "metal", "metal", (d) => [d.w * 0.8, 0.06, d.d * 0.8, 0, 0.2 + d.h * 0.7, 0]),
    P("lantern", cylinder(0.5, 0.5, 16), "glow", "lamp", (d) => [d.w * 0.42, d.h * 0.1, d.d * 0.42, 0, 0.26 + d.h * 0.7, 0], false),
    P("spire", cone(16), "metal", "metal", (d) => [d.w * 0.5, d.h * 0.18, d.d * 0.5, 0, 0.26 + d.h * 0.8, 0]),
  ],
};

const monument: StyleDef = {
  parts: [
    P("pedestal", block, "clay", "stone", (d) => [d.w, 0.24, d.d, 0, 0, 0]),
    P("obelisk", obelisk, "clay", "stone", (d) => [d.w * 0.5, d.h * 0.72, d.d * 0.5, 0, 0.24, 0]),
    band("band", () => 0.24, 0.6),
    P("tip", pyramid, "metal", "gold", (d) => [d.w * 0.3, d.h * 0.12, d.d * 0.3, 0, 0.24 + d.h * 0.72, 0]),
  ],
};

type Kit = Record<Archetype, StyleDef[]>;

const BASE_KIT: Kit = {
  tower: [setbackTower, curtainOnPodium, decoSpire],
  lab: [atriumLab],
  silo: [waterTower],
  factory: [workshop],
  house: [brownstone],
  pavilion: [glassPavilion],
  warehouse: [depot],
  crates: [storeroom],
  kiosk: [booth],
  block: [masonryBlock],
  townhall: [townhall],
  clocktower: [clocktower],
  lighthouse: [beacon],
  monument: [monument],
};

const KITS: Record<CityStyleId, Kit> = {
  financial: BASE_KIT,
  thames: {
    ...BASE_KIT,
    // Variants 0-1 are the historic fabric; 2-3 are reserved for the tallest buildings.
    tower: [stonePalazzo, brickGable, glassShard, roundedTower],
    house: [brickGable, stonePalazzo],
    block: [masonryBlock],
  },
  waterfront: {
    ...BASE_KIT,
    tower: [glassSlab, glassSetback, glassCylinder],
    house: [modernTownhouse],
    block: [glassBlock],
    lab: [glassPavilion],
  },
  noir: {
    ...BASE_KIT,
    tower: [gothicTower, steppedMass, decoSpire],
    house: [steepGothic, brownstone],
    block: [masonryBlock],
  },
};

/** Thames keeps its skyline low: only the tallest buildings get glass landmarks. */
const THAMES_LANDMARK_HEIGHT = 6.5;

export function kitFor(style: CityStyleId, archetype: Archetype): StyleDef[] {
  return KITS[style][archetype];
}

/** Which variant of the kit a building wears: stable per building, and height-aware in Thames. */
export function variantIndexFor(style: CityStyleId, b: Pick<BuildingLayout, "archetype" | "variant" | "height">): number {
  const kit = kitFor(style, b.archetype);
  if (style === "thames" && b.archetype === "tower") {
    return b.height > THAMES_LANDMARK_HEIGHT ? 2 + Math.floor(b.variant * 2) : Math.floor(b.variant * 2);
  }
  return Math.min(kit.length - 1, Math.floor(b.variant * kit.length));
}

/** Colours for non-semantic parts that don't vary by style. */
export const FIXED_ROLE_COLORS: Partial<Record<ColorRole, string>> = {
  brick: "#8f4f3c",
  lamp: "#ffe7b0",
  patina: "#6fa596",
  gold: "#c9a45a",
  red: "#e0564c",
};

