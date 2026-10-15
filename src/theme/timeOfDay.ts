export type TimeMode = "auto" | "day" | "night";

/**
 * Local-time windows for automatic mode. They're fixed rather than geolocated,
 * so there's no permission prompt. Dusk and dawn blend gradually.
 */
export const DAWN_START = 5.5; // 05:30, night begins fading
export const DAWN_END = 7; // 07:00, full day
export const DUSK_START = 18; // 18:00, day begins fading
export const DUSK_END = 19.5; // 19:30, full night

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** 0 = full day, 1 = full night, in between around dawn and dusk. */
export function autoNightFactor(date: Date): number {
  const h = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  if (h >= DAWN_END && h <= DUSK_START) return 0;
  if (h >= DUSK_END || h <= DAWN_START) return 1;
  if (h > DUSK_START && h < DUSK_END) return smooth((h - DUSK_START) / (DUSK_END - DUSK_START));
  return 1 - smooth((h - DAWN_START) / (DAWN_END - DAWN_START));
}

export function resolveNightFactor(mode: TimeMode, date: Date): number {
  if (mode === "day") return 0;
  if (mode === "night") return 1;
  return autoNightFactor(date);
}

/** A short word for what automatic mode currently shows. */
export function describeNightFactor(f: number): "Day" | "Twilight" | "Night" {
  if (f <= 0.15) return "Day";
  if (f >= 0.85) return "Night";
  return "Twilight";
}
