"use client";

import { useEffect, useMemo, useState } from "react";
import type { RepoModel } from "@/lib/analysis/types";
import type { LayoutResult } from "@/lib/layout/cityLayout";
import { useCity } from "@/state/store";
import { Buildings, type BuildingVisualState } from "./Buildings";
import { Districts } from "./Districts";
import { Trees } from "./Trees";
import { Beacon, GroundRing, HoverLabel, PlateHoverLabel } from "./Markers";
import { SelectionArcs, TransitFlows, relationsFor } from "./Connections";
import { JourneyPath, journeyBuildings } from "./JourneyPath";
import { WORLD } from "@/theme/palette";
import { CITY_STYLES } from "@/theme/cityStyles";
import { styleLayout } from "@/lib/layout/styleHeights";
import { Streetlights } from "./Streetlights";

interface CityProps {
  model: RepoModel;
  layout: LayoutResult;
  leaving: boolean;
  onLeft: () => void;
}

function inFolder(dirPath: string, id: string, kind: "file" | "block", folder: string) {
  if (folder === "") return true;
  const prefix = `${folder}/`;
  if (dirPath === folder || dirPath.startsWith(prefix)) return true;
  return kind === "block" && (id === folder || id.startsWith(prefix));
}

export function City({ model, layout: baseLayout, leaving, onLeft }: CityProps) {
  const cityStyle = useCity((s) => s.cityStyle);
  const lens = useCity((s) => s.colorLens);
  const style = CITY_STYLES[cityStyle];
  // Same buildings, same places; only heights are reinterpreted by the style.
  const layout = useMemo(() => styleLayout(baseLayout, style.heights), [baseLayout, style]);
  const trees = useMemo(
    () => layout.trees.filter((t) => ((t.variant * 7.13) % 1) < style.trees.density),
    [layout, style],
  );
  const hovered = useCity((s) => s.hovered);
  const selected = useCity((s) => s.selected);
  const hiddenCategories = useCity((s) => s.hiddenCategories);
  const hiddenLanguages = useCity((s) => s.hiddenLanguages);
  const isolate = useCity((s) => s.isolate);
  const trace = useCity((s) => s.trace);
  const transit = useCity((s) => s.transit);
  const journey = useCity((s) => s.journey);
  const reducedMotion = useCity((s) => s.reducedMotion);
  const hover = useCity((s) => s.hover);
  const select = useCity((s) => s.select);
  const [revealAt] = useState(() => performance.now() / 1000 + Math.min(layout.assemblyDuration * 0.6, 1.6));

  const graph = trace.status === "done" ? trace.graph : null;

  // Mark the city as assembled once the last building has risen.
  useEffect(() => {
    const t = window.setTimeout(() => useCity.setState({ assembled: true, stage: null }), reducedMotion ? 50 : layout.assemblyDuration * 1000);
    return () => window.clearTimeout(t);
  }, [layout, reducedMotion]);

  const visible = useMemo(() => {
    if (hiddenCategories.size === 0 && hiddenLanguages.size === 0 && isolate === null) return null;
    const arr = new Uint8Array(layout.buildings.length);
    layout.buildings.forEach((b, i) => {
      const ok =
        !hiddenCategories.has(b.category) &&
        !hiddenLanguages.has(b.language) &&
        (isolate === null || inFolder(b.dirPath, b.id, b.kind, isolate));
      arr[i] = ok ? 1 : 0;
    });
    return arr;
  }, [layout, hiddenCategories, hiddenLanguages, isolate]);

  const journeyIds = useMemo(() => (journey ? journeyBuildings(model, layout, journey.journey) : null), [journey, model, layout]);

  const focus = useMemo(() => {
    // While a journey plays, only its buildings stay bright.
    if (journeyIds && journeyIds.size > 0) return journeyIds;
    if (!selected) return null;
    if (selected.kind === "district") {
      const ids = new Set<string>();
      for (const b of layout.buildings) if (inFolder(b.dirPath, b.id, b.kind, selected.id)) ids.add(b.id);
      return ids;
    }
    if (!graph) return null;
    const rel = relationsFor(model, layout, graph, selected.id);
    if (rel.imports.length === 0 && rel.importedBy.length === 0) return null;
    return new Set([selected.id, ...rel.imports.map((r) => r.id), ...rel.importedBy.map((r) => r.id)]);
  }, [selected, graph, model, layout, journeyIds]);

  const hoveredIndex = hovered?.kind === "building" ? (layout.buildingIndex.get(hovered.id) ?? -1) : -1;
  const visualState = useMemo<BuildingVisualState>(
    () => ({ visible, focus, hovered: hoveredIndex }),
    [visible, focus, hoveredIndex],
  );

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  const hoveredBuilding = hoveredIndex >= 0 ? layout.buildings[hoveredIndex] : null;
  const selectedIndex = selected?.kind === "building" ? layout.buildingIndex.get(selected.id) : undefined;
  const selectedBuilding = selectedIndex !== undefined ? layout.buildings[selectedIndex] : null;
  const hoveredPlate =
    hovered?.kind === "district" && layout.plateIndex.has(hovered.id) ? layout.plates[layout.plateIndex.get(hovered.id)!] : null;

  const blockFiles = (id: string) => model.dirsByPath.get(id)?.stats.files ?? (id === "#overflow" ? layout.overflowFiles.size : 0);

  return (
    <group>
      <Districts
        style={style}
        plates={layout.plates}
        lanes={layout.lanes}
        labels={layout.labels}
        hoveredId={hovered?.kind === "district" ? hovered.id : null}
        selectedId={selected?.kind === "district" ? selected.id : null}
        isolate={isolate}
        onHover={(id) => !leaving && hover(id ? { kind: "district", id } : null)}
        onSelect={(id) => !leaving && select({ kind: "district", id })}
        revealAt={revealAt}
      />
      <Buildings
        buildings={layout.buildings}
        state={visualState}
        style={style}
        lens={lens}
        interactive={!leaving}
        leaving={leaving}
        onLeft={onLeft}
        reducedMotion={reducedMotion}
        onHover={(i) => hover(i === null ? null : { kind: "building", id: layout.buildings[i].id })}
        onSelect={(i) => select({ kind: "building", id: layout.buildings[i].id })}
      />
      <Trees trees={trees} leaving={leaving} reducedMotion={reducedMotion} palette={style.trees} />
      <Streetlights lamps={layout.lamps} top={0.04} />

      {!leaving && hoveredBuilding && hoveredBuilding.id !== selectedBuilding?.id && (
        <>
          <GroundRing key={`h:${hoveredBuilding.id}`} building={hoveredBuilding} color={WORLD.hover} pulse={false} reducedMotion={reducedMotion} />
          <HoverLabel building={hoveredBuilding} fileCount={blockFiles(hoveredBuilding.id)} />
        </>
      )}
      {!leaving && hoveredPlate && !hoveredBuilding && (
        <PlateHoverLabel plate={hoveredPlate} files={model.dirsByPath.get(hoveredPlate.id)?.stats.files ?? 0} />
      )}
      {!leaving && selectedBuilding && (
        <>
          <GroundRing key={`s:${selectedBuilding.id}`} building={selectedBuilding} color={WORLD.select} pulse reducedMotion={reducedMotion} />
          <Beacon building={selectedBuilding} reducedMotion={reducedMotion} />
        </>
      )}
      {!leaving && journey && <JourneyPath model={model} layout={layout} journey={journey.journey} step={journey.step} />}
      {!leaving && !journey && graph && selectedBuilding && <SelectionArcs model={model} layout={layout} graph={graph} selectedId={selectedBuilding.id} />}
      {!leaving && !journey && graph && transit && !selectedBuilding && <TransitFlows model={model} layout={layout} graph={graph} />}
    </group>
  );
}
