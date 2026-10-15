"use client";

import dynamic from "next/dynamic";
import { AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { parseRepoUrl } from "@/lib/github/parseRepoUrl";
import { cancelAll, goToLanding, loadRepo } from "@/state/loader";
import { useCity } from "@/state/store";
import { Landing } from "./ui/Landing";
import { LoadingStages } from "./ui/LoadingStages";
import { ErrorCard } from "./ui/ErrorCard";
import { Hud } from "./ui/Hud";
import { InfoPanel } from "./ui/InfoPanel";
import { SearchPalette } from "./ui/SearchPalette";
import { RepoPanel } from "./ui/RepoPanel";
import { HelpPanel } from "./ui/HelpPanel";
import { ControlsHint } from "./ui/ControlsHint";
import { WorldFallback } from "./ui/WorldFallback";
import { LiveRegion } from "./ui/LiveRegion";

const World = dynamic(() => import("./world/World"), { ssr: false, loading: () => null });

function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function CodeScape() {
  const phase = useCity((s) => s.phase);
  const assembled = useCity((s) => s.assembled);
  const [failure, setFailure] = useState<null | "crash" | "context-lost" | "unsupported">(null);

  // Routing from the address bar (and back/forward), after restoring saved preferences.
  useEffect(() => {
    useCity.getState().hydratePreferences();
    const route = () => {
      const segments = window.location.pathname.split("/").filter(Boolean);
      if (segments.length >= 2) {
        const parsed = parseRepoUrl(segments.join("/"));
        if (parsed.ok) {
          void loadRepo(parsed.value, "none");
          return;
        }
      }
      goToLanding(segments.length ? "replace" : "none");
    };
    route();
    window.addEventListener("popstate", route);
    return () => {
      window.removeEventListener("popstate", route);
      cancelAll();
    };
  }, []);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useCity.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (s.phase === "city") {
          e.preventDefault();
          s.set({ searchOpen: !s.searchOpen });
        }
        return;
      }
      if (e.key === "Escape") {
        if (s.searchOpen) s.set({ searchOpen: false });
        else if (s.panel) s.set({ panel: null });
        else if (s.filtersOpen) s.set({ filtersOpen: false });
        else if (s.selected) s.select(null);
        else if (s.phase === "city") s.camera?.overview();
        return;
      }
      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey || s.phase !== "city") return;
      if (e.key === "/") {
        e.preventDefault();
        s.set({ searchOpen: true });
      } else if (e.key === "?") {
        s.set({ panel: s.panel === "help" ? null : "help" });
      } else if (e.key.toLowerCase() === "f" && s.selected) {
        if (s.selected.kind === "building") s.camera?.flyToBuilding(s.selected.id);
        else s.camera?.flyToDistrict(s.selected.id);
      } else if (e.key.toLowerCase() === "h" || e.key === "0") {
        s.camera?.overview();
      } else if (e.key.toLowerCase() === "t" && s.trace.status === "done") {
        s.set({ transit: !s.transit });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="fixed inset-0 overflow-hidden select-none">
      <div className="absolute inset-0">
        {!failure && <World onFailure={setFailure} />}
      </div>

      {/* Overlays never block the world except where they draw. */}
      <div className="pointer-events-none absolute inset-0">
        <AnimatePresence>{phase === "landing" && !failure && <Landing key="landing" />}</AnimatePresence>
        <AnimatePresence>{(phase === "loading" || (phase === "city" && !assembled)) && <LoadingStages key="loading" />}</AnimatePresence>
        <AnimatePresence>{phase === "error" && <ErrorCard key="error" />}</AnimatePresence>
        <AnimatePresence>{phase === "city" && <Hud key="hud" />}</AnimatePresence>
        {phase === "city" && <InfoPanel />}
        {phase === "city" && <RepoPanel />}
        <SearchPalette />
        <HelpPanel />
        {phase === "city" && assembled && <ControlsHint />}
        {failure && <WorldFallback reason={failure} />}
      </div>
      <LiveRegion />
    </main>
  );
}
