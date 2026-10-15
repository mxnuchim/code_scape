import { describe, expect, it } from "vitest";
import { aerialView, cornerAzimuth, projectToView, type GroundRect, type Point3 } from "./aerialView";

const FOV = 30;

function ground(width: number, depth: number): GroundRect {
  return { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 };
}

function corners(g: GroundRect): Point3[] {
  return [
    { x: g.minX, y: 0, z: g.minZ },
    { x: g.maxX, y: 0, z: g.minZ },
    { x: g.minX, y: 0, z: g.maxZ },
    { x: g.maxX, y: 0, z: g.maxZ },
  ];
}

function extent(points: Point3[], view: ReturnType<typeof aerialView>, aspect: number) {
  const ndc = points.map((p) => projectToView(view, FOV, aspect, p));
  return {
    minX: Math.min(...ndc.map((p) => p.x)),
    maxX: Math.max(...ndc.map((p) => p.x)),
    minY: Math.min(...ndc.map((p) => p.y)),
    maxY: Math.max(...ndc.map((p) => p.y)),
    minDepth: Math.min(...ndc.map((p) => p.depth)),
  };
}

describe("aerialView", () => {
  const margin = { x: 0.06, top: 0.12, bottom: 0.12 };

  for (const [name, width, depth, aspect] of [
    ["a tiny repo on a desktop", 18, 16, 1.6],
    ["a huge repo on a desktop", 420, 380, 1.6],
    ["a wide island on a desktop", 300, 120, 1.78],
    ["a huge repo on a portrait phone", 420, 380, 0.46],
  ] as const) {
    it(`frames ${name} tightly, inside the margins`, () => {
      const g = ground(width, depth);
      const towers: Point3[] = [
        { x: 0, y: width * 0.08, z: 0 },
        { x: g.minX * 0.8, y: width * 0.05, z: g.minZ * 0.8 },
      ];
      const view = aerialView({ ground: g, points: towers, fov: FOV, aspect, margin });
      const e = extent([...corners(g), ...towers], view, aspect);
      const eps = 1e-6;
      expect(e.minDepth).toBeGreaterThan(0);
      expect(e.minX).toBeGreaterThanOrEqual(-(1 - margin.x) - eps);
      expect(e.maxX).toBeLessThanOrEqual(1 - margin.x + eps);
      expect(e.maxY).toBeLessThanOrEqual(1 - margin.top + eps);
      expect(e.minY).toBeGreaterThanOrEqual(-(1 - margin.bottom) - eps);
      // Tight: one pair of opposite edges is touched.
      const touchesSides = Math.abs(e.maxX - (1 - margin.x)) < 1e-4 && Math.abs(e.minX + (1 - margin.x)) < 1e-4;
      const touchesTopBottom = Math.abs(e.maxY - (1 - margin.top)) < 1e-4 && Math.abs(e.minY + (1 - margin.bottom)) < 1e-4;
      expect(touchesSides || touchesTopBottom).toBe(true);
      // The pivot is on the ground, along the line of sight.
      expect(view.target.y).toBe(0);
      expect(view.position.y).toBeGreaterThan(0);
    });
  }

  it("scales distance with the size of the island", () => {
    const small = aerialView({ ground: ground(20, 20), fov: FOV, aspect: 1.6 });
    const large = aerialView({ ground: ground(400, 400), fov: FOV, aspect: 1.6 });
    expect(large.distance / small.distance).toBeCloseTo(20, 5);
  });

  it("looks from a corner, slightly off the diagonal", () => {
    const g = ground(100, 100);
    expect(cornerAzimuth(g)).toBeGreaterThan(0.5);
    expect(cornerAzimuth(g)).toBeLessThan(Math.PI / 4);
    const view = aerialView({ ground: g, fov: FOV, aspect: 1.6 });
    expect(view.position.x).toBeGreaterThan(0);
    expect(view.position.z).toBeGreaterThan(0);
  });

  it("keeps a side panel's part of the frame clear", () => {
    const g = ground(200, 200);
    const sides = { left: 0.6, right: 0.06, top: 0.12, bottom: 0.12 };
    const view = aerialView({ ground: g, fov: FOV, aspect: 1.6, margin: sides });
    const e = extent(corners(g), view, 1.6);
    expect(e.minX).toBeGreaterThanOrEqual(-(1 - sides.left) - 1e-6);
    expect(e.maxX).toBeLessThanOrEqual(1 - sides.right + 1e-6);
    expect(Math.abs(e.minX + (1 - sides.left)) < 1e-4 || Math.abs(e.minY + (1 - sides.bottom)) < 1e-4).toBe(true);
  });

  it("keeps the city low in a portrait frame, with room above it", () => {
    const g = ground(200, 200);
    const view = aerialView({ ground: g, fov: FOV, aspect: 0.46, margin });
    const e = extent(corners(g), view, 0.46);
    const above = 1 - margin.top - e.maxY;
    const below = e.minY + 1 - margin.bottom;
    expect(above).toBeGreaterThan(below);
  });
});
