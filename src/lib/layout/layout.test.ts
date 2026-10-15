import { describe, expect, it } from "vitest";
import { buildRepoModel } from "../analysis/buildModel";
import { snapshotOf, syntheticRepo } from "../testing/fixtures";
import { buildCityLayout, buildingIdForFile } from "./cityLayout";
import { squarify } from "./treemap";

function fingerprint(layout: ReturnType<typeof buildCityLayout>) {
  return JSON.stringify({
    b: layout.buildings.map((b) => [b.id, b.x.toFixed(4), b.z.toFixed(4), b.height.toFixed(4), b.archetype]),
    p: layout.plates.map((p) => [p.id, p.x.toFixed(4), p.z.toFixed(4)]),
    t: layout.trees.length,
  });
}

describe("squarify", () => {
  it("tiles the rectangle exactly with proportional areas", () => {
    const rect = { x: 0, y: 0, w: 10, h: 6 };
    const cells = squarify(
      [6, 6, 4, 3, 2, 2, 1].map((value, i) => ({ item: i, value })),
      rect,
    );
    const total = cells.reduce((s, c) => s + c.rect.w * c.rect.h, 0);
    expect(total).toBeCloseTo(60, 6);
    expect(cells[0].rect.w * cells[0].rect.h).toBeCloseTo((6 / 24) * 60, 6);
    for (const c of cells) {
      expect(c.rect.x).toBeGreaterThanOrEqual(-1e-9);
      expect(c.rect.y).toBeGreaterThanOrEqual(-1e-9);
      expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(10 + 1e-9);
      expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(6 + 1e-9);
    }
  });
});

describe("buildCityLayout", () => {
  const model = buildRepoModel(snapshotOf(syntheticRepo(600)));
  const layout = buildCityLayout(model);

  it("is deterministic for the same repository", () => {
    const again = buildCityLayout(buildRepoModel(snapshotOf([...syntheticRepo(600)].reverse())));
    expect(fingerprint(again)).toBe(fingerprint(layout));
  });

  it("places one building per rendered file", () => {
    expect(layout.buildings.length).toBe(model.files.length);
    for (const f of model.files) expect(buildingIdForFile(layout, f)).toBe(f.path);
  });

  it("never overlaps building footprints", () => {
    const bs = layout.buildings;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const b = bs[j];
        const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 1e-6;
        const overlapZ = Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 - 1e-6;
        expect(overlapX && overlapZ, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("keeps everything inside the city and on the island", () => {
    const { city, island } = layout;
    for (const b of layout.buildings) {
      expect(b.x - b.width / 2).toBeGreaterThanOrEqual(city.minX);
      expect(b.x + b.width / 2).toBeLessThanOrEqual(city.maxX);
      expect(b.z - b.depth / 2).toBeGreaterThanOrEqual(city.minZ);
      expect(b.z + b.depth / 2).toBeLessThanOrEqual(city.maxZ);
    }
    for (const t of layout.trees) {
      expect(t.x).toBeGreaterThan(island.minX);
      expect(t.x).toBeLessThan(island.maxX);
      expect(t.z).toBeGreaterThan(island.minZ);
      expect(t.z).toBeLessThan(island.maxZ);
    }
  });

  it("draws aggregated folders as single blocks", () => {
    const big = buildRepoModel(snapshotOf(syntheticRepo(900)), { budget: 200 });
    const l = buildCityLayout(big);
    expect(l.buildings.length).toBeLessThanOrEqual(200);
    const blocks = l.buildings.filter((b) => b.kind === "block");
    expect(blocks.length).toBeGreaterThan(0);
    for (const f of big.files) expect(buildingIdForFile(l, f)).toBeDefined();
  });

  it("gives top-level folders a district plate and a label", () => {
    const tops = model.root.dirs.map((d) => d.path);
    for (const p of tops) {
      expect(layout.plateIndex.has(p)).toBe(true);
      expect(layout.labels.some((l) => l.id === p)).toBe(true);
    }
  });
});
