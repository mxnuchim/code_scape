import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Archetype } from "@/lib/layout/archetypes";

/*
 * Unit geometries: base at y = 0, footprint centred on the origin, height 1.
 * Parts are scaled per building by their `place` function, so one geometry
 * serves every instance of a part.
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
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute("position").count) * 2), 2));
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

const roundedBox = (r = 0.06) =>
  cached(`rbox:${r}`, () => new RoundedBoxGeometry(1, 1, 1, 2, r).translate(0, 0.5, 0));
const box = cached("box", () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
const cylinder = (top = 0.5, bottom = 0.5, seg = 24) =>
  cached(`cyl:${top}:${bottom}:${seg}`, () => new THREE.CylinderGeometry(top, bottom, 1, seg).translate(0, 0.5, 0));
const cone = (seg = 24) => cached(`cone:${seg}`, () => new THREE.ConeGeometry(0.5, 1, seg).translate(0, 0.5, 0));
const pyramid = cached("pyramid", () =>
  new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
);
const dome = cached("dome", () =>
  new THREE.SphereGeometry(0.5, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1),
);
const sphere = cached("sphere", () => new THREE.SphereGeometry(0.5, 16, 12).translate(0, 0.5, 0));

/** Triangular prism: gable roof with its ridge along x. */
const prism = cached("prism", () => {
  const shape = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
    .translate(0, 0, -0.5)
    .rotateY(Math.PI / 2);
});

/** Half cylinder: barrel roof with its axis along x. */
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

/** Three sawtooth roof teeth along x. */
const sawtooth = cached("sawtooth", () => {
  const teeth: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const x0 = -0.5 + i / 3;
    const shape = new THREE.Shape([
      new THREE.Vector2(x0, 0),
      new THREE.Vector2(x0 + 1 / 3, 0),
      new THREE.Vector2(x0 + 1 / 3, 1),
    ]);
    teeth.push(new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5));
  }
  return merge(teeth);
});

/** A colonnade: five columns along x, at z = 0. */
const colonnade = cached("colonnade", () => {
  const cols: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    cols.push(new THREE.CylinderGeometry(0.045, 0.05, 1, 10).translate(-0.4 + i * 0.2, 0.5, 0));
  }
  return merge(cols);
});

/** Four clock faces on the sides of a unit box. */
const clockFaces = cached("clockfaces", () => {
  const faces: THREE.BufferGeometry[] = [];
  const disc = () => new THREE.CylinderGeometry(0.3, 0.3, 0.05, 24);
  faces.push(disc().rotateX(Math.PI / 2).translate(0, 0.5, 0.5));
  faces.push(disc().rotateX(Math.PI / 2).translate(0, 0.5, -0.5));
  faces.push(disc().rotateZ(Math.PI / 2).translate(0.5, 0.5, 0));
  faces.push(disc().rotateZ(Math.PI / 2).translate(-0.5, 0.5, 0));
  return merge(faces);
});

const LH_TOP = 0.34;
const lighthouseTaper = (f: number) => 0.5 - (0.5 - LH_TOP) * f;
const lighthouseBody = cylinder(LH_TOP, 0.5, 28);
const lighthouseStripes = cached("lhstripes", () => {
  const rings: THREE.BufferGeometry[] = [];
  for (const f of [0.12, 0.44, 0.76]) {
    const h = 0.14;
    rings.push(
      new THREE.CylinderGeometry(lighthouseTaper(f + h) + 0.012, lighthouseTaper(f) + 0.012, h, 28, 1, true).translate(0, f + h / 2, 0),
    );
  }
  return merge(rings);
});

const obelisk = cached("obelisk", () =>
  new THREE.CylinderGeometry(0.3, 0.5, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
);

/** Flag on a pole: thin box offset to the side, along +x. */
const flag = cached("flag", () => new THREE.BoxGeometry(1, 0.6, 0.06).translate(0.5, 0.7, 0));

export type MaterialKind = "clay" | "windows" | "glass" | "glow";
export type ColorRole = "body" | "roof" | "stone" | "trim" | "brick" | "wood" | "glass" | "lamp" | "slate" | "patina" | "gold" | "red" | "accent";

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
  shadow = true,
): PartDef => ({ key, geometry, material, color, place, shadow });

const minWD = (d: Dims) => Math.min(d.w, d.d);

const TOWER_CAP = 0.12;

