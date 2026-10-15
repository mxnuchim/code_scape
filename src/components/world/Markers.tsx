"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { BuildingLayout, PlateLayout } from "@/lib/layout/types";
import { ARCHETYPE_INFO } from "@/lib/layout/archetypes";
import { LANGUAGES } from "@/lib/analysis/languages";
import { WORLD, languageColor } from "@/theme/palette";
import { formatNumber } from "@/lib/format";

const noRaycast = () => {};

/** RTS-style ground ring under a building. */
export function GroundRing({
  building,
  color,
  pulse,
  reducedMotion,
}: {
  building: BuildingLayout;
  color: string;
  pulse: boolean;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const radius = Math.max(building.width, building.depth) * 0.78 + 0.18;
  const born = useMemo(() => performance.now() / 1000, []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = performance.now() / 1000 - born;
    const appear = reducedMotion ? 1 : Math.min(1, t / 0.25);
    const wobble = pulse && !reducedMotion ? 1 + Math.sin(t * 3.2) * 0.05 : 1;
    const s = (0.6 + 0.4 * (1 - (1 - appear) ** 3)) * wobble;
    m.scale.set(s, s, s);
    if (material.current) material.current.opacity = appear * (pulse ? 0.95 : 0.75);
  });
  return (
    <mesh ref={ref} position={[building.x, building.y + 0.03, building.z]} rotation-x={-Math.PI / 2} raycast={noRaycast} renderOrder={4}>
      <ringGeometry args={[radius, radius + (pulse ? 0.16 : 0.1), 48]} />
      <meshBasicMaterial ref={material} color={color} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** A soft column of light that marks the selected building from afar. */
export function Beacon({ building, reducedMotion }: { building: BuildingLayout; reducedMotion: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(WORLD.select) }, uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
          void main(){ float a = (1.0 - vUv.y) * (0.22 + 0.06 * sin(uTime * 2.4 - vUv.y * 8.0)); gl_FragColor = vec4(uColor * a, a); }`,
      }),
    [],
  );
  useFrame((_, dt) => {
    if (!reducedMotion) material.uniforms.uTime.value += dt;
  });
  const top = building.y + building.height + 0.4;
  const h = 14;
  const r = Math.max(building.width, building.depth) * 0.42;
  return (
    <mesh position={[building.x, top + h / 2, building.z]} material={material} raycast={noRaycast} renderOrder={5}>
      <cylinderGeometry args={[r * 0.6, r, h, 24, 1, true]} />
    </mesh>
  );
}

export function PlateBeacon({ plate }: { plate: PlateLayout }) {
  return (
    <mesh position={[plate.x, plate.top + 0.02, plate.z]} rotation-x={-Math.PI / 2} raycast={noRaycast} renderOrder={4}>
      <planeGeometry args={[plate.width, plate.depth_]} />
      <meshBasicMaterial color={WORLD.select} transparent opacity={0.12} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  source: "Source",
  test: "Test",
  config: "Config",
  build: "Build & CI",
  docs: "Docs",
  style: "Styles",
  data: "Data",
  asset: "Asset",
  other: "Other",
};

/** Concise identity label that floats above the hovered building. */
export function HoverLabel({ building, fileCount }: { building: BuildingLayout; fileCount?: number }) {
  const name = building.kind === "block" ? `${building.id.split("/").pop() || building.id}/` : building.id.split("/").pop();
  const lang = LANGUAGES[building.language]?.name ?? building.language;
  const role =
    building.kind === "block"
      ? `${formatNumber(fileCount ?? 0)} files · block`
      : ["townhall", "clocktower", "lighthouse", "monument"].includes(building.archetype)
        ? ARCHETYPE_INFO[building.archetype].name
        : CATEGORY_LABEL[building.category];
  return (
    <Html
      position={[building.x, building.y + building.height + 0.55, building.z]}
      center
      zIndexRange={[30, 20]}
      style={{ pointerEvents: "none" }}
    >
      <div className="hover-pill">
        <span className="hover-dot" style={{ background: languageColor(building.language) }} />
        <span className="hover-name">{name}</span>
        <span className="hover-meta">
          {lang} · {role}
        </span>
      </div>
    </Html>
  );
}

export function PlateHoverLabel({ plate, files }: { plate: PlateLayout; files: number }) {
  return (
    <Html position={[plate.x, plate.top + 0.4, plate.z]} center zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
      <div className="hover-pill">
        <span className="hover-name">{plate.name}/</span>
        <span className="hover-meta">{formatNumber(files)} files</span>
      </div>
    </Html>
  );
}
