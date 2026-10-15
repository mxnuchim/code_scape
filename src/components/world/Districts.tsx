"use client";

import { Line, Text } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LabelLayout, LaneLayout, PlateLayout } from "@/lib/layout/types";
import { DISTRICT_TINTS, WORLD } from "@/theme/palette";
import { roundedRectPoints, slabGeometry } from "./shapes";

const noRaycast = () => {};
const LABEL_FONT = "/fonts/bricolage-700.woff";

function plateRadius(p: PlateLayout) {
  return Math.min(p.depth === 1 ? 0.55 : p.depth === 2 ? 0.32 : 0.2, p.width / 3, p.depth_ / 3);
}

function plateColor(p: PlateLayout, out: THREE.Color): THREE.Color {
  const districtTint = DISTRICT_TINTS[Math.floor(p.tint * DISTRICT_TINTS.length) % DISTRICT_TINTS.length];
  out.set(districtTint);
  if (p.depth > 1) {
    // Nested blocks alternate slightly lighter and darker.
    out.offsetHSL(0, -0.04, p.depth % 2 === 0 ? 0.045 : -0.02);
  }
  if (p.aggregated) out.offsetHSL(0, -0.05, -0.05);
  return out;
}

/** All folder plates merged into one mesh with vertex colours. */
function buildPlatesGeometry(plates: PlateLayout[]): THREE.BufferGeometry | null {
  if (plates.length === 0) return null;
  const color = new THREE.Color();
  const side = new THREE.Color();
  const parts = plates.map((p) => {
    const g = slabGeometry(p.width, p.depth_, plateRadius(p), p.thickness, p.top, Math.min(0.05, p.thickness / 3), 4);
    g.translate(p.x, 0, p.z);
    plateColor(p, color);
    side.copy(color).offsetHSL(0, 0.02, -0.12);
    const normals = g.getAttribute("normal");
    const colors = new Float32Array(normals.count * 3);
    for (let i = 0; i < normals.count; i++) {
      const c = normals.getY(i) > 0.6 ? color : side;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.deleteAttribute("uv");
    return g;
  });
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

interface DistrictsProps {
  plates: PlateLayout[];
  lanes: LaneLayout[];
  labels: LabelLayout[];
  hoveredId: string | null;
  selectedId: string | null;
  isolate: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  revealAt: number;
}

export function Districts({ plates, lanes, labels, hoveredId, selectedId, isolate, onHover, onSelect, revealAt }: DistrictsProps) {
  const geometry = useMemo(() => buildPlatesGeometry(plates), [plates]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  // Invisible boxes for picking: cheaper than raycasting the merged mesh.
  const proxy = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const inst = proxy.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    plates.forEach((p, i) => {
      m.compose(
        new THREE.Vector3(p.x, p.top - p.thickness / 2, p.z),
        new THREE.Quaternion(),
        new THREE.Vector3(p.width, p.thickness, p.depth_),
      );
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
  }, [plates]);

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId === undefined) return;
    e.stopPropagation();
    if (e.pointerType === "touch") return;
    onHover(plates[e.instanceId].id);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId === undefined || e.delta > 6) return;
    e.stopPropagation();
    onSelect(plates[e.instanceId].id);
  };

  const byId = useMemo(() => new Map(plates.map((p) => [p.id, p])), [plates]);
  const hovered = hoveredId ? byId.get(hoveredId) : undefined;
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const isolated = isolate ? byId.get(isolate) : undefined;

  return (
    <group>
      {geometry && (
        <mesh geometry={geometry} receiveShadow raycast={noRaycast}>
          <meshStandardMaterial vertexColors roughness={0.94} />
        </mesh>
      )}
      {plates.length > 0 && (
        <instancedMesh
          key={plates.length}
          ref={proxy}
          args={[undefined, undefined, plates.length]}
          visible={false}
          onPointerMove={onMove}
          onPointerOut={() => onHover(null)}
          onClick={onClick}
        >
          <boxGeometry />
          <meshBasicMaterial />
        </instancedMesh>
      )}
      <Lanes lanes={lanes} />
      {hovered && hovered.id !== selected?.id && <PlateOutline plate={hovered} color="#ffffff" width={2} opacity={0.85} />}
      {selected && <PlateOutline plate={selected} color={WORLD.select} width={3.2} opacity={1} />}
      {isolated && isolated.id !== selected?.id && <PlateOutline plate={isolated} color="#7cc3ff" width={2.4} opacity={0.9} dashed />}
      {/* Text suspends while its font loads; keep that from blanking the world. */}
      <Suspense fallback={null}>
        <DistrictLabels labels={labels} revealAt={revealAt} />
      </Suspense>
    </group>
  );
}