export const STYLES: Record<Archetype, StyleDef[]> = {
  tower: [
    {
      parts: [
        P("body", roundedBox(0.05), "windows", "body", (d) => [d.w, d.h - TOWER_CAP, d.d, 0, 0, 0]),
        P("cap", roundedBox(0.04), "clay", "roof", (d) => [d.w * 1.06, TOWER_CAP, d.d * 1.06, 0, d.h - TOWER_CAP, 0]),
        P("ac", roundedBox(0.03), "clay", "trim", (d) => [d.w * 0.34, 0.2, d.d * 0.28, d.w * 0.16, d.h, -d.d * 0.16]),
      ],
    },
    {
      parts: [
        P("body", roundedBox(0.05), "windows", "body", (d) => [d.w, d.h * 0.8, d.d, 0, 0, 0]),
        P("step", roundedBox(0.05), "windows", "body", (d) => [d.w * 0.76, d.h * 0.13, d.d * 0.76, 0, d.h * 0.8, 0]),
        P("crown", roundedBox(0.04), "clay", "roof", (d) => [d.w * 0.5, d.h * 0.07, d.d * 0.5, 0, d.h * 0.93, 0]),
      ],
    },
    {
      parts: [
        P("body", roundedBox(0.05), "windows", "body", (d) => [d.w, d.h - 0.1, d.d, 0, 0, 0]),
        P("cap", roundedBox(0.04), "clay", "roof", (d) => [d.w * 1.05, 0.1, d.d * 1.05, 0, d.h - 0.1, 0]),
        P("antenna", cylinder(0.5, 0.5, 8), "clay", "trim", (d) => [0.06, 0.35 + d.h * 0.12, 0.06, 0, d.h, 0]),
        P("beacon", sphere, "glow", "red", (d) => [0.11, 0.11, 0.11, 0, d.h + 0.33 + d.h * 0.12, 0], false),
      ],
    },
  ],
  lab: [
    {
      parts: [
        P("body", cylinder(0.5, 0.5, 28), "clay", "body", (d) => [d.w, Math.max(0.25, d.h - minWD(d) * 0.42), d.d, 0, 0, 0]),
        P("ring", cylinder(0.5, 0.5, 28), "clay", "trim", (d) => [d.w * 1.06, 0.07, d.d * 1.06, 0, Math.max(0.25, d.h - minWD(d) * 0.42) - 0.035, 0]),
        P("dome", dome, "glass", "glass", (d) => [d.w * 0.96, minWD(d) * 0.42, d.d * 0.96, 0, Math.max(0.25, d.h - minWD(d) * 0.42), 0]),
      ],
    },
  ],
  silo: [
    {
      parts: [
        P("body", cylinder(0.5, 0.5, 24), "clay", "body", (d) => [d.w, d.h - d.w * 0.5, d.d, 0, 0, 0]),
        P("band", cylinder(0.5, 0.5, 24), "clay", "trim", (d) => [d.w * 1.04, 0.06, d.d * 1.04, 0, (d.h - d.w * 0.5) * 0.4, 0]),
        P("roof", cone(24), "clay", "roof", (d) => [d.w * 1.08, d.w * 0.5, d.d * 1.08, 0, d.h - d.w * 0.5, 0]),
      ],
    },
    {
      // Water tower: tank on legs.
      parts: [
        P("legs", cylinder(0.32, 0.5, 6), "clay", "trim", (d) => [d.w * 0.7, d.h * 0.42, d.d * 0.7, 0, 0, 0]),
        P("tank", cylinder(0.5, 0.5, 24), "clay", "body", (d) => [d.w, d.h * 0.38, d.d, 0, d.h * 0.42, 0]),
        P("roof", cone(24), "clay", "roof", (d) => [d.w * 1.06, d.h * 0.2, d.d * 1.06, 0, d.h * 0.8, 0]),
      ],
    },
  ],
  factory: [
    {
      parts: [
        P("body", roundedBox(0.04), "windows", "body", (d) => [d.w, d.h - 0.3, d.d, 0, 0, 0]),
        P("saw", sawtooth, "clay", "roof", (d) => [d.w, 0.3, d.d, 0, d.h - 0.3, 0]),
        P("chimney", cylinder(0.42, 0.5, 12), "clay", "brick", (d) => [0.2, d.h * 0.55 + 0.4, 0.2, d.w * 0.3, d.h - 0.3, d.d * 0.22]),
      ],
    },
  ],
  house: [
    {
      parts: [
        P("body", box, "windows", "body", (d) => [d.w, Math.max(0.3, d.h - minWD(d) * 0.55), d.d, 0, 0, 0]),
        P("roof", prism, "clay", "roof", (d) => [d.w * 1.12, minWD(d) * 0.55, d.d * 1.1, 0, Math.max(0.3, d.h - minWD(d) * 0.55), 0]),
        P("chimney", box, "clay", "brick", (d) => [0.12, minWD(d) * 0.45, 0.12, d.w * 0.26, Math.max(0.3, d.h - minWD(d) * 0.55) + minWD(d) * 0.18, d.d * 0.16]),
      ],
    },
    {
      parts: [
        P("body", box, "windows", "body", (d) => [d.w, Math.max(0.3, d.h - minWD(d) * 0.45), d.d, 0, 0, 0]),
        P("roof", pyramid, "clay", "roof", (d) => [d.w * 1.14, minWD(d) * 0.45, d.d * 1.14, 0, Math.max(0.3, d.h - minWD(d) * 0.45), 0]),
      ],
    },
  ],
  pavilion: [
    {
      parts: [
        P("body", roundedBox(0.05), "windows", "body", (d) => [d.w * 0.9, d.h - minWD(d) * 0.5, d.d * 0.9, 0, 0, 0]),
        P("eave", roundedBox(0.03), "clay", "trim", (d) => [d.w * 1.12, 0.06, d.d * 1.12, 0, d.h - minWD(d) * 0.5, 0]),
        P("roof", pyramid, "clay", "roof", (d) => [d.w * 1.06, minWD(d) * 0.5, d.d * 1.06, 0, d.h - minWD(d) * 0.5 + 0.06, 0]),
      ],
    },
  ],
  warehouse: [
    {
      parts: [
        P("body", roundedBox(0.04), "windows", "body", (d) => [d.w, d.h - d.d * 0.32, d.d, 0, 0, 0]),
        P("roof", barrel, "clay", "roof", (d) => [d.w * 1.02, d.d * 0.32, d.d * 1.02, 0, d.h - d.d * 0.32, 0]),
        P("door", box, "clay", "slate", (d) => [d.w * 0.32, (d.h - d.d * 0.32) * 0.62, 0.04, 0, 0, d.d * 0.5]),
      ],
    },
  ],
  crates: [
    {
      parts: [
        P("crate", roundedBox(0.08), "clay", "body", (d) => [d.w, d.h * 0.62, d.d, 0, 0, 0]),
        P("top", roundedBox(0.08), "clay", "wood", (d) => [d.w * 0.6, d.h * 0.38, d.d * 0.6, d.w * 0.12, d.h * 0.62, -d.d * 0.08]),
      ],
    },
    {
      parts: [
        P("crate", roundedBox(0.08), "clay", "body", (d) => [d.w * 0.8, d.h * 0.7, d.d * 0.8, -d.w * 0.12, 0, 0]),
        P("barrel", cylinder(0.46, 0.5, 14), "clay", "wood", (d) => [d.w * 0.42, d.h * 0.85, d.d * 0.42, d.w * 0.34, 0, d.d * 0.28]),
      ],
    },
  ],
  kiosk: [
    {
      parts: [
        P("body", roundedBox(0.05), "windows", "body", (d) => [d.w, d.h - 0.08, d.d, 0, 0, 0]),
        P("roof", roundedBox(0.03), "clay", "roof", (d) => [d.w * 1.3, 0.08, d.d * 1.3, 0, d.h - 0.08, 0]),
      ],
    },
  ],
  block: [
    {
      parts: [
        P("l1", roundedBox(0.05), "windows", "body", (d) => [d.w, d.h * 0.46, d.d, 0, 0, 0]),
        P("l2", roundedBox(0.05), "windows", "body", (d) => [d.w * 0.78, d.h * 0.32, d.d * 0.78, -d.w * 0.04, d.h * 0.46, d.d * 0.03]),
        P("l3", roundedBox(0.05), "windows", "body", (d) => [d.w * 0.52, d.h * 0.18, d.d * 0.52, d.w * 0.06, d.h * 0.78, -d.d * 0.05]),
        P("cap", roundedBox(0.04), "clay", "roof", (d) => [d.w * 0.56, 0.08, d.d * 0.56, d.w * 0.06, d.h * 0.96, -d.d * 0.05]),
      ],
    },
  ],
  townhall: [
    {
      parts: [
        P("podium", roundedBox(0.04), "clay", "stone", (d) => [d.w, 0.22, d.d, 0, 0, 0]),
        P("hall", box, "windows", "body", (d) => [d.w * 0.84, d.h * 0.42, d.d * 0.62, 0, 0.22, -d.d * 0.06]),
        P("columns", colonnade, "clay", "stone", (d) => [d.w * 0.84, d.h * 0.42, 1, 0, 0.22, d.d * 0.32]),
        P("roof", roundedBox(0.03), "clay", "stone", (d) => [d.w * 0.92, 0.12, d.d * 0.82, 0, 0.22 + d.h * 0.42, 0.02]),
        P("drum", cylinder(0.5, 0.5, 24), "clay", "stone", (d) => [minWD(d) * 0.42, d.h * 0.14, minWD(d) * 0.42, 0, 0.34 + d.h * 0.42, -d.d * 0.04]),
        P("dome", dome, "clay", "patina", (d) => [minWD(d) * 0.46, minWD(d) * 0.26, minWD(d) * 0.46, 0, 0.34 + d.h * 0.56, -d.d * 0.04]),
        P("pole", cylinder(0.5, 0.5, 6), "clay", "trim", (d) => [0.035, 0.7, 0.035, 0, 0.34 + d.h * 0.56 + minWD(d) * 0.24, -d.d * 0.04]),
        P("flag", flag, "clay", "accent", (d) => [0.32, 0.4, 1, 0, 0.34 + d.h * 0.56 + minWD(d) * 0.24 + 0.3, -d.d * 0.04]),
      ],
    },
  ],
  clocktower: [
    {
      parts: [
        P("base", roundedBox(0.04), "clay", "stone", (d) => [d.w, d.h * 0.16, d.d, 0, 0, 0]),
        P("shaft", box, "windows", "body", (d) => [d.w * 0.76, d.h * 0.62, d.d * 0.76, 0, d.h * 0.16, 0]),
        P("faces", clockFaces, "glow", "lamp", (d) => [d.w * 0.78, d.w * 0.78, d.d * 0.78, 0, d.h * 0.6, 0], false),
        P("cornice", roundedBox(0.03), "clay", "stone", (d) => [d.w * 0.9, 0.1, d.d * 0.9, 0, d.h * 0.78, 0]),
        P("roof", pyramid, "clay", "slate", (d) => [d.w * 0.86, d.h * 0.22, d.d * 0.86, 0, d.h * 0.78 + 0.1, 0]),
      ],
    },
  ],
  lighthouse: [
    {
      parts: [
        P("base", cylinder(0.5, 0.5, 28), "clay", "stone", (d) => [d.w * 1.15, 0.18, d.d * 1.15, 0, 0, 0]),
        P("tower", lighthouseBody, "clay", "stone", (d) => [d.w, d.h * 0.7, d.d, 0, 0.18, 0]),
        P("stripes", lighthouseStripes, "clay", "body", (d) => [d.w, d.h * 0.7, d.d, 0, 0.18, 0]),
        P("gallery", cylinder(0.5, 0.5, 24), "clay", "slate", (d) => [d.w * 0.86, 0.07, d.d * 0.86, 0, 0.18 + d.h * 0.7, 0]),
        P("lantern", cylinder(0.5, 0.5, 16), "glow", "lamp", (d) => [d.w * 0.48, d.h * 0.11, d.d * 0.48, 0, 0.25 + d.h * 0.7, 0], false),
        P("cap", cone(20), "clay", "red", (d) => [d.w * 0.62, d.h * 0.13, d.d * 0.62, 0, 0.25 + d.h * 0.81, 0]),
      ],
    },
  ],
  monument: [
    {
      parts: [
        P("pedestal", roundedBox(0.04), "clay", "stone", (d) => [d.w, 0.24, d.d, 0, 0, 0]),
        P("obelisk", obelisk, "clay", "body", (d) => [d.w * 0.5, d.h * 0.72, d.d * 0.5, 0, 0.24, 0]),
        P("tip", pyramid, "clay", "gold", (d) => [d.w * 0.3, d.h * 0.12, d.d * 0.3, 0, 0.24 + d.h * 0.72, 0]),
      ],
    },
  ],
};

export function styleIndexFor(archetype: Archetype, variant: number): number {
  const n = STYLES[archetype].length;
  return Math.min(n - 1, Math.floor(variant * n));
}

/** Fixed colours for non-semantic parts. */
export const FIXED_ROLE_COLORS: Partial<Record<ColorRole, string>> = {
  stone: "#efe7d8",
  trim: "#d9d3c7",
  brick: "#c06f52",
  wood: "#c9995f",
  glass: "#bfeee3",
  lamp: "#ffe7a3",
  slate: "#5c6880",
  patina: "#7fc0b0",
  gold: "#e8c36a",
  red: "#ff6a5f",
  accent: "#ff8a5c",
};
