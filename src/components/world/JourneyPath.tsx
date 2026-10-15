"use client";

import { Html } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { Journey } from "@/lib/analysis/code/journeys";
import type { RepoModel } from "@/lib/analysis/types";
import { buildingIdForFile, type LayoutResult } from "@/lib/layout/cityLayout";
import { WORLD } from "@/theme/palette";
import { Arc, buildingTop } from "./Connections";

interface Stop {
  buildingId: string;
  steps: number[];
  position: THREE.Vector3;
  gap: boolean;
}

/** Building ids a journey passes through, so the rest of the city can be dimmed. */
export function journeyBuildings(model: RepoModel, layout: LayoutResult, journey: Journey): Set<string> {
  const ids = new Set<string>();
  for (const s of journey.steps) {
    const file = model.filesByPath.get(s.kind === "external" ? (s.via?.path ?? s.path) : s.path);
    const id = file ? buildingIdForFile(layout, file) : undefined;
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * A code journey drawn over the city: numbered stops on the buildings that
 * take part, static arcs from each caller to its callee, and a dashed rising
 * line where the code leaves the repository. Nothing moves along it: it is a
 * map of call sites, not traffic.
 */
export function JourneyPath({ model, layout, journey, step }: { model: RepoModel; layout: LayoutResult; journey: Journey; step: number }) {
  const { stops, arcs, exits } = useMemo(() => {
    const where = (path: string) => {
      const file = model.filesByPath.get(path);
      const id = file ? buildingIdForFile(layout, file) : undefined;
      const i = id !== undefined ? layout.buildingIndex.get(id) : undefined;
      return i !== undefined ? layout.buildings[i] : null;
    };
    const gapSteps = new Set(journey.gaps.map((g) => g.atStep));
    const stopMap = new Map<string, Stop>();
    const arcs: { key: string; from: THREE.Vector3; to: THREE.Vector3; lift: number; index: number }[] = [];
    const exits: { key: string; from: THREE.Vector3; label: string; index: number }[] = [];

    for (const s of journey.steps) {
      if (s.kind === "external") {
        const b = s.via ? where(s.via.path) : null;
        if (b) exits.push({ key: `x${s.index}`, from: buildingTop(b), label: s.module ?? "package", index: s.index });
        continue;
      }
      const b = where(s.path);
      if (!b) continue;
      const stop = stopMap.get(b.id) ?? { buildingId: b.id, steps: [], position: buildingTop(b).add(new THREE.Vector3(0, 0.9, 0)), gap: false };
      stop.steps.push(s.index);
      if (gapSteps.has(s.index)) stop.gap = true;
      stopMap.set(b.id, stop);
      if (s.via) {
        const from = where(s.via.path);
        if (from && from.id !== b.id) {
          const a = buildingTop(from);
          const c = buildingTop(b);
          arcs.push({ key: `a${s.index}`, from: a, to: c, lift: 1 + Math.hypot(a.x - c.x, a.z - c.z) * 0.28, index: s.index });
        }
      }
    }
    return { stops: [...stopMap.values()], arcs, exits };
  }, [model, layout, journey]);

  return (
    <group>
      {arcs.map((a) => (
        <Arc key={a.key} from={a.from} to={a.to} color={WORLD.journey} width={a.index === step ? 3.4 : 2.2} lift={a.lift} opacity={a.index <= step ? 1 : 0.45} />
      ))}
      {exits.map((x) => {
        const to = x.from.clone().add(new THREE.Vector3(0.8, 3.2, 0.8));
        return (
          <group key={x.key}>
            <Arc from={x.from} to={to} color={WORLD.journey} width={1.6} lift={0.6} dashed opacity={x.index <= step ? 0.9 : 0.4} />
            <Html position={to} center zIndexRange={[16, 11]} style={{ pointerEvents: "none" }}>
              <div className="journey-exit">→ {x.label}</div>
            </Html>
          </group>
        );
      })}
      {stops.map((s) => {
        const current = s.steps.includes(step);
        return (
          <Html key={s.buildingId} position={s.position} center zIndexRange={[17, 12]} style={{ pointerEvents: "none" }}>
            <div className={`journey-stop ${current ? "is-current" : ""} ${s.gap ? "has-gap" : ""}`}>{s.steps.map((n) => n + 1).join(" · ")}</div>
          </Html>
        );
      })}
    </group>
  );
}