function PlateOutline({ plate, color, width, opacity, dashed = false }: { plate: PlateLayout; color: string; width: number; opacity: number; dashed?: boolean }) {
  const points = useMemo(
    () => roundedRectPoints(plate.x, plate.z, plate.width + 0.08, plate.depth_ + 0.08, plateRadius(plate) + 0.04, plate.top + 0.03),
    [plate],
  );
  return (
    <Line
      points={points}
      color={color}
      lineWidth={width}
      transparent
      opacity={opacity}
      dashed={dashed}
      dashSize={0.4}
      gapSize={0.25}
      raycast={noRaycast}
      renderOrder={3}
    />
  );
}

/** Dashed centre lines on the main avenues between top-level districts. */
function Lanes({ lanes }: { lanes: LaneLayout[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dashes = useMemo(() => {
    const out: { x: number; z: number; horizontal: boolean }[] = [];
    const step = 1.15;
    for (const l of lanes) {
      const len = Math.hypot(l.x2 - l.x1, l.z2 - l.z1);
      const horizontal = Math.abs(l.z2 - l.z1) < 1e-6;
      const n = Math.floor((len - 0.6) / step);
      for (let i = 0; i < n; i++) {
        const t = (0.3 + step * (i + 0.5)) / len;
        out.push({ x: l.x1 + (l.x2 - l.x1) * t, z: l.z1 + (l.z2 - l.z1) * t, horizontal });
      }
    }
    return out;
  }, [lanes]);

  useLayoutEffect(() => {
    const inst = mesh.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    dashes.forEach((d, i) => {
      m.makeScale(d.horizontal ? 0.55 : 0.09, 1, d.horizontal ? 0.09 : 0.55);
      m.setPosition(d.x, 0.045, d.z);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
  }, [dashes]);

  if (dashes.length === 0) return null;
  return (
    <instancedMesh key={dashes.length} ref={mesh} args={[undefined, undefined, dashes.length]} receiveShadow raycast={noRaycast} frustumCulled={false}>
      <boxGeometry args={[1, 0.012, 1]} />
      <meshStandardMaterial color={WORLD.lane} roughness={0.8} />
    </instancedMesh>
  );
}

const MAX_DEEP_LABELS = 90;

/** Folder names painted on the ground. Deeper labels fade in as you get closer. */
function DistrictLabels({ labels, revealAt }: { labels: LabelLayout[]; revealAt: number }) {
  const shown = useMemo(() => {
    const top = labels.filter((l) => l.depth === 1);
    const deep = labels
      .filter((l) => l.depth > 1)
      .sort((a, b) => b.maxWidth - a.maxWidth)
      .slice(0, MAX_DEEP_LABELS);
    return [...top, ...deep];
  }, [labels]);
  const refs = useRef<({ fillOpacity: number } | null)[]>([]);
  const camera = useThree((s) => s.camera);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  // Painted text should never read upside down: flip it when the camera
  // circles round to the far side of the city.
  const [flipped, setFlipped] = useState(false);

  useFrame(() => {
    camera.getWorldDirection(tmp);
    const shouldFlip = tmp.z > 0.15 ? true : tmp.z < -0.15 ? false : flipped;
    if (shouldFlip !== flipped) setFlipped(shouldFlip);
    const t = performance.now() / 1000;
    const reveal = Math.min(1, Math.max(0, (t - revealAt) / 0.8));
    shown.forEach((l, i) => {
      const text = refs.current[i];
      if (!text) return;
      let opacity = 0.74 * reveal;
      if (l.depth > 1) {
        const d = camera.position.distanceTo(tmp.set(l.x, l.y, l.z));
        opacity *= Math.min(1, Math.max(0, (34 - d) / 12));
      }
      if (Math.abs(text.fillOpacity - opacity) > 0.004) text.fillOpacity = opacity;
    });
  });

  return (
    <>
      {shown.map((l, i) => (
        <Text
          key={l.id}
          ref={(el: unknown) => {
            refs.current[i] = el as { fillOpacity: number } | null;
          }}
          font={LABEL_FONT}
          position={[flipped ? l.x + l.maxWidth : l.x, l.y + 0.004, l.z]}
          rotation={[-Math.PI / 2, 0, flipped ? Math.PI : 0]}
          fontSize={l.size}
          anchorX="left"
          anchorY="middle"
          color={WORLD.ink}
          fillOpacity={0}
          letterSpacing={-0.01}
          raycast={noRaycast}
          renderOrder={1}
        >
          {l.text}
        </Text>
      ))}
    </>
  );
}
