"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TreeLayout } from "@/lib/layout/types";
import { createSwayMaterial } from "./materials";
import { markShadowsDirty } from "./shadows";

const FOLIAGE = ["#8cc46c", "#7db95f", "#9fcf74", "#6fae5c", "#a9d27d", "#86bf77"];
const AUTUMN = ["#f0b75e", "#e98b61", "#f2cf6a"];
const PINE = ["#5f9d6a", "#6aa874", "#558f63"];

function crownGeometry(kind: number): THREE.BufferGeometry {
  if (kind === 0) return new THREE.IcosahedronGeometry(0.4, 2).scale(1, 1.08, 1).translate(0, 0.78, 0);
  if (kind === 1) {
    const a = new THREE.ConeGeometry(0.42, 0.62, 10).translate(0, 0.62, 0);
    const b = new THREE.ConeGeometry(0.32, 0.5, 10).translate(0, 0.98, 0);
    const g = mergeGeometries([a, b], false)!;
    a.dispose();
    b.dispose();
    return g;
  }
  const parts = [
    new THREE.IcosahedronGeometry(0.28, 1).translate(0, 0.24, 0),
    new THREE.IcosahedronGeometry(0.22, 1).translate(0.24, 0.18, 0.05),
    new THREE.IcosahedronGeometry(0.2, 1).translate(-0.2, 0.17, -0.08),
  ];
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

function trunkGeometry(kind: number): THREE.BufferGeometry {
  if (kind === 2) return new THREE.CylinderGeometry(0.001, 0.001, 0.001, 3);
  const h = kind === 0 ? 0.55 : 0.36;
  return new THREE.CylinderGeometry(0.05, 0.075, h, 7).translate(0, h / 2, 0);
}

interface TreesProps {
  trees: TreeLayout[];
  leaving?: boolean;
  reducedMotion?: boolean;
  /** Seconds before the first tree appears. */
  delay?: number;
}

/** Stylised trees in three shapes, popping in as the city assembles. */
export function Trees({ trees, leaving = false, reducedMotion = false, delay = 0.2 }: TreesProps) {
  const groups = useMemo(() => {
    const byKind: number[][] = [[], [], []];
    trees.forEach((t, i) => byKind[t.kind].push(i));
    return byKind;
  }, [trees]);

  const geoms = useMemo(
    () => [0, 1, 2].map((k) => ({ crown: crownGeometry(k), trunk: trunkGeometry(k) })),
    [],
  );
  const foliage = useMemo(() => createSwayMaterial(), []);
  const bark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#9b7357", roughness: 0.9 }), []);
  useEffect(
    () => () => {
      geoms.forEach((g) => {
        g.crown.dispose();
        g.trunk.dispose();
      });
      foliage.dispose();
      bark.dispose();
    },
    [geoms, foliage, bark],
  );

  const crowns = useRef<(THREE.InstancedMesh | null)[]>([]);
  const trunks = useRef<(THREE.InstancedMesh | null)[]>([]);

  // Per-tree animation: start time and current scale factor.
  const anim = useMemo(() => {
    const maxR = Math.max(1, ...trees.map((t) => Math.hypot(t.x, t.z)));
    return {
      startAt: trees.map((t) => (reducedMotion ? 0 : delay + (Math.hypot(t.x, t.z) / maxR) * 1.6 + t.variant * 0.35)),
      t0: 0,
      mode: "in" as "in" | "out" | "idle",
      leaveT0: 0,
    };
    // reducedMotion and delay only matter for the first assembly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trees]);

  useLayoutEffect(() => {
    const color = new THREE.Color();
    groups.forEach((members, k) => {
      const crown = crowns.current[k];
      if (!crown) return;
      members.forEach((ti, slot) => {
        const t = trees[ti];
        const palette = k === 1 ? PINE : t.variant > 0.92 ? AUTUMN : FOLIAGE;
        color.set(palette[Math.floor(t.variant * 1000) % palette.length]);
        crown.setColorAt(slot, color);
      });
      if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
      // Hidden until each tree's pop-in begins.
      crown.instanceMatrix.array.fill(0);
      trunks.current[k]?.instanceMatrix.array.fill(0);
    });
    anim.t0 = performance.now() / 1000;
    anim.mode = "in";
  }, [groups, trees, anim]);

  useEffect(() => {
    if (leaving) {
      anim.mode = "out";
      anim.leaveT0 = performance.now() / 1000;
    } else if (anim.mode === "out") {
      // Leave cancelled: grow back.
      anim.mode = "in";
      anim.t0 = performance.now() / 1000 - Math.min(...anim.startAt);
    }
  }, [leaving, anim]);

  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame(() => {
    if (anim.mode === "idle") return;
    const now = performance.now() / 1000;
    let moving = false;
    groups.forEach((members, k) => {
      const crown = crowns.current[k];
      const trunk = trunks.current[k];
      if (!crown || !trunk) return;
      members.forEach((ti, slot) => {
        const t = trees[ti];
        let s: number;
        if (anim.mode === "in") {
          const p = Math.min(1, Math.max(0, (now - anim.t0 - anim.startAt[ti]) / (reducedMotion ? 0.01 : 0.55)));
          if (p < 1) moving = true;
          // Springy overshoot.
          s = p >= 1 ? 1 : 1 - Math.cos(p * Math.PI * 1.5) * Math.exp(-p * 4.2) * (1 - p * 0.25);
          s = Math.max(0, p === 0 ? 0 : s);
        } else {
          const p = Math.min(1, Math.max(0, (now - anim.leaveT0) / (reducedMotion ? 0.01 : 0.45)));
          if (p < 1) moving = true;
          s = 1 - p * p;
        }
        const sc = t.scale * s;
        m.makeScale(sc, sc, sc);
        m.setPosition(t.x, t.y, t.z);
        crown.setMatrixAt(slot, m);
        trunk.setMatrixAt(slot, m);
      });
      crown.instanceMatrix.needsUpdate = true;
      trunk.instanceMatrix.needsUpdate = true;
    });
    markShadowsDirty();
    if (!moving) anim.mode = "idle";
  });

  return (
    <>
      {groups.map((members, k) =>
        members.length === 0 ? null : (
          <group key={`${k}:${members.length}`}>
            <instancedMesh
              ref={(el) => {
                crowns.current[k] = el;
              }}
              args={[geoms[k].crown, foliage, members.length]}
              castShadow
              receiveShadow
              frustumCulled={false}
              raycast={() => {}}
            />
            <instancedMesh
              ref={(el) => {
                trunks.current[k] = el;
              }}
              args={[geoms[k].trunk, bark, members.length]}
              castShadow
              frustumCulled={false}
              raycast={() => {}}
            />
          </group>
        ),
      )}
    </>
  );
}
