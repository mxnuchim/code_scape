import { create } from "zustand";
import type { RepoModel, Category } from "@/lib/analysis/types";
import { buildingIdForFile, type LayoutResult } from "@/lib/layout/cityLayout";
import type { DependencyGraph } from "@/lib/analysis/imports/trace";
import type { WorkspaceAnalysis } from "@/lib/analysis/workspace";
import type { Journey } from "@/lib/analysis/code/journeys";
import type { RepoRef, GitHubErrorKind, RateLimitInfo } from "@/lib/github/types";
import type { RepoUrlErrorKind } from "@/lib/github/parseRepoUrl";
import type { CityStyleId } from "@/theme/cityStyles";
import type { TimeMode } from "@/theme/timeOfDay";
import { browserStorage, DEFAULT_PREFERENCES, loadPreferences, savePreferences, type ColorLens } from "./preferences";

export type Phase = "landing" | "loading" | "city" | "error";

export type LoadStage = "metadata" | "tree" | "analysis" | "layout" | "assembling";

export type CityErrorKind = GitHubErrorKind | "nothing-to-build" | "snapshot-unavailable" | "local-unavailable";

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

/** The journey being played, and which step is in focus. */
export interface JourneyFocus {
  journey: Journey;
  step: number;
}

export type Panel = "repo" | "help" | "guide" | null;

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
  /** Code understanding for this city: symbols, edges, overview, journeys, onboarding. */
  analysis: WorkspaceAnalysis | null;
  /** The journey being played, if any. */
  journey: JourneyFocus | null;
  /** A declaration selected inside the selected building (symbol id). */
  symbol: string | null;

  hovered: Target | null;
  selected: Target | null;
  hiddenCategories: ReadonlySet<Category>;
  hiddenLanguages: ReadonlySet<string>;
  isolate: string | null;
  transit: boolean;
  panel: Panel;
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
  select: (t: Target | null, opts?: { fly?: boolean; symbol?: string | null }) => void;
  playJourney: (journey: Journey | null, step?: number) => void;
  togglePanel: (panel: Exclude<Panel, null>) => void;
  stepJourney: (delta: number) => void;
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
  analysis: null,
  journey: null,
  symbol: null,

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
    const keepSymbol = opts?.symbol !== undefined ? opts.symbol : sameTarget(get().selected, t) ? get().symbol : null;
    // The guide stays open beside the inspector on wide screens; on phones only one sheet fits.
    const panel = get().panel;
    const keepGuide = panel === "guide" && !isPhone();
    set({ selected: t, symbol: t ? keepSymbol : null, panel: t && !keepGuide ? null : panel });
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

  playJourney: (journey, step = 0) => {
    if (!journey) {
      set({ journey: null });
      return;
    }
    const clamped = Math.max(0, Math.min(step, journey.steps.length - 1));
    // On narrower screens the guide gives way so the journey and inspector both fit.
    const narrow = typeof window !== "undefined" && window.innerWidth < 1280;
    set({ journey: { journey, step: clamped }, transit: false, ...(narrow && get().panel === "guide" ? { panel: null } : {}) });
    focusJourneyStep(journey, clamped);
  },

  stepJourney: (delta) => {
    const j = get().journey;
    if (!j) return;
    const step = Math.max(0, Math.min(j.step + delta, j.journey.steps.length - 1));
    if (step === j.step) return;
    set({ journey: { ...j, step } });
    focusJourneyStep(j.journey, step);
  },

  togglePanel: (panel) => {
    const open = get().panel === panel;
    // Phones show one bottom sheet at a time, so opening a panel closes the inspector.
    set({ panel: open ? null : panel, ...(!open && isPhone() ? { selected: null } : {}) });
  },

  setIsolate: (path) => set({ isolate: path }),

  clearFilters: () => set({ hiddenCategories: new Set(), hiddenLanguages: new Set(), isolate: null }),
}));

/** Narrow screens where side panels become bottom sheets (matches Sheet's mobile breakpoint). */
function isPhone(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 640;
}

/** Select the building for a journey step (and its symbol) and bring it into view. */
function focusJourneyStep(journey: Journey, step: number) {
  const s = useCity.getState();
  const target = journey.steps[step];
  if (!target || !s.model || !s.layout) return;
  const path = target.kind === "external" ? target.via?.path ?? target.path : target.path;
  const file = s.model.filesByPath.get(path);
  const buildingId = file ? buildingIdForFile(s.layout, file) : undefined;
  if (!buildingId) return;
  s.select({ kind: "building", id: buildingId }, { symbol: target.kind === "external" || target.id === target.path ? null : target.id });
}

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
    analysis: null,
    journey: null,
    symbol: null,
  };
}

// Expose the store to browser automation (Playwright sets navigator.webdriver) for end-to-end checks.
if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.webdriver) {
  (window as unknown as { __codescape?: typeof useCity }).__codescape = useCity;
}
