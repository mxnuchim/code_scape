"use client";

import { Html, QuadraticBezierLine } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { DependencyGraph } from "@/lib/analysis/imports/trace";
import type { RepoModel } from "@/lib/analysis/types";
import { buildingIdForFile, type LayoutResult } from "@/lib/layout/cityLayout";
import type { BuildingLayout } from "@/lib/layout/types";
import { WORLD } from "@/theme/palette";
import { formatNumber } from "@/lib/format";

const MAX_ARCS_PER_DIRECTION = 48;
const noRaycast = () => {};

/** Files represented by a building: itself, or everything folded into a block. */
export function filesInBuilding(model: RepoModel, layout: LayoutResult, buildingId: string): string[] {
  const index = layout.buildingIndex.get(buildingId);
  if (index === undefined) return [];
  const b = layout.buildings[index];
  if (b.kind === "file") return [b.id];
  if (b.id === "#overflow") return [...layout.overflowFiles];
  return model.files.filter((f) => f.aggregatedInto === b.id).map((f) => f.path);
}

export interface BuildingRelations {
  imports: { id: string; files: number }[];
  importedBy: { id: string; files: number }[];
}

/** Known relationships of a building, mapped to the buildings that draw them. */
export function relationsFor(model: RepoModel, layout: LayoutResult, graph: DependencyGraph, buildingId: string): BuildingRelations {
  const own = filesInBuilding(model, layout, buildingId);
  const collect = (map: Map<string, string[]>) => {
    const counts = new Map<string, number>();
    for (const f of own) {
      for (const other of map.get(f) ?? []) {
        const file = model.filesByPath.get(other);
        if (!file) continue;
        const target = buildingIdForFile(layout, file);
        if (!target || target === buildingId) continue;
        counts.set(target, (counts.get(target) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, files]) => ({ id, files }));
  };
  return { imports: collect(graph.outgoing), importedBy: collect(graph.incoming) };
}

function Arc({
  from,
  to,
  color,
  width,
  lift,
  speed,
  opacity = 1,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
  width: number;
  lift: number;
  speed: number;
  opacity?: number;
}) {
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  const mid = useMemo(() => {
    const m = from.clone().lerp(to, 0.5);
    m.y = Math.max(from.y, to.y) + lift;
    return m;
  }, [from, to, lift]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.material.dashOffset -= dt * speed;
  });
  return (
    <QuadraticBezierLine
      ref={ref as never}
      start={from}
      end={to}
      mid={mid}
      color={color}
      lineWidth={width}
      dashed
      dashSize={0.55}
      gapSize={0.3}
      transparent
      opacity={opacity}
      raycast={noRaycast}
      renderOrder={6}
      toneMapped={false}
    />
  );
}

const top = (b: BuildingLayout) => new THREE.Vector3(b.x, b.y + b.height + 0.15, b.z);

export function SelectionArcs({
  model,
  layout,
  graph,
  selectedId,
  reducedMotion,
}: {
  model: RepoModel;
  layout: LayoutResult;
  graph: DependencyGraph;
  selectedId: string;
  reducedMotion: boolean;
}) {
  const arcs = useMemo(() => {
    const index = layout.buildingIndex.get(selectedId);
    if (index === undefined) return [];
    const self = layout.buildings[index];
    const rel = relationsFor(model, layout, graph, selectedId);
    const out: { key: string; from: THREE.Vector3; to: THREE.Vector3; color: string; lift: number }[] = [];
    const add = (list: { id: string }[], outgoing: boolean) => {
      for (const { id } of list.slice(0, MAX_ARCS_PER_DIRECTION)) {
        const i = layout.buildingIndex.get(id);
        if (i === undefined) continue;
        const other = layout.buildings[i];
        const a = top(self);
        const b = top(other);
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        out.push({
          key: `${outgoing ? "o" : "i"}:${id}`,
          from: outgoing ? a : b,
          to: outgoing ? b : a,
          color: outgoing ? WORLD.importsOut : WORLD.importsIn,
          lift: 1.2 + dist * 0.32,
        });
      }
    };
    add(rel.imports, true);
    add(rel.importedBy, false);
    return out;
  }, [model, layout, graph, selectedId]);

  return (
    <group>
      {arcs.map((a) => (
        <Arc key={a.key} from={a.from} to={a.to} color={a.color} width={2.4} lift={a.lift} speed={reducedMotion ? 0 : 1.6} />
      ))}
    </group>
  );
}

/** District-to-district flows, aggregated from traced imports only. */
export function TransitFlows({
  model,
  layout,
  graph,
  reducedMotion,
}: {
  model: RepoModel;
  layout: LayoutResult;
  graph: DependencyGraph;
  reducedMotion: boolean;
}) {
  const flows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of graph.edges) {
      const fa = model.filesByPath.get(e.from);
      const fb = model.filesByPath.get(e.to);
      if (!fa || !fb) continue;
      const da = fa.dirPath.split("/")[0];
      const db = fb.dirPath.split("/")[0];
      if (da === db) continue;
      const key = `${da}\u0000${db}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const anchor = (district: string) => {
      if (district === "") {
        const p = layout.plaza;
        return p ? new THREE.Vector3(p.x, 1.2, p.z) : new THREE.Vector3(0, 1.2, 0);
      }
      const i = layout.plateIndex.get(district);
      if (i === undefined) return null;
      const p = layout.plates[i];
      return new THREE.Vector3(p.x, p.top + 1.2, p.z);
    };
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 40)
      .map(([key, count]) => {
        const [a, b] = key.split("\u0000");
        const from = anchor(a);
        const to = anchor(b);
        if (!from || !to) return null;
        return { key, from, to, count, a, b, lift: 3 + from.distanceTo(to) * 0.35 };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
  }, [model, layout, graph]);

  const max = Math.max(1, ...flows.map((f) => f.count));
  return (
    <group>
      {flows.map((f, i) => {
        const mid = f.from.clone().lerp(f.to, 0.5);
        mid.y = Math.max(f.from.y, f.to.y) + f.lift * 0.5;
        return (
          <group key={f.key}>
            <Arc
              from={f.from}
              to={f.to}
              color={WORLD.importsOut}
              width={1.4 + (Math.log2(f.count + 1) / Math.log2(max + 1)) * 4}
              lift={f.lift}
              speed={reducedMotion ? 0 : 1.1}
              opacity={0.88}
            />
            {i < 14 && (
              <Html position={mid} center zIndexRange={[15, 10]} style={{ pointerEvents: "none" }}>
                <div className="flow-chip">
                  {f.a || "root"} → {f.b || "root"} <b>{formatNumber(f.count)}</b>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
