"use client";

import { motion } from "motion/react";
import { formatBytes, formatNumber, plural } from "@/lib/format";
import { repoSlug } from "@/lib/github/parseRepoUrl";
import { goToLanding } from "@/state/loader";
import { useCity, type LoadStage } from "@/state/store";
import { IconCheck } from "./icons";
import { RepoAvatar } from "./RepoAvatar";

const STEPS: { id: LoadStage; title: string }[] = [
  { id: "metadata", title: "Reading the deed" },
  { id: "tree", title: "Surveying the land" },
  { id: "analysis", title: "Zoning districts" },
  { id: "assembling", title: "Raising buildings" },
];

const ORDER: LoadStage[] = ["metadata", "tree", "analysis", "layout", "assembling"];

function stepIndex(stage: LoadStage | null): number {
  if (!stage) return STEPS.length;
  const i = ORDER.indexOf(stage);
  // "layout" belongs to the zoning step.
  return stage === "layout" ? 2 : stage === "assembling" ? 3 : Math.min(i, 3);
}

export function LoadingStages() {
  const repo = useCity((s) => s.repo);
  const stage = useCity((s) => s.stage);
  const bytes = useCity((s) => s.bytesReceived);
  const model = useCity((s) => s.model);
  const layout = useCity((s) => s.layout);
  const fromCache = useCity((s) => s.fromCache);
  const phase = useCity((s) => s.phase);
  const active = stepIndex(stage);

  const detail = (id: LoadStage): string | null => {
    switch (id) {
      case "metadata":
        return model?.source === "bundled-snapshot" ? "Bundled snapshot" : "Repository details from GitHub";
      case "tree":
        if (model?.source === "bundled-snapshot") return `Captured ${new Date(model.capturedAt!).toLocaleDateString()}`;
        if (fromCache) return "Already fetched this session";
        return bytes > 0 ? `${formatBytes(bytes)} of file tree received` : "Listing every file";
      case "analysis":
        if (!model) return "Skipping dependencies and build output";
        return `${plural(model.stats.files, "file")} · ${plural(model.stats.dirs, "folder")}${model.excluded.files ? ` · ${formatNumber(model.excluded.files)} skipped` : ""}`;
      case "assembling":
        return layout ? plural(layout.buildings.length, "building") : null;
      default:
        return null;
    }
  };

  return (
    <motion.div
      className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-[7vh]"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0, transition: { type: "spring", stiffness: 160, damping: 22, delay: 0.15 } }}
      exit={{ opacity: 0, y: 16, transition: { duration: 0.4, delay: 0.2 } }}
      role="status"
      aria-live="polite"
    >
      <div className="glass-strong pointer-events-auto w-full max-w-[420px] rounded-[24px] p-4 sm:p-5">
        <div className="mb-3.5 flex items-center gap-3">
          {repo && <RepoAvatar owner={repo.owner} size={36} />}
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-semibold tracking-wide text-ink-faint uppercase">Building</p>
            <p className="truncate font-display text-[1.15rem] font-bold tracking-tight">{repo ? repoSlug(repo) : "…"}</p>
          </div>
          {phase === "loading" && (
            <button type="button" className="btn btn-quiet px-3 py-1.5 text-xs" onClick={() => goToLanding()}>
              Cancel
            </button>
          )}
        </div>
        <ol className="space-y-2.5">
          {STEPS.map((step, i) => {
            const state = i < active ? "done" : i === active ? "active" : "pending";
            const d = state === "pending" ? null : detail(step.id);
            return (
              <li key={step.id} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors duration-300 ${
                    state === "done" ? "bg-teal text-white" : state === "active" ? "bg-accent-soft text-accent-deep" : "bg-black/5 text-transparent"
                  }`}
                >
                  {state === "done" ? (
                    <IconCheck size={13} strokeWidth={3} />
                  ) : state === "active" ? (
                    <span className="spin block h-3 w-3 rounded-full border-2 border-accent border-t-transparent" />
                  ) : null}
                </span>
                <div className="min-w-0">
                  <p className={`text-[0.9rem] font-semibold ${state === "pending" ? "text-ink-faint" : "text-ink"}`}>{step.title}</p>
                  {d && <p className="truncate text-[0.76rem] text-ink-soft tabular-nums">{d}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </motion.div>
  );
}
