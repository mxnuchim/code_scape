"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { DependencyGraph } from "@/lib/analysis/imports/trace";
import { TRACE_MAX_BYTES } from "@/lib/analysis/imports/trace";
import { isParseable } from "@/lib/analysis/code/parser";
import { PARSED_LANGUAGES_AND, PARSED_LANGUAGES_OR } from "@/lib/analysis/languages";
import type { DirNode, FileNode, RepoModel } from "@/lib/analysis/types";
import { sourceLink } from "@/lib/links";
import type { LayoutResult } from "@/lib/layout/cityLayout";
import { ARCHETYPE_INFO } from "@/lib/layout/archetypes";
import type { BuildingLayout } from "@/lib/layout/types";
import { formatBytes, formatNumber, plural } from "@/lib/format";
import { useCity, type TraceState } from "@/state/store";
import { CATEGORY_COLORS, CATEGORY_META, languageColor } from "@/theme/palette";
import { relationsFor } from "../world/Connections";
import { Badge, CompositionBar, CopyButton, Fact, Section, languageBar, languageName } from "./common";
import { ArchetypeGlyph, IconExternal, IconFile, IconFolder, IconIsolate, IconTarget } from "./icons";
import { Sheet } from "./Sheet";
import { CodeInspector } from "./CodeInspector";
import { BasisBadge } from "./Evidence";

const LANDMARK_LABEL = {
  readme: "Landmark · root README",
  manifest: "Landmark · package manifest",
  entry: "Landmark · entry point",
  license: "Landmark · license",
} as const;

function Breadcrumbs({ path, isFile }: { path: string; isFile: boolean }) {
  const select = useCity((s) => s.select);
  const parts = path.split("/");
  const dirs = isFile ? parts.slice(0, -1) : parts;
  return (
    <nav aria-label="Location" className="flex flex-wrap items-center gap-0.5 font-mono text-[0.74rem] text-ink-faint">
      <button type="button" className="rounded px-1 hover:bg-white/[0.06] hover:text-ink" onClick={() => select({ kind: "district", id: "" })}>
        /
      </button>
      {dirs.map((seg, i) => {
        const p = dirs.slice(0, i + 1).join("/");
        return (
          <span key={p} className="flex items-center">
            <button type="button" className="rounded px-1 hover:bg-white/[0.06] hover:text-ink" onClick={() => select({ kind: "district", id: p })}>
              {seg}
            </button>
            <span>/</span>
          </span>
        );
      })}
      {isFile && <span className="px-1 text-ink-soft">{parts[parts.length - 1]}</span>}
    </nav>
  );
}

