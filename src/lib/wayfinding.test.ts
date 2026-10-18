import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { initNodeParsers } from "@/lib/local/wasm";
import { LocalWorkspace } from "@/lib/local/workspace";
import { buildCityLayout } from "@/lib/layout/cityLayout";
import { buildRepoModel } from "@/lib/analysis/buildModel";
import { snapshotOf } from "@/lib/testing/fixtures";
import { buildWayfinding, MAX_WAYPOINTS } from "./wayfinding";

beforeAll(async () => {
  expect(await initNodeParsers()).toBe(true);
});

async function fixture(name: string) {
  const ws = await LocalWorkspace.open(join(process.cwd(), "test", "fixtures", name));
  const { analysis, model } = await ws.get();
  return { analysis, model, layout: buildCityLayout(model) };
}

describe("wayfinding", () => {
  it("turns the reading order, module roles and journeys into a few pins", async () => {
    const { analysis, model, layout } = await fixture("ts-express-api");
    const w = buildWayfinding(model, layout, analysis);
    expect(w.provisional).toBe(false);
    expect(w.waypoints.length).toBeGreaterThan(0);
    expect(w.waypoints.length).toBeLessThanOrEqual(MAX_WAYPOINTS);
    // Same order as the guide's reading order, one pin per building, every stop says why.
    const reading = analysis.onboarding.readingOrder.map((r) => r.path);
    expect(w.waypoints.map((p) => p.path)).toEqual([...new Set(reading)].slice(0, w.waypoints.length));
    expect(w.waypoints.map((p) => p.order)).toEqual(w.waypoints.map((_, i) => i + 1));
    expect(new Set(w.waypoints.map((p) => p.buildingId)).size).toBe(w.waypoints.length);
    expect(w.waypoints.every((p) => p.reason.length > 10)).toBe(true);
    expect(w.waypoints[0]).toMatchObject({ path: "README.md", title: "README.md", basis: "fact" });

    // Trailheads start where journeys start and go somewhere.
    const post = w.trailheads.find((t) => t.title === "POST /users")!;
    expect(post).toBeDefined();
    const journey = analysis.journeys.find((j) => j.id === post.journeyId)!;
    expect(journey.start.path).toBe(post.buildingId);
    // Two routes start in the same file: one trailhead, with the rest counted.
    expect(post.more).toBe(1);

    // District signs carry the module's role and how it is known.
    for (const d of w.districts) {
      const m = analysis.overview.modules.find((x) => x.path === d.path)!;
      expect(d.role).toBe(m.role!.label);
      expect(d.basis).toBe(m.role!.basis);
    }
  });

  it("starts from the file tree before the code is parsed", () => {
    const model = buildRepoModel(snapshotOf(["README.md", "package.json", "src/index.ts", "src/lib/util.ts", "docs/guide.md"]));
    const w = buildWayfinding(model, buildCityLayout(model), null);
    expect(w.provisional).toBe(true);
    expect(w.waypoints.map((p) => [p.path, p.basis])).toEqual([
      ["README.md", "fact"],
      ["package.json", "fact"],
      ["src/index.ts", "heuristic"],
    ]);
    expect(w.districts).toEqual([]);
    expect(w.trailheads).toEqual([]);
  });
});
