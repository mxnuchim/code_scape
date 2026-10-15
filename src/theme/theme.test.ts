import { describe, expect, it } from "vitest";
import { autoNightFactor, describeNightFactor, resolveNightFactor } from "./timeOfDay";
import { blendPreset, mixHex } from "./environment";
import { CITY_STYLES, CITY_STYLE_IDS } from "./cityStyles";
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from "@/state/preferences";
import { buildRepoModel } from "@/lib/analysis/buildModel";
import { buildCityLayout } from "@/lib/layout/cityLayout";
import { profileHeight, styleLayout } from "@/lib/layout/styleHeights";
import { ARCHETYPES } from "@/lib/layout/archetypes";
import { snapshotOf, syntheticRepo } from "@/lib/testing/fixtures";

const at = (h: number, m = 0) => new Date(2026, 9, 15, h, m);

describe("time of day", () => {
  it("is full day and full night outside the transition windows", () => {
    expect(autoNightFactor(at(12))).toBe(0);
    expect(autoNightFactor(at(7))).toBe(0);
    expect(autoNightFactor(at(18))).toBe(0);
    expect(autoNightFactor(at(22))).toBe(1);
    expect(autoNightFactor(at(3))).toBe(1);
    expect(autoNightFactor(at(19, 30))).toBe(1);
  });

  it("blends gradually and monotonically through dusk and dawn", () => {
    let prev = 0;
    for (let m = 0; m <= 90; m += 5) {
      const f = autoNightFactor(at(18, m));
      expect(f).toBeGreaterThanOrEqual(prev);
      expect(f - prev).toBeLessThan(0.15);
      prev = f;
    }
    expect(autoNightFactor(at(18, 45))).toBeCloseTo(0.5, 2);
    expect(autoNightFactor(at(6, 15))).toBeCloseTo(0.5, 2);
  });

  it("lets manual modes override the clock", () => {
    expect(resolveNightFactor("day", at(23))).toBe(0);
    expect(resolveNightFactor("night", at(12))).toBe(1);
    expect(resolveNightFactor("auto", at(12))).toBe(0);
    expect(describeNightFactor(0.5)).toBe("Twilight");
  });
});

describe("environment blending", () => {
  it("mixes colours and numbers together", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    const s = CITY_STYLES.financial;
    expect(blendPreset(s.day, s.night, 0)).toEqual(s.day);
    expect(blendPreset(s.day, s.night, 1)).toEqual(s.night);
    const mid = blendPreset(s.day, s.night, 0.5);
    expect(mid.windowGlow).toBeCloseTo((s.day.windowGlow + s.night.windowGlow) / 2);
  });

  it("gives every style a complete day and night", () => {
    for (const id of CITY_STYLE_IDS) {
      const s = CITY_STYLES[id];
      expect(Object.keys(s.day).sort()).toEqual(Object.keys(s.night).sort());
      expect(s.night.windowGlow).toBeGreaterThan(s.day.windowGlow);
    }
  });
});

describe("style heights", () => {
  const layout = buildCityLayout(buildRepoModel(snapshotOf(syntheticRepo(300))));

  it("never moves, renames or reshapes buildings", () => {
    for (const id of CITY_STYLE_IDS) {
      const styled = styleLayout(layout, CITY_STYLES[id].heights);
      expect(styled.buildings.length).toBe(layout.buildings.length);
      styled.buildings.forEach((b, i) => {
        const o = layout.buildings[i];
        expect([b.id, b.x, b.z, b.width, b.depth, b.archetype]).toEqual([o.id, o.x, o.z, o.width, o.depth, o.archetype]);
        expect(b.height).toBeGreaterThan(0);
      });
      expect(styled.buildingIndex).toBe(layout.buildingIndex);
    }
  });

  it("keeps height order within each kind of building", () => {
    for (const id of CITY_STYLE_IDS) {
      const profile = CITY_STYLES[id].heights;
      for (const a of ARCHETYPES) {
        let prev = 0;
        for (let h = 0.2; h < 12; h += 0.25) {
          const v = profileHeight(a, h, profile);
          expect(v).toBeGreaterThanOrEqual(prev);
          prev = v;
        }
      }
    }
  });

  it("memoises per layout and profile", () => {
    const p = CITY_STYLES.noir.heights;
    expect(styleLayout(layout, p)).toBe(styleLayout(layout, p));
  });
});

describe("preferences", () => {
  it("defaults to automatic time", () => {
    expect(loadPreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES.timeMode).toBe("auto");
  });

  it("round-trips and rejects garbage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    savePreferences(storage, { cityStyle: "noir", timeMode: "night", colorLens: "language" });
    expect(loadPreferences(storage)).toEqual({ cityStyle: "noir", timeMode: "night", colorLens: "language" });
    store.set("codescape:preferences", '{"cityStyle":"gotham","timeMode":"noon"}');
    expect(loadPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
    store.set("codescape:preferences", "{not json");
    expect(loadPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadPreferences(broken)).toEqual(DEFAULT_PREFERENCES);
    expect(() => savePreferences(broken, DEFAULT_PREFERENCES)).not.toThrow();
  });
});