function RelationList({ items, layout, tone }: { items: { id: string; files: number }[]; layout: LayoutResult; tone: "out" | "in" }) {
  const select = useCity((s) => s.select);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 8);
  return (
    <ul className="space-y-0.5">
      {shown.map(({ id, files }) => {
        const b = layout.buildings[layout.buildingIndex.get(id)!];
        const isBlock = b.kind === "block";
        const name = isBlock ? `${id.split("/").pop()}/` : id.split("/").pop();
        return (
          <li key={id}>
            <button type="button" className="row-btn" onClick={() => select({ kind: "building", id })}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tone === "out" ? "var(--accent)" : "var(--teal)" }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.84rem] font-semibold">{name}</span>
                <span className="block truncate font-mono text-[0.68rem] text-ink-faint">{isBlock ? `block · ${plural(files, "file")}` : b.dirPath || "/"}</span>
              </span>
              <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: languageColor(b.language) }} />
            </button>
          </li>
        );
      })}
      {items.length > 8 && (
        <li>
          <button type="button" className="px-2 py-1 text-[0.76rem] font-semibold text-ink-soft hover:text-ink" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${items.length}`}
          </button>
        </li>
      )}
    </ul>
  );
}

function untracedReason(file: FileNode, graph: DependencyGraph): string {
  if (!isParseable(file.path)) return `Imports are traced for ${PARSED_LANGUAGES_AND} files.`;
  if (file.size > TRACE_MAX_BYTES) return `This file is larger than ${formatBytes(TRACE_MAX_BYTES)}, so it wasn't read.`;
  if (graph.failed.has(file.path)) return "We couldn't download this file to read its imports.";
  return `Only the first ${graph.cap} source files are read, and this one wasn't among them.`;
}

function Connections({ buildingId, files, trace, model, layout }: { buildingId: string; files: FileNode[]; trace: TraceState; model: RepoModel; layout: LayoutResult }) {
  if (trace.status === "running" || trace.status === "idle") {
    return (
      <Section title="Connections">
        <p className="flex items-center gap-2 text-[0.82rem] text-ink-soft">
          <span className="spin block h-3.5 w-3.5 rounded-full border-2 border-teal border-t-transparent" />
          Tracing imports{trace.status === "running" ? ` · ${trace.done}/${trace.total} files read` : "…"}
        </p>
      </Section>
    );
  }
  if (trace.status === "unsupported") {
    return (
      <Section title="Connections">
        <p className="text-[0.82rem] text-ink-soft">This repository has no {PARSED_LANGUAGES_OR} files to trace, so no connections are known.</p>
      </Section>
    );
  }
  if (trace.status === "error") {
    return (
      <Section title="Connections">
        <p className="text-[0.82rem] text-ink-soft">Import tracing failed, so connections are unknown. {trace.message}</p>
      </Section>
    );
  }
  const graph = trace.graph;
  const rel = relationsFor(model, layout, graph, buildingId);
  const tracedHere = files.filter((f) => graph.traced.has(f.path));
  const single = files.length === 1 ? files[0] : null;
  return (
    <Section
      title="Connections"
      aside={<span className="text-[0.68rem] text-ink-faint">traced from source</span>}
    >
      <div className="space-y-3">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[0.78rem] font-semibold">
            <span className="h-0.5 w-4 rounded-full bg-amber" /> Imports {rel.imports.length > 0 && <span className="text-ink-faint">· {rel.imports.length}</span>}
          </p>
          {single && !graph.traced.has(single.path) ? (
            <p className="text-[0.8rem] text-ink-soft">Not traced. {untracedReason(single, graph)}</p>
          ) : !single && tracedHere.length === 0 ? (
            <p className="text-[0.8rem] text-ink-soft">None of the files in this block were traced.</p>
          ) : rel.imports.length ? (
            <RelationList items={rel.imports} layout={layout} tone="out" />
          ) : (
            <p className="text-[0.8rem] text-ink-soft">No imports of other files in this repository.</p>
          )}
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[0.78rem] font-semibold">
            <span className="h-0.5 w-4 rounded-full bg-teal" /> Imported by {rel.importedBy.length > 0 && <span className="text-ink-faint">· {rel.importedBy.length}</span>}
          </p>
          {rel.importedBy.length ? (
            <RelationList items={rel.importedBy} layout={layout} tone="in" />
          ) : (
            <p className="text-[0.8rem] text-ink-soft">No traced file imports this.</p>
          )}
          <p className="mt-1.5 text-[0.7rem] text-ink-faint">
            Covers the {formatNumber(graph.traced.size)} of {formatNumber(graph.eligible)} source files that were read.
          </p>
        </div>
      </div>
    </Section>
  );
}

/** Whether an entry point is backed by a manifest, a route or a main block, or only by its name. */
function EntryEvidence({ file }: { file: FileNode }) {
  const analysis = useCity((s) => s.analysis);
  const entries = analysis?.overview.entryPoints.filter((e) => e.path === file.path && e.kind !== "naming-convention") ?? [];
  if (entries.length === 0) {
    return file.landmark === "entry" ? (
      <p className="mt-2 flex items-center gap-2 text-[0.76rem] text-ink-soft">
        <BasisBadge basis="heuristic" /> Named like an entry point; nothing confirms it.
      </p>
    ) : null;
  }
  return (
    <ul className="mt-2 space-y-1">
      {entries.slice(0, 3).map((e) => (
        <li key={`${e.kind}:${e.label}`} className="flex items-center gap-2 text-[0.76rem] text-ink-soft">
          <BasisBadge basis={e.basis} /> Entry point: {e.label}
        </li>
      ))}
    </ul>
  );
}

function FileView({ building, file, model, layout, trace }: { building: BuildingLayout; file: FileNode; model: RepoModel; layout: LayoutResult; trace: TraceState }) {
  const info = ARCHETYPE_INFO[building.archetype];
  return (
    <>
      <Section title="About">
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Badge>
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: languageColor(file.language) }} />
            {languageName(file.language)}
          </Badge>
          <Badge>{CATEGORY_META[file.category].label}</Badge>
          {file.landmark && <Badge tone="amber">{LANDMARK_LABEL[file.landmark]}</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <Fact label="Size" value={formatBytes(file.size)} />
          <Fact label="Folder" value={<span className="font-mono text-[0.8rem]">{file.dirPath || "/"}</span>} />
        </dl>
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-white/[0.05] p-3 text-[0.78rem] leading-relaxed text-ink-soft">
          <span className="mt-0.5 shrink-0 text-ink">
            <ArchetypeGlyph archetype={building.archetype} size={18} color={languageColor(file.language)} />
          </span>
          <span>
            <b className="font-semibold text-ink">{info.name}.</b> {info.meaning}
          </span>
        </p>
        <EntryEvidence file={file} />
      </Section>
      <CodeInspector file={file} />
      <Connections buildingId={building.id} files={[file]} trace={trace} model={model} layout={layout} />
    </>
  );
}

