"use client";

import { useEffect, useState } from "react";
import type { Basis } from "@/lib/analysis/code/types";
import { redactSecrets } from "@/lib/analysis/redact";
import { fetchRawFile } from "@/lib/github/client";
import { sourceLink } from "@/lib/links";
import { targetForPath } from "@/state/deepLinks";
import { useCity } from "@/state/store";
import { IconExternal } from "./icons";

const BASIS: Record<Basis, { label: string; title: string; className: string }> = {
  fact: {
    label: "Fact",
    title: "Read directly from the file tree or a manifest.",
    className: "border-white/15 text-ink-soft",
  },
  "static-analysis": {
    label: "Static",
    title: "Found by parsing source and resolving imports and calls. Nothing was run, so runtime behaviour isn't covered.",
    className: "border-teal/40 text-teal",
  },
  heuristic: {
    label: "Heuristic",
    title: "Inferred from names or structure. Treat it as a hint, not a fact.",
    className: "border-dashed border-amber/50 text-amber",
  },
};

/** How a claim is known. Every inference in the UI carries one. */
export function BasisBadge({ basis }: { basis: Basis }) {
  const b = BASIS[basis];
  return (
    <span title={b.title} className={`inline-flex shrink-0 items-center rounded border px-1.5 py-px font-mono text-[0.62rem] tracking-wide uppercase ${b.className}`}>
      {b.label}
    </span>
  );
}

/**
 * A `path:line` reference that selects the building in the city. The small
 * arrow opens the real source (GitHub or the local editor).
 */
export function LocLink({ path, line, endLine, label }: { path: string; line?: number; endLine?: number; label?: string }) {
  const model = useCity((s) => s.model);
  const text = label ?? `${path}${line ? `:${line}${endLine && endLine !== line ? `-${endLine}` : ""}` : ""}`;
  const link = model ? sourceLink(model, path, { line, endLine }) : null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <button
        type="button"
        className="min-w-0 truncate rounded font-mono text-[0.72rem] text-ink-soft underline decoration-white/15 underline-offset-2 hover:text-ink hover:decoration-white/50"
        title={`Show ${path} in the city`}
        onClick={() => {
          const target = targetForPath(path);
          if (target) useCity.getState().select(target);
        }}
      >
        {text}
      </button>
      {link && (
        <a href={link.href} target={link.external ? "_blank" : undefined} rel="noopener noreferrer" className="shrink-0 text-ink-faint hover:text-ink" title={`${link.label}${line ? ` at line ${line}` : ""}`}>
          <IconExternal size={12} />
          <span className="sr-only">{link.label}</span>
        </a>
      )}
    </span>
  );
}

interface Excerpt {
  startLine: number;
  endLine: number;
  totalLines: number;
  text: string;
}

const MAX_EXCERPT_LINES = 80;

/** Fetch lines of a file: from the local API, or raw from GitHub (redacted either way). */
async function loadExcerpt(path: string, start: number, end: number, signal: AbortSignal): Promise<Excerpt> {
  const model = useCity.getState().model;
  if (!model) throw new Error("No repository loaded");
  if (model.origin.kind === "local") {
    const res = await fetch(`/api/workspace/file?${new URLSearchParams({ path, start: String(start), end: String(end) })}`, { signal, cache: "no-store" });
    const body = (await res.json()) as Excerpt & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  }
  const text = await fetchRawFile(model.meta.owner, model.meta.repo, model.ref, path, signal);
  if (text === null) throw new Error("File not found on GitHub");
  const lines = text.split("\n");
  const s = Math.max(1, Math.min(start, lines.length));
  const e = Math.max(s, Math.min(end, lines.length));
  return { startLine: s, endLine: e, totalLines: lines.length, text: redactSecrets(lines.slice(s - 1, e).join("\n")).text };
}

/** Numbered, read-only source lines with an optional highlighted range. */
export function SourceExcerpt({ path, start, end, highlight }: { path: string; start: number; end: number; highlight?: [number, number] }) {
  const [state, setState] = useState<{ key: string; excerpt?: Excerpt; error?: string } | null>(null);
  const key = `${path}:${start}-${end}`;
  const clampedEnd = Math.min(end, start + MAX_EXCERPT_LINES - 1);

  useEffect(() => {
    const controller = new AbortController();
    loadExcerpt(path, start, clampedEnd, controller.signal)
      .then((excerpt) => setState({ key, excerpt }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ key, error: err instanceof Error ? err.message : "Couldn't load the source" });
      });
    return () => controller.abort();
  }, [path, start, clampedEnd, key]);

  if (!state || state.key !== key) {
    return <div className="h-24 animate-pulse rounded-lg bg-white/[0.04]" aria-label="Loading source" />;
  }
  if (state.error || !state.excerpt) {
    return <p className="rounded-lg bg-white/[0.04] p-3 text-[0.78rem] text-ink-soft">Source unavailable: {state.error}</p>;
  }
  const { excerpt } = state;
  const lines = excerpt.text.split("\n");
  return (
    <div className="max-h-72 overflow-auto rounded-lg bg-black/30 py-2 ring-1 ring-white/[0.06]">
      <pre className="font-mono text-[0.7rem] leading-[1.55]">
        {lines.map((line, i) => {
          const n = excerpt.startLine + i;
          const hot = highlight && n >= highlight[0] && n <= highlight[1];
          return (
            <div key={n} className={`flex gap-3 px-3 ${hot ? "bg-amber/10" : ""}`}>
              <span className="w-8 shrink-0 text-right text-ink-faint select-none">{n}</span>
              <code className="whitespace-pre text-ink-soft">{line || " "}</code>
            </div>
          );
        })}
      </pre>
      {excerpt.endLine < excerpt.totalLines && end > clampedEnd && (
        <p className="px-3 pt-1 text-[0.68rem] text-ink-faint">Showing {MAX_EXCERPT_LINES} lines; open the file for the rest.</p>
      )}
    </div>
  );
}
