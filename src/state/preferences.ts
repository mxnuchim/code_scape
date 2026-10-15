import { isCityStyleId, type CityStyleId } from "@/theme/cityStyles";
import type { TimeMode } from "@/theme/timeOfDay";

export type ColorLens = "architectural" | "language" | "role";

export interface Preferences {
  cityStyle: CityStyleId;
  timeMode: TimeMode;
  colorLens: ColorLens;
}

export const DEFAULT_PREFERENCES: Preferences = {
  cityStyle: "financial",
  timeMode: "auto",
  colorLens: "architectural",
};

const KEY = "codescape:preferences";
const TIME_MODES: readonly TimeMode[] = ["auto", "day", "night"];
const LENSES: readonly ColorLens[] = ["architectural", "language", "role"];

/** Reads saved preferences. Anything missing, unknown or unreadable falls back to defaults. */
export function loadPreferences(storage: Pick<Storage, "getItem"> | undefined): Preferences {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const v = JSON.parse(raw) as Partial<Record<keyof Preferences, unknown>>;
    return {
      cityStyle: isCityStyleId(v.cityStyle) ? v.cityStyle : DEFAULT_PREFERENCES.cityStyle,
      timeMode: TIME_MODES.includes(v.timeMode as TimeMode) ? (v.timeMode as TimeMode) : DEFAULT_PREFERENCES.timeMode,
      colorLens: LENSES.includes(v.colorLens as ColorLens) ? (v.colorLens as ColorLens) : DEFAULT_PREFERENCES.colorLens,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(storage: Pick<Storage, "setItem"> | undefined, prefs: Preferences): void {
  try {
    storage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or full storage: preferences simply won't persist.
  }
}

export function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
