import type { EnvironmentPreset } from "./cityStyles";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Blend two presets: every colour and number moves together, so dusk is coherent. */
export function blendPreset(a: EnvironmentPreset, b: EnvironmentPreset, t: number): EnvironmentPreset {
  const k = Math.min(1, Math.max(0, t));
  const out = {} as Record<string, string | number>;
  for (const key of Object.keys(a) as (keyof EnvironmentPreset)[]) {
    const va = a[key];
    const vb = b[key];
    out[key] = typeof va === "string" ? mixHex(va, vb as string, k) : va * (1 - k) + (vb as number) * k;
  }
  return out as unknown as EnvironmentPreset;
}
