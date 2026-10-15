"use client";

import { useState } from "react";
import { targetForPath } from "@/state/deepLinks";
import { useCity } from "@/state/store";
import { formatNumber, plural } from "@/lib/format";
import { PARSED_LANGUAGES_OR } from "@/lib/analysis/languages";
import { BasisBadge, LocLink } from "./Evidence";
import { Section } from "./common";
import { IconBook, IconChevron, IconRoute } from "./icons";
import { Sheet } from "./Sheet";
import { FileTree } from "./FileTree";

function goTo(path: string, symbol?: string) {
  const target = targetForPath(path);
  if (target) useCity.getState().select(target, { symbol: symbol ?? null });
}

/**
 * The onboarding guide: what this project is, where to start reading and why,
 * code journeys to follow, its modules, how to run and test it, and what the
 * analysis can't see. Every item is labelled with how it is known.
 */
export function GuidePanel() {
  const open = useCity((s) => s.panel === "guide");
  const analysis = useCity((s) => s.analysis);
  const model = useCity((s) => s.model);
  const trace = useCity((s) => s.trace);
  const journey = useCity((s) => s.journey);
  const [showAllModules, setShowAllModules] = useState(false);
  const [tab, setTab] = useState<"guide" | "files">("guide");
  if (!model) return null;

  const header = (
    <div className="flex items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-ink ring-1 ring-white/10">
        <IconBook size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="eyebrow">Guide</p>
        <h2 className="truncate text-[16px] leading-tight font-semibold tracking-tight">{analysis?.overview.projectType.label ?? model.meta.fullName}</h2>
        <div className="mt-2 flex gap-1" role="tablist" aria-label="Guide sections">
          {(["guide", "files"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`rounded px-2 py-0.5 text-[0.74rem] font-semibold ${tab === t ? "bg-white/10 text-ink" : "text-ink-faint hover:text-ink"}`}
              onClick={() => setTab(t)}
            >
              {t === "guide" ? "Start here" : "Files"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (tab === "files") {
    return (
      <Sheet open={open} side="left" label="Guide: files and folders" onClose={() => useCity.setState({ panel: null })} header={header}>
        <FileTree />
      </Sheet>
    );
  }

  if (!analysis) {
    return (
      <Sheet open={open} side="left" label="Guide" onClose={() => useCity.setState({ panel: null })} header={header}>
        <Section title="Reading the code">
          <p className="flex items-center gap-2 text-[0.82rem] text-ink-soft">
            {trace.status === "running" ? (
              <>
                <span className="spin block h-3.5 w-3.5 rounded-full border-2 border-teal border-t-transparent" />
                Parsing source · {trace.done}/{trace.total} files
              </>
            ) : trace.status === "unsupported" ? (
              `No supported source files (${PARSED_LANGUAGES_OR}) were found, so there is no code guide for this repository.`
            ) : trace.status === "error" ? (
              `Source analysis failed: ${trace.message}`
            ) : (
              "Waiting for source analysis…"
            )}
          </p>
        </Section>
      </Sheet>
    );
  }

  const { overview: o, onboarding: g, journeys } = analysis;
  const modules = showAllModules ? o.modules : o.modules.slice(0, 6);

  return (
    <Sheet open={open} side="left" label="Guide" onClose={() => useCity.setState({ panel: null })} header={header}>
      <Section title="What this is">
        <p className="mb-2 flex items-start gap-2 text-[0.84rem] leading-relaxed text-ink">
          <BasisBadge basis={o.projectType.basis} />
          <span>
            {o.projectType.label}
            <span className="text-ink-soft"> — {o.projectType.reasons.join("; ")}</span>
          </span>
        </p>
        {o.description && (
          <p className="mb-2 text-[0.82rem] leading-relaxed text-ink-soft">
            {o.description.text} <LocLink path={o.description.evidence.path} line={o.description.evidence.startLine} label="source" />
          </p>
        )}
        {o.technologies.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {o.technologies.slice(0, 14).map((t) => (
              <span key={t.name} className="chip !cursor-default !py-0.5 text-[0.72rem]" title={`${t.category} · ${t.evidence.path}:${t.evidence.startLine}`}>
                {t.name}
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="Start here" aside={<span className="text-[0.68rem] text-ink-faint">reading order</span>}>
        <ol className="space-y-2">
          {g.readingOrder.map((item) => (
            <li key={`${item.order}:${item.path}:${item.symbol ?? ""}`} className="flex gap-2.5">
              <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[0.72rem] text-ink-faint">{item.order}</span>
              <div className="min-w-0 flex-1">
                <button type="button" className="block max-w-full truncate text-left font-mono text-[0.78rem] text-ink hover:underline" onClick={() => goTo(item.path, item.symbol)}>
                  {item.path}
                  {item.symbol ? <span className="text-ink-soft">#{item.symbol.split("#")[1]}</span> : item.line ? <span className="text-ink-faint">:{item.line}</span> : null}
                </button>
                <p className="mt-0.5 flex items-start gap-1.5 text-[0.74rem] leading-snug text-ink-soft">
                  <span className="min-w-0 flex-1">{item.reason}</span>
                  <BasisBadge basis={item.basis} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={`Code journeys · ${journeys.length}`} aside={<BasisBadge basis="static-analysis" />}>
        {journeys.length === 0 ? (
          <p className="text-[0.8rem] text-ink-soft">
            No entry points with traceable calls were found (HTTP routes, page components, CLI or main functions). Pick any declaration in a building and use{" "}
            <b>Trace from here</b>.
          </p>
        ) : (
          <ul className="space-y-1">
            {journeys.slice(0, 12).map((j) => {
              const calls = j.steps.filter((s) => s.kind === "call").length;
              const active = journey?.journey.id === j.id;
              return (
                <li key={j.id}>
                  <button type="button" className={`row-btn ${active ? "bg-[rgba(157,140,255,0.14)]" : ""}`} onClick={() => useCity.getState().playJourney(active ? null : j)} aria-pressed={active}>
                    <IconRoute size={15} className="shrink-0 text-[#9d8cff]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[0.78rem] font-semibold">{j.title}</span>
                      <span className="block truncate text-[0.7rem] text-ink-faint">
                        {plural(calls, "call")} · {j.start.path}
                        {j.gaps.length ? ` · ${plural(j.gaps.length, "gap")}` : ""}
                      </span>
                    </span>
                    <IconChevron size={14} className="shrink-0 text-ink-faint" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[0.7rem] leading-snug text-ink-faint">Journeys follow resolved calls in source order. They show what code can call, not what happened at runtime.</p>
      </Section>

      <Section title={`Modules · ${o.modules.length}`}>
        <ul className="space-y-1">
          {modules.map((m) => (
            <li key={m.path || "(root)"}>
              <button type="button" className="row-btn" onClick={() => goTo(m.path)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[0.78rem] font-semibold">{m.path || "(repository root)"}</span>
                  <span className="block truncate text-[0.7rem] text-ink-faint">
                    {m.role ? m.role.label : "Role not determined"} · {formatNumber(m.files)} files
                    {m.importedBy ? ` · used by ${m.importedBy}` : ""}
                  </span>
                </span>
                {m.role && <BasisBadge basis={m.role.basis} />}
              </button>
            </li>
          ))}
        </ul>
        {o.modules.length > 6 && (
          <button type="button" className="mt-1 px-2 text-[0.74rem] font-semibold text-ink-soft hover:text-ink" onClick={() => setShowAllModules(!showAllModules)}>
            {showAllModules ? "Show fewer" : `Show all ${o.modules.length}`}
          </button>
        )}
      </Section>

      {(g.run.length > 0 || g.test.length > 0) && (
        <Section title="Run and test" aside={<BasisBadge basis="fact" />}>
          <ul className="space-y-1.5">
            {[...g.run, ...g.test].map((c) => (
              <li key={`${c.name}:${c.path}`} className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.76rem] font-semibold">{c.name}</span>
                  <LocLink path={c.path} line={c.line} label={`${c.path.split("/").pop()}:${c.line}`} />
                </div>
                <code className="block truncate rounded bg-black/25 px-2 py-1 font-mono text-[0.72rem] text-ink-soft">{c.command || "—"}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {g.questions.length > 0 && (
        <Section title="Questions to explore">
          <ul className="list-disc space-y-1 pl-4 text-[0.78rem] leading-snug text-ink-soft">
            {g.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p className="mt-2 text-[0.7rem] text-ink-faint">Ask these in Claude Code with the CodeScape MCP server for evidence-backed answers.</p>
        </Section>
      )}

      <Section title="What this analysis can't see">
        <ul className="list-disc space-y-1 pl-4 text-[0.74rem] leading-snug text-ink-soft">
          {o.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Section>
    </Sheet>
  );
}
