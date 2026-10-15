/**
 * The opening view of a city: a low, oblique three-quarter aerial shot that
 * looks diagonally across the whole island from one corner.
 *
 * Framing is exact rather than a rule of thumb. With the camera's orientation
 * fixed, "every point is inside the frustum" is a set of linear constraints on
 * the camera's position (in its own right/up/forward axes), so the closest
 * position that still shows everything has a closed form. That frames a
 * five-building repository and a ten-thousand-building one equally well, on
 * a wide monitor or a portrait phone.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface GroundRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface AerialInput {
  /** The ground that must be in frame (the island). */
  ground: GroundRect;
  /** Extra points that must be in frame, such as the tops of buildings. */
  points?: Point3[];
  /** Vertical field of view, in degrees. */
  fov: number;
  /** Width over height of the viewport. */
  aspect: number;
  /** Azimuth in three.js spherical terms (0 looks from +Z, π/2 from +X). Defaults to a corner of the ground. */
  azimuth?: number;
  /** Angle of the line of sight below the horizon, in radians. */
  elevation?: number;
  /**
   * Parts of the frame to keep clear, as fractions of the half-frame (0–1): HUD bars, side
   * panels, edges. `x` sets both sides; `left` and `right` override it.
   */
  margin?: { x?: number; left?: number; right?: number; top?: number; bottom?: number };
  /**
   * Where spare vertical room goes when the frame is width-bound (portrait
   * screens): 0 puts the city at the top, 1 at the bottom. The default leans
   * low, so the sea and sky fill the space above it.
   */
  verticalBias?: number;
}

export interface AerialView {
  position: Point3;
  /** Where the line of sight meets the ground; the orbit pivot. */
  target: Point3;
  azimuth: number;
  elevation: number;
  distance: number;
}

/** About 22°: low enough that tower heights read against each other, high enough to see into the streets. */
export const OPENING_ELEVATION = 0.38;

/** A corner-on azimuth, turned a little off the exact diagonal so the shot isn't symmetric. */
export function cornerAzimuth(ground: GroundRect): number {
  const width = ground.maxX - ground.minX;
  const depth = ground.maxZ - ground.minZ;
  return Math.atan2(width, depth) * 0.78;
}

export function aerialView(input: AerialInput): AerialView {
  const { ground, fov, aspect } = input;
  const azimuth = input.azimuth ?? cornerAzimuth(ground);
  const elevation = input.elevation ?? OPENING_ELEVATION;
  const ml = input.margin?.left ?? input.margin?.x ?? 0.06;
  const mr = input.margin?.right ?? input.margin?.x ?? 0.06;
  const mt = input.margin?.top ?? 0.12;
  const mb = input.margin?.bottom ?? 0.12;
  const bias = input.verticalBias ?? 0.62;

  // Camera axes for this azimuth and elevation (three.js: the camera looks down -Z, Y up).
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);
  const st = Math.sin(azimuth);
  const ct = Math.cos(azimuth);
  const f = { x: -ce * st, y: -se, z: -ce * ct }; // forward
  const r = { x: ct, y: 0, z: -st }; // right = forward × up, normalised
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x }; // up = right × forward

  const tanV = Math.tan((fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const al = (1 - ml) * tanH;
  const ar = (1 - mr) * tanH;
  const at = (1 - mt) * tanV;
  const ab = (1 - mb) * tanV;

  // Each point p in camera axes is (p·r − ox, p·u − oy, p·f − oz) for a camera at ox·r + oy·u + oz·f.
  // In frame: −al·z ≤ x ≤ ar·z and −ab·z ≤ y ≤ at·z. Collect the binding terms.
  let l1 = -Infinity;
  let l2 = -Infinity;
  let m1 = -Infinity;
  let m2 = -Infinity;
  const take = (px: number, py: number, pz: number) => {
    const xi = px * r.x + py * r.y + pz * r.z;
    const yi = px * u.x + py * u.y + pz * u.z;
    const zi = px * f.x + py * f.y + pz * f.z;
    l1 = Math.max(l1, xi - ar * zi);
    l2 = Math.max(l2, -xi - al * zi);
    m1 = Math.max(m1, yi - at * zi);
    m2 = Math.max(m2, -yi - ab * zi);
  };
  take(ground.minX, 0, ground.minZ);
  take(ground.maxX, 0, ground.minZ);
  take(ground.minX, 0, ground.maxZ);
  take(ground.maxX, 0, ground.maxZ);
  for (const p of input.points ?? []) take(p.x, p.y, p.z);

  // The furthest forward the camera can sit, for each pair of frame edges.
  const oz = Math.min(-(l1 + l2) / (al + ar), -(m1 + m2) / (at + ab));
  // Centre horizontally in whatever room is left; place vertically by the bias.
  const oxLo = l1 + ar * oz;
  const oxHi = -l2 - al * oz;
  const oyLo = m1 + at * oz;
  const oyHi = -m2 - ab * oz;
  const ox = (oxLo + oxHi) / 2;
  const oy = oyLo + (oyHi - oyLo) * bias;

  const position = {
    x: ox * r.x + oy * u.x + oz * f.x,
    y: ox * r.y + oy * u.y + oz * f.y,
    z: ox * r.z + oy * u.z + oz * f.z,
  };
  // The orbit pivot is where the line of sight meets the ground.
  const distance = position.y / se;
  const target = { x: position.x + f.x * distance, y: 0, z: position.z + f.z * distance };
  return { position, target, azimuth, elevation, distance };
}

/** Normalised device coordinates of a point seen from a view; used by tests and debugging. */
export function projectToView(view: AerialView, fov: number, aspect: number, p: Point3): { x: number; y: number; depth: number } {
  const ce = Math.cos(view.elevation);
  const se = Math.sin(view.elevation);
  const st = Math.sin(view.azimuth);
  const ct = Math.cos(view.azimuth);
  const f = { x: -ce * st, y: -se, z: -ce * ct };
  const r = { x: ct, y: 0, z: -st };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const d = { x: p.x - view.position.x, y: p.y - view.position.y, z: p.z - view.position.z };
  const depth = d.x * f.x + d.y * f.y + d.z * f.z;
  const tanV = Math.tan((fov * Math.PI) / 360);
  return {
    x: (d.x * r.x + d.y * r.y + d.z * r.z) / (depth * tanV * aspect),
    y: (d.x * u.x + d.y * u.y + d.z * u.z) / (depth * tanV),
    depth,
  };
}