function BlockView({ building, model, layout, trace }: { building: BuildingLayout; model: RepoModel; layout: LayoutResult; trace: TraceState }) {
  const files = useMemo(
    () =>
      building.id === "#overflow"
        ? [...layout.overflowFiles].map((p) => model.filesByPath.get(p)!).filter(Boolean)
        : model.files.filter((f) => f.aggregatedInto === building.id),
    [building, model, layout],
  );
  const langs = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of files) m[f.language] = (m[f.language] ?? 0) + 1;
    return m;
  }, [files]);
  const biggest = useMemo(() => [...files].sort((a, b) => b.size - a.size).slice(0, 6), [files]);
  return (
    <>
      <Section title="City block">
        <p className="text-[0.84rem] leading-relaxed text-ink-soft">
          {building.id === "#overflow" ? (
            <>
              {plural(files.length, "root-level file")} are folded into one block. A repository root this crowded would otherwise outgrow the city.
            </>
          ) : (
            <>
              This folder&apos;s {plural(files.length, "file")} are drawn as a single block, so a city this large stays smooth. Stats and search
              still count every file inside.
            </>
          )}
        </p>
      </Section>
      <Section title="Languages">{languageBar(langs)}</Section>
      <Section title="Largest files">
        <ul className="space-y-1">
          {biggest.map((f) => (
            <li key={f.path} className="flex items-center gap-2 text-[0.8rem]">
              <IconFile size={14} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate font-mono text-[0.74rem]">{f.path.slice(building.id === "#overflow" ? 0 : building.id.length + 1)}</span>
              <span className="text-ink-faint tabular-nums">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Connections buildingId={building.id} files={files} trace={trace} model={model} layout={layout} />
    </>
  );
}

function DistrictView({ dir, model, trace }: { dir: DirNode; model: RepoModel; trace: TraceState }) {
  const flows = useMemo(() => {
    if (trace.status !== "done" || !dir.path) return null;
    const inside = (p: string) => p.startsWith(`${dir.path}/`);
    const out = new Map<string, number>();
    const inn = new Map<string, number>();
    const top = (p: string) => {
      const d = model.filesByPath.get(p)?.dirPath ?? "";
      return d.split("/")[0] || "/";
    };
    for (const e of trace.graph.edges) {
      const a = inside(e.from);
      const b = inside(e.to);
      if (a && !b) out.set(top(e.to), (out.get(top(e.to)) ?? 0) + 1);
      if (!a && b) inn.set(top(e.from), (inn.get(top(e.from)) ?? 0) + 1);
    }
    const sort = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
    return { out: sort(out), inn: sort(inn) };
  }, [trace, dir, model]);

  const categories = Object.fromEntries(Object.entries(dir.stats.categories)) as Record<string, number>;
  const role = useCity((s) => s.analysis?.overview.modules.find((m) => m.path === dir.path)?.role);
  return (
    <>
      <Section title="About">
        {role && (
          <p className="mb-3 flex items-center gap-2 text-[0.8rem] text-ink-soft">
            <BasisBadge basis={role.basis} />
            <span>
              <b className="font-semibold text-ink">{role.label}</b> — {role.reason}
            </span>
          </p>
        )}
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Badge>District</Badge>
          {dir.isPackage && <Badge tone="teal">Package</Badge>}
          {dir.aggregated && <Badge tone="amber">Drawn as one block</Badge>}
        </div>
        <dl className="grid grid-cols-3 gap-3">
          <Fact label="Files" value={formatNumber(dir.stats.files)} />
          <Fact label="Folders" value={formatNumber(dir.stats.dirs)} />
          <Fact label="Size" value={formatBytes(dir.stats.bytes)} />
        </dl>
      </Section>
      <Section title="Languages">{languageBar(dir.stats.languages)}</Section>
      <Section title="Building types">
        <CompositionBar
          data={categories}
          colorFor={(c) => CATEGORY_COLORS[c as keyof typeof CATEGORY_COLORS] ?? "#ccc"}
          labelFor={(c) => CATEGORY_META[c as keyof typeof CATEGORY_META]?.label ?? c}
        />
      </Section>
      {flows && (flows.out.length > 0 || flows.inn.length > 0) && (
        <Section title="Traced flows" aside={<span className="text-[0.68rem] text-ink-faint">file imports</span>}>
          <div className="grid grid-cols-2 gap-3 text-[0.78rem]">
            <div>
              <p className="mb-1 font-semibold text-amber-300">Imports from</p>
              {flows.out.length ? flows.out.map(([d, n]) => <p key={d} className="flex justify-between gap-2"><span className="truncate font-mono">{d}</span><span className="text-ink-faint tabular-nums">{n}</span></p>) : <p className="text-ink-faint">none traced</p>}
            </div>
            <div>
              <p className="mb-1 font-semibold text-teal-300">Imported by</p>
              {flows.inn.length ? flows.inn.map(([d, n]) => <p key={d} className="flex justify-between gap-2"><span className="truncate font-mono">{d}</span><span className="text-ink-faint tabular-nums">{n}</span></p>) : <p className="text-ink-faint">none traced</p>}
            </div>
          </div>
        </Section>
      )}
    </>
  );
}

function OpenSource({ path, dir, primary }: { path: string; dir: boolean; primary?: boolean }) {
  const model = useCity((s) => s.model);
  const symbolId = useCity((s) => s.symbol);
  const symbol = useCity((s) => (symbolId ? s.analysis?.index.files[path]?.symbols.find((x) => x.id === symbolId) : undefined));
  if (!model) return null;
  const link = sourceLink(model, path, { dir, line: symbol?.range.startLine, endLine: symbol?.range.endLine });
  if (!link) return null;
  return (
    <a className={`btn ${primary ? "btn-primary" : "btn-quiet"} px-3.5 py-2 text-[0.8rem]`} href={link.href} target={link.external ? "_blank" : undefined} rel="noopener noreferrer">
      <IconExternal size={15} /> {link.label}
      {symbol ? ` · ${symbol.range.startLine}` : ""}
    </a>
  );
}

export function InfoPanel() {
  const selected = useCity((s) => s.selected);
  const model = useCity((s) => s.model);
  const layout = useCity((s) => s.layout);
  const trace = useCity((s) => s.trace);
  const isolate = useCity((s) => s.isolate);
  const camera = useCity((s) => s.camera);
  const select = useCity((s) => s.select);

  let header: ReactNode = null;
  let body: ReactNode = null;
  let footer: ReactNode = null;
  let label = "Details";

  if (selected && model && layout) {
    if (selected.kind === "building") {
      const index = layout.buildingIndex.get(selected.id);
      const b = index !== undefined ? layout.buildings[index] : null;
      if (b) {
        const file = b.kind === "file" ? model.filesByPath.get(b.id) : undefined;
        const isBlock = b.kind === "block";
        const title = isBlock ? (b.id === "#overflow" ? "More root files" : `${b.id.split("/").pop()}/`) : b.id.split("/").pop()!;
        label = `Details for ${title}`;
        header = (
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg ring-1 ring-white/10" style={{ background: `${languageColor(b.language)}33` }}>
              <ArchetypeGlyph archetype={b.archetype} size={26} color={languageColor(b.language)} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[16px] leading-tight font-semibold tracking-tight" title={b.id}>
                {title}
              </h2>
              {b.id !== "#overflow" && <Breadcrumbs path={b.id} isFile={!isBlock} />}
            </div>
          </div>
        );
        body = file ? (
          <FileView building={b} file={file} model={model} layout={layout} trace={trace} />
        ) : (
          <BlockView building={b} model={model} layout={layout} trace={trace} />
        );
        footer = (
          <div className="flex flex-wrap gap-2">
            {b.id !== "#overflow" && <OpenSource path={b.id} dir={isBlock} primary />}
            {b.id !== "#overflow" && <CopyButton text={b.id} label="Copy path" />}
            <button type="button" className="btn btn-quiet px-3 py-2 text-[0.8rem]" onClick={() => camera?.flyToBuilding(b.id)} title="Focus (C)">
              <IconTarget size={15} /> Focus
            </button>
          </div>
        );
      }
    } else {
      const dir = selected.id === "" ? model.root : model.dirsByPath.get(selected.id);
      if (dir) {
        const title = dir.path ? `${dir.name}/` : model.meta.repo;
        label = `Details for ${title}`;
        header = (
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-ink-soft ring-1 ring-white/10">
              <IconFolder size={24} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[16px] leading-tight font-semibold tracking-tight">{title}</h2>
              {dir.path ? <Breadcrumbs path={dir.path} isFile={false} /> : <p className="font-mono text-[0.74rem] text-ink-faint">repository root</p>}
            </div>
          </div>
        );
        body = <DistrictView dir={dir} model={model} trace={trace} />;
        const isolated = isolate === dir.path;
        footer = (
          <div className="flex flex-wrap gap-2">
            {dir.path && (
              <button
                type="button"
                className={`btn px-3.5 py-2 text-[0.8rem] ${isolated ? "btn-primary" : "btn-quiet"}`}
                onClick={() => useCity.getState().setIsolate(isolated ? null : dir.path)}
                aria-pressed={isolated}
              >
                <IconIsolate size={15} /> {isolated ? "Show everything" : "Isolate"}
              </button>
            )}
            <OpenSource path={dir.path} dir />
            <button type="button" className="btn btn-quiet px-3 py-2 text-[0.8rem]" onClick={() => camera?.flyToDistrict(dir.path)}>
              <IconTarget size={15} /> Focus
            </button>
          </div>
        );
      }
    }
  }

  return (
    <Sheet
      open={Boolean(body)}
      side="right"
      label={label}
      onClose={() => select(null)}
      header={header}
      footer={footer}
      contentKey={selected ? `${selected.kind}:${selected.id}` : undefined}
    >
      {body}
    </Sheet>
  );
}
