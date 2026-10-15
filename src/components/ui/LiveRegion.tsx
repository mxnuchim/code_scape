"use client";

import { useEffect, useState } from "react";
import { repoSlug } from "@/lib/github/parseRepoUrl";
import { formatNumber } from "@/lib/format";
import { useCity } from "@/state/store";

/** Screen-reader announcements for what the 3D view is doing. */
export function LiveRegion() {
  const [message, setMessage] = useState("");
  useEffect(
    () =>
      useCity.subscribe((s, prev) => {
        if (s.phase !== prev.phase || s.stage !== prev.stage) {
          if (s.phase === "loading" && s.repo) setMessage(`Building ${repoSlug(s.repo)}…`);
          else if (s.phase === "city" && s.layout && s.model && prev.phase !== "city")
            setMessage(`${s.model.meta.fullName} is ready: ${formatNumber(s.layout.buildings.length)} buildings in ${formatNumber(s.model.root.dirs.length)} districts.`);
          else if (s.phase === "error" && s.error) setMessage(`Couldn't build ${repoSlug(s.error.repo)}.`);
        }
        if (s.journey !== prev.journey && s.journey) {
          const step = s.journey.journey.steps[s.journey.step];
          setMessage(`Journey ${s.journey.journey.title}, step ${s.journey.step + 1} of ${s.journey.journey.steps.length}: ${step?.name ?? ""}`);
        } else if (s.selected !== prev.selected && s.selected) {
          setMessage(`Selected ${s.selected.kind === "district" ? "folder " : ""}${s.selected.id || "repository root"}`);
        }
      }),
    [],
  );
  return (
    <div aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
