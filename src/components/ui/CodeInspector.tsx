"use client";

import { useMemo, useState } from "react";
import { journeyFromSymbol } from "@/lib/analysis/code/journeys";
import { indexLookup, relatedTests } from "@/lib/analysis/code/queries";
import type { CodeSymbol } from "@/lib/analysis/code/types";
import { isParseable } from "@/lib/analysis/code/parser";
import type { FileNode } from "@/lib/analysis/types";
import { useCity } from "@/state/store";
import { BasisBadge, LocLink, SourceExcerpt } from "./Evidence";
import { Section } from "./common";
import { IconRoute } from "./icons";

const KIND_MARK: Record<CodeSymbol["kind"], string> = {
  function: "fn",
  method: "m",
  class: "C",
  interface: "I",
  type: "T",
  enum: "E",
  variable: "v",
  handler: "↳",
};

function notParsedReason(file: FileNode, analysis: NonNullable<ReturnType<typeof useCity.getState>["analysis"]>): string {
  const l = analysis.index.limits;
  if (l.withheld.includes(file.path)) return "Its contents are withheld because it may contain secrets.";
  if (!isParseable(file.path)) return "CodeScape doesn't parse this language yet, so it has no symbols or edges.";
  if (l.failed.includes(file.path)) return "The file couldn't be read.";
  if (file.size > 512 * 1024 || (analysis.snapshot.source !== "local" && file.size > 300 * 1024)) return "The file is over the size limit for parsing.";
  return `Only ${l.parsed} of ${l.eligible} source files are parsed (entry points and source first), and this one wasn't reached.`;
}

