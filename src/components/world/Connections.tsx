"use client";

import { Html, QuadraticBezierLine } from "@react-three/drei";
import { useEffect, useMemo } from "react";
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

/**
 * A static, directed arc between two points: a line with an arrowhead near the
 * target. Deliberately motionless: it shows a relationship in the code, not
 * traffic. `dashed` marks connections that are uncertain or leave the repository.
 */
export function Arc({
  from,
  to,
  color,
  width,
  lift,
  opacity = 1,
  dashed = false,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
  width: number;
  lift: number;
  opacity?: number;
  dashed?: boolean;
}) {
  const { mid, head, quaternion } = useMemo(() => {
    const m = from.clone().lerp(to, 0.5);
    m.y = Math.max(from.y, to.y) + lift;
    const curve = new THREE.QuadraticBezierCurve3(from, m, to);
    const t = 0.86;
    const tangent = curve.getTangent(t).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    return { mid: m, head: curve.getPoint(t), quaternion: q };
  }, [from, to, lift]);
  return (
    <group>
      <QuadraticBezierLine
        start={from}
        end={to}
        mid={mid}
        color={color}
        lineWidth={width}
        dashed={dashed}
        dashSize={0.45}
        gapSize={0.3}
        transparent
        opacity={opacity}
        raycast={noRaycast}
        renderOrder={6}
        toneMapped={false}
      />
      <mesh position={head} quaternion={quaternion} raycast={noRaycast} renderOrder={7}>
        <coneGeometry args={[0.07 + width * 0.022, 0.32, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={opacity} />
      </mesh>
    </group>
  );
}

export const buildingTop = (b: BuildingLayout) => new THREE.Vector3(b.x, b.y + b.height + 0.15, b.z);

export function SelectionArcs({
  model,
  layout,
  graph,
  selectedId,
}: {
  model: RepoModel;
  layout: LayoutResult;
  graph: DependencyGraph;
  selectedId: string;
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
        const a = buildingTop(self);
        const b = buildingTop(other);
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
        <Arc key={a.key} from={a.from} to={a.to} color={a.color} width={2.2} lift={a.lift} />
      ))}
    </group>
  );
}

/** An illuminated elevated route. It brightens towards the importing side's target. */
function Viaduct({ from, to, lift, radius }: { from: THREE.Vector3; to: THREE.Vector3; lift: number; radius: number }) {
  const geometry = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5);
    mid.y = Math.max(from.y, to.y) + lift;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const g = new THREE.TubeGeometry(curve, 64, radius, 6, false);
    const uv = g.getAttribute("uv");
    const colors = new Float32Array(uv.count * 3);
    const a = new THREE.Color(WORLD.importsIn).multiplyScalar(0.55);
    const b = new THREE.Color(WORLD.importsOut).multiplyScalar(1.35);
    const c = new THREE.Color();
    for (let i = 0; i < uv.count; i++) {
      c.copy(a).lerp(b, uv.getX(i));
      c.toArray(colors, i * 3);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [from, to, lift, radius]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} raycast={noRaycast} renderOrder={6}>
      <meshBasicMaterial vertexColors toneMapped={false} transparent opacity={0.9} />
    </mesh>
  );
}

/**
 * District-to-district transit, aggregated from traced imports only. Routes
 * run above the skyline so they never hide buildings; width shows how many
 * imports a route carries. They are static: nothing here implies runtime traffic.
 */
export function TransitFlows({ model, layout, graph }: { model: RepoModel; layout: LayoutResult; graph: DependencyGraph }) {
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
    let skyline = 4;
    for (const b of layout.buildings) skyline = Math.max(skyline, b.y + b.height);
    const anchor = (district: string) => {
      if (district === "") {
        const p = layout.plaza;
        return p ? new THREE.Vector3(p.x, p.top + 0.4, p.z) : new THREE.Vector3(0, 0.6, 0);
      }
      const i = layout.plateIndex.get(district);
      if (i === undefined) return null;
      const p = layout.plates[i];
      return new THREE.Vector3(p.x, p.top + 0.4, p.z);
    };
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 40)
      .map(([key, count]) => {
        const [a, b] = key.split("\u0000");
        const from = anchor(a);
        const to = anchor(b);
        if (!from || !to) return null;
        // Directed pairs (a→b and b→a) bow to different heights so both stay visible.
        const lift = skyline * 0.95 + from.distanceTo(to) * 0.18 + (a < b ? 0 : 1.6);
        return { key, from, to, count, a, b, lift };
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
            <Viaduct from={f.from} to={f.to} lift={f.lift} radius={0.05 + (Math.log2(f.count + 1) / Math.log2(max + 1)) * 0.16} />
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
