import { create } from "zustand";
import type { RepoModel, Category } from "@/lib/analysis/types";
import type { LayoutResult } from "@/lib/layout/cityLayout";
import type { DependencyGraph } from "@/lib/analysis/imports/trace";
import type { RepoRef, GitHubErrorKind, RateLimitInfo } from "@/lib/github/types";
import type { RepoUrlErrorKind } from "@/lib/github/parseRepoUrl";
import type { CityStyleId } from "@/theme/cityStyles";
import type { TimeMode } from "@/theme/timeOfDay";
import { browserStorage, DEFAULT_PREFERENCES, loadPreferences, savePreferences, type ColorLens } from "./preferences";

export type Phase = "landing" | "loading" | "city" | "error";

export type LoadStage = "metadata" | "tree" | "analysis" | "layout" | "assembling";

export type CityErrorKind = GitHubErrorKind | "nothing-to-build" | "snapshot-unavailable";

export interface CityError {
  kind: CityErrorKind;
  repo: RepoRef;
  message?: string;
  rateLimit?: RateLimitInfo;
  retryAfterMs?: number;
  /** Known when the repo exists but the requested ref doesn't. */
  defaultBranch?: string;
  /** When the error happened, for countdowns. */
  at: number;
}

export type Target = { kind: "building"; id: string } | { kind: "district"; id: string };

export type TraceState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number }
  | { status: "done"; graph: DependencyGraph }
  | { status: "error"; message: string }
  | { status: "unsupported" };

export interface CameraApi {
  flyToBuilding(id: string): void;
  flyToDistrict(path: string): void;
  overview(): void;
  zoom(direction: 1 | -1): void;
}

export type Tier = "high" | "low";

interface CityState {
  phase: Phase;
  repo: RepoRef | null;
  stage: LoadStage | null;
  bytesReceived: number;
  /** Set when the current city came from this session's cache. */
  fromCache: boolean;
  error: CityError | null;
  inputError: { kind: RepoUrlErrorKind; detail?: string; text: string } | null;
  model: RepoModel | null;
  layout: LayoutResult | null;
  /** Bumped for every new city, so the world can remount cleanly. */
  cityKey: number;
  trace: TraceState;

  hovered: Target | null;
  selected: Target | null;
  hiddenCategories: ReadonlySet<Category>;
  hiddenLanguages: ReadonlySet<string>;
  isolate: string | null;
  transit: boolean;
  panel: "repo" | "help" | null;
  searchOpen: boolean;
  filtersOpen: boolean;
  tier: Tier;
  reducedMotion: boolean;
  assembled: boolean;
  camera: CameraApi | null;

  /** Visual preferences; persisted, and never change the data. */
  cityStyle: CityStyleId;
  timeMode: TimeMode;
  colorLens: ColorLens;

  set: (partial: Partial<CityState>) => void;
  setPreference: (partial: Partial<Pick<CityState, "cityStyle" | "timeMode" | "colorLens">>) => void;
  hydratePreferences: () => void;
  hover: (t: Target | null) => void;
  select: (t: Target | null, opts?: { fly?: boolean }) => void;
  toggleCategory: (c: Category) => void;
  toggleLanguage: (l: string) => void;
  soloLanguage: (l: string) => void;
  setIsolate: (path: string | null) => void;
  clearFilters: () => void;
}

const sameTarget = (a: Target | null, b: Target | null) =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id);

export const useCity = create<CityState>((set, get) => ({
  phase: "landing",
  repo: null,
  stage: null,
  bytesReceived: 0,
  fromCache: false,
  error: null,
  inputError: null,
  model: null,
  layout: null,
  cityKey: 0,
  trace: { status: "idle" },

  hovered: null,
  selected: null,
  hiddenCategories: new Set(),
  hiddenLanguages: new Set(),
  isolate: null,
  transit: false,
  panel: null,
  searchOpen: false,
  filtersOpen: false,
  tier: "high",
  reducedMotion: false,
  assembled: false,
  camera: null,

  ...DEFAULT_PREFERENCES,

  set: (partial) => set(partial),

  setPreference: (partial) => {
    set(partial);
    const { cityStyle, timeMode, colorLens } = get();
    savePreferences(browserStorage(), { cityStyle, timeMode, colorLens });
  },

  // Called once on the client after mount, so server and client render the same first frame.
  hydratePreferences: () => set(loadPreferences(browserStorage())),

  hover: (t) => {
    if (!sameTarget(get().hovered, t)) set({ hovered: t });
  },

  select: (t, opts) => {
    set({ selected: t, panel: t ? null : get().panel });
    if (!t || opts?.fly === false) return;
    const cam = get().camera;
    if (!cam) return;
    if (t.kind === "building") cam.flyToBuilding(t.id);
    else cam.flyToDistrict(t.id);
  },

  toggleCategory: (c) => {
    const next = new Set(get().hiddenCategories);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    set({ hiddenCategories: next });
  },

  toggleLanguage: (l) => {
    const next = new Set(get().hiddenLanguages);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    set({ hiddenLanguages: next });
  },

  soloLanguage: (l) => {
    const langs = Object.keys(get().model?.stats.languages ?? {});
    const hidden = get().hiddenLanguages;
    const alreadySolo = langs.every((x) => (x === l ? !hidden.has(x) : hidden.has(x)));
    set({ hiddenLanguages: alreadySolo ? new Set() : new Set(langs.filter((x) => x !== l)) });
  },

  setIsolate: (path) => set({ isolate: path }),

  clearFilters: () => set({ hiddenCategories: new Set(), hiddenLanguages: new Set(), isolate: null }),
}));

/** Reset everything that belongs to a single city. */
export function resetCityState(): Partial<CityState> {
  return {
    hovered: null,
    selected: null,
    hiddenCategories: new Set(),
    hiddenLanguages: new Set(),
    isolate: null,
    transit: false,
    panel: null,
    searchOpen: false,
    filtersOpen: false,
    assembled: false,
    trace: { status: "idle" },
  };
}
