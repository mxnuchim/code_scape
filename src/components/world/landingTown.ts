import { createRandom } from "@/lib/layout/random";
import { heightFor, SHAPES, type Archetype } from "@/lib/layout/archetypes";
import type { BuildingLayout, CityBounds, TreeLayout } from "@/lib/layout/types";

/**
 * The decorative village on the landing page. It does not represent any
 * repository; it's scenery around the empty plot where your city gets built.
 */
export interface LandingTown {
  buildings: BuildingLayout[];
  trees: TreeLayout[];
  island: CityBounds;
  plot: { width: number; depth: number };
}

const ARCHETYPES: [Archetype, number][] = [
  ["tower", 30],
  ["house", 22],
  ["warehouse", 8],
  ["lab", 8],
  ["silo", 8],
  ["factory", 6],
  ["pavilion", 7],
  ["crates", 4],
  ["kiosk", 3],
];
const LANGS = ["typescript", "javascript", "python", "go", "rust", "css", "markdown", "html", "vue", "ruby", "yaml", "shell"];
const CATEGORY: Partial<Record<Archetype, BuildingLayout["category"]>> = {
  tower: "source",
  house: "docs",
  warehouse: "data",
  lab: "test",
  silo: "config",
  factory: "build",
  pavilion: "style",
  crates: "asset",
};

export function buildLandingTown(): LandingTown {
  const rand = createRandom(20261014);
  const W = 50;
  const D = 38;
  const plot = { width: 17, depth: 12 };
  const cell = 2.1;
  const buildings: BuildingLayout[] = [];
  const trees: TreeLayout[] = [];
  const pick = () => {
    const total = ARCHETYPES.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [a, w] of ARCHETYPES) {
      if ((r -= w) <= 0) return a;
    }
    return "tower" as Archetype;
  };

  const cols = Math.floor((W - 6) / cell);
  const rows = Math.floor((D - 6) / cell);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -((cols - 1) * cell) / 2 + c * cell + (rand() - 0.5) * 0.25;
      const z = -((rows - 1) * cell) / 2 + r * cell + (rand() - 0.5) * 0.25;
      // Leave the central plot (and a street around it) empty.
      if (Math.abs(x) < plot.width / 2 + 1.4 && Math.abs(z) < plot.depth / 2 + 1.4) continue;
      // Keep the island's rounded corners clear.
      const qx = Math.max(0, Math.abs(x) - (W / 2 - 7));
      const qz = Math.max(0, Math.abs(z) - (D / 2 - 7));
      if (Math.hypot(qx, qz) > 4) continue;
      const ring = Math.max(Math.abs(x) / (W / 2), Math.abs(z) / (D / 2));
      const roll = rand();
      if (roll < 0.58 - ring * 0.25) {
        const archetype = pick();
        const s = SHAPES[archetype];
        const near = 1 - ring;
        const bytes = Math.exp(4 + rand() * 6 + near * 2.4);
        const variant = rand();
        buildings.push({
          id: `decor-${buildings.length}`,
          kind: "file",
          archetype,
          x,
          z,
          y: 0,
          width: cell * 0.66 * s.fillX * 1.25,
          depth: cell * 0.66 * s.fillZ * 1.25,
          height: heightFor(archetype, bytes),
          language: LANGS[Math.floor(rand() * LANGS.length)],
          category: CATEGORY[archetype] ?? "other",
          dirPath: "",
          district: "",
          variant,
          delay: 0.1 + Math.hypot(x, z) * 0.035 + variant * 0.25,
        });
      } else if (roll < 0.86) {
        const r2 = rand();
        trees.push({
          x: x + (rand() - 0.5) * 0.6,
          y: 0,
          z: z + (rand() - 0.5) * 0.6,
          scale: 0.95 + rand() * 0.55,
          kind: r2 < 0.6 ? 0 : r2 < 0.9 ? 1 : 2,
          variant: rand(),
        });
      }
    }
  }

  // A few landmarks frame the plot.
  const landmark = (archetype: Archetype, x: number, z: number, bytes: number) => {
    const s = SHAPES[archetype];
    buildings.push({
      id: `decor-${buildings.length}`,
      kind: "file",
      archetype,
      x,
      z,
      y: 0,
      width: cell * s.fillX * 1.05,
      depth: cell * s.fillZ * 1.05,
      height: heightFor(archetype, bytes),
      language: "typescript",
      category: "source",
      dirPath: "",
      district: "",
      variant: 0.5,
      delay: 0.1,
    });
  };
  landmark("lighthouse", plot.width / 2 + 3.4, -plot.depth / 2 - 2.6, 30000);
  landmark("clocktower", -plot.width / 2 - 3.2, -plot.depth / 2 - 2.4, 9000);

  return {
    buildings: buildings.filter(
      // Drop anything that ended up too close to a landmark.
      (b, i, all) => !all.some((o, j) => j > i && Math.hypot(o.x - b.x, o.z - b.z) < 1.6),
    ),
    trees,
    island: { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2, width: W, depth: D },
    plot,
  };
}
