"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LANGUAGES } from "@/lib/analysis/languages";
import { languageColor } from "@/theme/palette";
import { formatNumber } from "@/lib/format";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMediaQuery("(max-width: 639px)");

export function languageName(id: string) {
  return LANGUAGES[id]?.name ?? id;
}

/** Stacked composition bar with a compact legend. */
export function CompositionBar({
  data,
  colorFor,
  labelFor,
  unit = "files",
  format = formatNumber,
  max = 6,
}: {
  data: Record<string, number>;
  colorFor: (key: string) => string;
  labelFor: (key: string) => string;
  unit?: string;
  format?: (n: number) => string;
  max?: number;
}) {
  const entries = Object.entries(data)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return <p className="text-[0.8rem] text-ink-faint">Nothing to show.</p>;
  const shown = entries.slice(0, max);
  const rest = entries.slice(max).reduce((s, [, v]) => s + v, 0);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`Composition by ${unit}`}>
        {shown.map(([k, v]) => (
          <span key={k} style={{ width: `${(v / total) * 100}%`, background: colorFor(k) }} className="h-full first:rounded-l-full" />
        ))}
        {rest > 0 && <span style={{ width: `${(rest / total) * 100}%` }} className="h-full bg-white/15" />}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {shown.map(([k, v]) => (
          <li key={k} className="flex min-w-0 items-center gap-1.5 text-[0.76rem]">
            <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: colorFor(k) }} />
            <span className="truncate text-ink">{labelFor(k)}</span>
            <span className="ml-auto shrink-0 text-ink-faint tabular-nums">{format(v)}</span>
          </li>
        ))}
        {rest > 0 && (
          <li className="flex items-center gap-1.5 text-[0.76rem] text-ink-faint">
            <span className="h-2 w-2 rounded-[3px] bg-white/15" />
            Other
            <span className="ml-auto tabular-nums">{format(rest)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

export const languageBar = (data: Record<string, number>, opts: { unit?: string; format?: (n: number) => string } = {}) => (
  <CompositionBar data={data} colorFor={languageColor} labelFor={languageName} {...opts} />
);

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-white/[0.07] px-5 py-4 first:border-t-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[0.7rem] font-semibold tracking-[0.08em] text-ink-faint uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.7rem] font-medium text-ink-faint">{label}</dt>
      <dd className="truncate text-[0.88rem] font-semibold text-ink">{value}</dd>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "amber" | "teal" | "accent" }) {
  const tones = {
    neutral: "bg-white/[0.05] text-ink-soft",
    amber: "bg-amber-400/10 text-amber-300",
    teal: "bg-teal-400/10 text-teal-300",
    accent: "bg-accent-soft text-accent-deep",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11.5px] font-medium ${tones[tone]}`}>{children}</span>;
}