/** Symbols, calls, routes, tests and source for one file, all with evidence. */
export function CodeInspector({ file }: { file: FileNode }) {
  const analysis = useCity((s) => s.analysis);
  const model = useCity((s) => s.model);
  const trace = useCity((s) => s.trace);
  const symbolId = useCity((s) => s.symbol);
  const [showSource, setShowSource] = useState(false);

  const parsed = analysis?.index.files[file.path];
  const lookup = useMemo(() => (analysis ? indexLookup(analysis.index) : null), [analysis]);
  const tests = useMemo(() => (analysis && model ? relatedTests(model, analysis.index, file.path) : []), [analysis, model, file.path]);
  const packages = useMemo(
    () => (analysis ? [...new Set(analysis.index.external.filter((x) => x.path === file.path).map((x) => x.module))].sort() : []),
    [analysis, file.path],
  );

  if (!analysis || !lookup || !model) {
    return (
      <Section title="Code">
        <p className="flex items-center gap-2 text-[0.8rem] text-ink-soft">
          {trace.status === "running" || trace.status === "idle" ? (
            <>
              <span className="spin block h-3.5 w-3.5 rounded-full border-2 border-teal border-t-transparent" />
              Reading source…
            </>
          ) : (
            "Source analysis isn't available for this city."
          )}
        </p>
      </Section>
    );
  }

  if (!parsed) {
    return (
      <Section title="Code">
        <p className="text-[0.8rem] leading-relaxed text-ink-soft">Not parsed. {notParsedReason(file, analysis)}</p>
      </Section>
    );
  }

  const symbols = [...parsed.symbols].sort((a, b) => a.range.startLine - b.range.startLine);
  const selected = symbolId ? lookup.symbols.get(symbolId) : undefined;
  const selectSymbol = (id: string | null) => useCity.getState().set({ symbol: id });

  return (
    <>
      <Section
        title={`Declarations · ${symbols.length}`}
        aside={
          <span className="flex items-center gap-1.5 text-[0.68rem] text-ink-faint">
            {parsed.parser === "tree-sitter" ? "parsed" : "imports only"} <BasisBadge basis="static-analysis" />
          </span>
        }
      >
        {symbols.length === 0 ? (
          <p className="text-[0.8rem] text-ink-soft">
            {parsed.parser === "regex" ? "Read with the import-only fallback, so declarations aren't listed." : "No top-level declarations."}
          </p>
        ) : (
          <ul className="max-h-56 space-y-px overflow-auto pr-1" role="listbox" aria-label="Declarations">
            {symbols.map((s) => {
              const active = s.id === symbolId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`row-btn !py-1 ${active ? "bg-accent-soft" : ""}`}
                    onClick={() => selectSymbol(active ? null : s.id)}
                  >
                    <span className="w-5 shrink-0 text-center font-mono text-[0.68rem] text-ink-faint">{KIND_MARK[s.kind]}</span>
                    <span className={`min-w-0 flex-1 truncate font-mono text-[0.76rem] ${s.exported ? "text-ink" : "text-ink-soft"}`}>{s.qualifiedName}</span>
                    <span className="shrink-0 font-mono text-[0.66rem] text-ink-faint tabular-nums">
                      {s.range.startLine}–{s.range.endLine}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {selected && <SymbolDetail symbol={selected} />}

      {parsed.routes.length > 0 && (
        <Section title="Routes" aside={<BasisBadge basis="static-analysis" />}>
          <ul className="space-y-1">
            {parsed.routes.map((r) => (
              <li key={`${r.method}:${r.route}:${r.line}`} className="flex items-center gap-2 text-[0.78rem]">
                <span className="w-12 shrink-0 font-mono text-[0.68rem] font-semibold text-accent">{r.method}</span>
                <span className="min-w-0 flex-1 truncate font-mono">{r.route}</span>
                <LocLink path={file.path} line={r.line} label={`:${r.line}`} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(tests.length > 0 || packages.length > 0) && (
        <Section title="Context">
          {tests.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-[0.74rem] font-semibold text-ink-soft">Related tests</p>
              <ul className="space-y-1">
                {tests.map((t) => (
                  <li key={t.path} className="flex items-center gap-2">
                    <BasisBadge basis={t.basis} />
                    <LocLink path={t.path} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {packages.length > 0 && (
            <p className="text-[0.76rem] text-ink-soft">
              <span className="font-semibold">Packages used:</span> <span className="font-mono text-[0.72rem]">{packages.join(", ")}</span>
            </p>
          )}
        </Section>
      )}

      {!selected && (
        <Section title="Source">
          {showSource ? (
            <SourceExcerpt path={file.path} start={1} end={60} />
          ) : (
            <button type="button" className="btn btn-quiet px-3 py-1.5 text-[0.78rem]" onClick={() => setShowSource(true)}>
              Show the first lines
            </button>
          )}
        </Section>
      )}
    </>
  );
}

function SymbolDetail({ symbol }: { symbol: CodeSymbol }) {
  const analysis = useCity((s) => s.analysis)!;
  const lookup = indexLookup(analysis.index);
  const calls = lookup.callsOut.get(symbol.id) ?? [];
  const callers = lookup.callsIn.get(symbol.id) ?? [];
  const externals = analysis.index.external.filter((x) => x.enclosing === symbol.id && x.callee);
  const name = (id: string) => lookup.symbols.get(id)?.qualifiedName ?? id.split("/").pop() ?? id;

  return (
    <Section
      title={symbol.qualifiedName}
      aside={
        <button
          type="button"
          className="btn btn-quiet px-2.5 py-1 text-[0.72rem]"
          title="Follow resolved calls from this declaration"
          onClick={() => useCity.getState().playJourney(journeyFromSymbol(analysis.index, symbol))}
        >
          <IconRoute size={14} /> Trace from here
        </button>
      }
    >
      {symbol.doc && <p className="mb-2 text-[0.8rem] text-ink-soft">{symbol.doc}</p>}
      <SourceExcerpt path={symbol.path} start={symbol.range.startLine} end={symbol.range.endLine} />
      <div className="mt-3 grid gap-3">
        <RelationBlock title="Calls" empty="No resolved calls into other repository code." items={calls.map((e) => ({ key: e.to, name: name(e.to), path: e.toPath, line: e.lines[0], at: e.fromPath }))} />
        {externals.length > 0 && (
          <div>
            <p className="mb-1 text-[0.74rem] font-semibold text-ink-soft">Leaves the repository</p>
            <ul className="space-y-0.5">
              {externals.slice(0, 6).map((x) => (
                <li key={`${x.module}:${x.callee}:${x.line}`} className="flex items-center gap-2 text-[0.74rem]">
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {x.callee} <span className="text-ink-faint">({x.module})</span>
                  </span>
                  <LocLink path={x.path} line={x.line} label={`:${x.line}`} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <RelationBlock title="Called by" empty="No resolved callers among the parsed files." items={callers.map((e) => ({ key: e.from, name: name(e.from), path: e.fromPath, line: e.lines[0], at: e.fromPath }))} />
      </div>
    </Section>
  );
}

function RelationBlock({ title, empty, items }: { title: string; empty: string; items: { key: string; name: string; path: string; line: number; at: string }[] }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-2 text-[0.74rem] font-semibold text-ink-soft">
        {title} {items.length > 0 && <span className="text-ink-faint">· {items.length}</span>}
      </p>
      {items.length === 0 ? (
        <p className="text-[0.76rem] text-ink-faint">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 12).map((it) => (
            <li key={it.key} className="flex items-center gap-2 text-[0.76rem]">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-mono hover:text-ink"
                onClick={() => {
                  const s = useCity.getState();
                  const file = s.model?.filesByPath.get(it.path);
                  if (!file || !s.layout) return;
                  const sym = it.key.includes("#") ? it.key : null;
                  const target = s.layout.buildingIndex.has(file.path) ? file.path : (file.aggregatedInto ?? null);
                  if (target) s.select({ kind: "building", id: target }, { symbol: sym });
                }}
              >
                {it.name}
              </button>
              <LocLink path={it.at} line={it.line} label={`${it.at.split("/").pop()}:${it.line}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
