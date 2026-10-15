"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CityBounds, LotLayout } from "@/lib/layout/types";
import { WORLD } from "@/theme/palette";
import { worldUniforms } from "./materials";
import { markShadowsDirty } from "./shadows";
import { slabGeometry } from "./shapes";

export const WATER_LEVEL = -0.42;
const SHELF = 1.8;
const noRaycast = () => {};

export const SUN_DIRECTION = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();

/* ------------------------------------------------------------------ Sky -- */

export function SkyDome() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(WORLD.skyTop) },
          uMid: { value: new THREE.Color(WORLD.skyMid) },
          uHorizon: { value: new THREE.Color(WORLD.horizon) },
          uSunDir: { value: SUN_DIRECTION.clone() },
          uSun: { value: new THREE.Color(WORLD.sun) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * p;
            gl_Position.z = gl_Position.w; // pin to the far plane
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSun;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, -1.0, 1.0);
            vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
            col = mix(col, uTop, smoothstep(0.2, 0.75, h));
            col = mix(col, uHorizon, smoothstep(0.0, -0.2, h));
            float sun = max(dot(normalize(vDir), uSunDir), 0.0);
            col += uSun * (pow(sun, 18.0) * 0.35 + pow(sun, 400.0) * 0.6);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} raycast={noRaycast} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[900, 32, 16]} />
    </mesh>
  );
}

/* ---------------------------------------------------------------- Ocean -- */

export function Ocean({ island }: { island: CityBounds }) {
  const uniforms = useMemo(
    () => ({
      uIsland: { value: new THREE.Vector4(0, 0, 10, 10) },
      uShallow: { value: new THREE.Color(WORLD.water) },
      uDeep: { value: new THREE.Color(WORLD.waterDeep) },
    }),
    [],
  );
  const target = useRef(new THREE.Vector4());
  useEffect(() => {
    target.current.set(
      (island.minX + island.maxX) / 2,
      (island.minZ + island.maxZ) / 2,
      island.width / 2 + SHELF,
      island.depth / 2 + SHELF,
    );
  }, [island]);

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.05 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = worldUniforms.uTime;
      shader.uniforms.uIsland = uniforms.uIsland;
      shader.uniforms.uShallow = uniforms.uShallow;
      shader.uniforms.uDeep = uniforms.uDeep;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;")
        .replace(
          "#include <worldpos_vertex>",
          "#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float uTime; uniform vec4 uIsland; uniform vec3 uShallow; uniform vec3 uDeep;
           varying vec3 vWorld;
           float sdRoundRect(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           vec2 rel = vWorld.xz - uIsland.xy;
           float dist = sdRoundRect(rel, uIsland.zw, 4.0);
           float depthMix = smoothstep(0.0, 26.0, dist);
           vec3 water = mix(uShallow, uDeep, depthMix);
           float ripple = sin(vWorld.x * 0.35 + uTime * 0.7) * sin(vWorld.z * 0.28 - uTime * 0.55);
           float glints = smoothstep(0.82, 1.0, ripple) * (1.0 - depthMix * 0.6);
           water += glints * 0.07;
           float wave = 0.5 + 0.5 * sin(dist * 2.4 - uTime * 1.6);
           float foam = (1.0 - smoothstep(0.0, 0.55 + wave * 0.35, dist)) * step(-0.2, dist);
           float foam2 = (1.0 - smoothstep(0.0, 0.16, abs(dist - 1.3 - wave * 0.5))) * 0.45 * (1.0 - smoothstep(1.0, 2.6, dist));
           water = mix(water, vec3(1.0, 0.99, 0.95), clamp(foam + foam2, 0.0, 1.0) * 0.85);
           diffuseColor.rgb = water;`,
        );
    };
    m.customProgramCacheKey = () => "sc-ocean-v1";
    return m;
  }, [uniforms]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, delta) => {
    // Ease the shoreline when the island changes size.
    uniforms.uIsland.value.lerp(target.current, 1 - Math.exp(-delta * 4));
  });

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={WATER_LEVEL} material={material} receiveShadow raycast={noRaycast}>
      <planeGeometry args={[2400, 2400, 1, 1]} />
    </mesh>
  );
}

/* --------------------------------------------------------------- Island -- */

interface IslandProps {
  island: CityBounds;
  city: CityBounds | null;
  plaza: LotLayout | null;
  reducedMotion: boolean;
}

/**
 * The ground the city stands on: a grassy island with a sand shelf. In city
 * mode it also has a road surface. When the island changes size it morphs
 * smoothly instead of popping.
 */
export function Island({ island, city, plaza, reducedMotion }: IslandProps) {
  const group = useRef<THREE.Group>(null);
  const morph = useRef({ fromX: 1, fromZ: 1, t: 1 });
  const prevSize = useRef<{ w: number; d: number } | null>(null);

  const geoms = useMemo(() => {
    const cx = (island.minX + island.maxX) / 2;
    const cz = (island.minZ + island.maxZ) / 2;
    const grass = slabGeometry(island.width, island.depth, 4, 1.4, 0, 0.22, 10).translate(cx, 0, cz);
    const sand = slabGeometry(island.width + SHELF * 2, island.depth + SHELF * 2, 5.2, 3.2, -0.22, 0.35, 10).translate(cx, 0, cz);
    let road: THREE.BufferGeometry | null = null;
    if (city) {
      road = slabGeometry(city.width + 0.2, city.depth + 0.2, 0.9, 0.3, 0.04, 0.04, 6).translate(
        (city.minX + city.maxX) / 2,
        0,
        (city.minZ + city.maxZ) / 2,
      );
    }
    const plazaGeom = plaza ? slabGeometry(plaza.width, plaza.depth, 0.5, 0.2, plaza.top, 0.03, 6).translate(plaza.x, 0, plaza.z) : null;
    return { grass, sand, road, plaza: plazaGeom };
  }, [island, city, plaza]);

  useEffect(
    () => () => {
      geoms.grass.dispose();
      geoms.sand.dispose();
      geoms.road?.dispose();
      geoms.plaza?.dispose();
    },
    [geoms],
  );

  useEffect(() => {
    const prev = prevSize.current;
    prevSize.current = { w: island.width, d: island.depth };
    if (!prev || reducedMotion) return;
    morph.current = { fromX: prev.w / island.width, fromZ: prev.d / island.depth, t: 0 };
  }, [island, reducedMotion]);

  useFrame((_, delta) => {
    const m = morph.current;
    if (m.t >= 1 || !group.current) return;
    m.t = Math.min(1, m.t + delta / 1.1);
    const e = 1 - (1 - m.t) ** 3;
    group.current.scale.set(m.fromX + (1 - m.fromX) * e, 1, m.fromZ + (1 - m.fromZ) * e);
    markShadowsDirty();
  });

  return (
    <group ref={group}>
      <mesh geometry={geoms.sand} receiveShadow raycast={noRaycast}>
        <meshStandardMaterial color={WORLD.sand} roughness={0.95} />
      </mesh>
      <mesh geometry={geoms.grass} receiveShadow raycast={noRaycast}>
        <meshStandardMaterial color={WORLD.grass} roughness={0.95} />
      </mesh>
      {geoms.road && (
        <mesh geometry={geoms.road} receiveShadow raycast={noRaycast}>
          <meshStandardMaterial color={WORLD.road} roughness={0.92} />
        </mesh>
      )}
      {geoms.plaza && (
        <mesh geometry={geoms.plaza} receiveShadow raycast={noRaycast}>
          <meshStandardMaterial color={WORLD.plaza} roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

/* ------------------------------------------------------------ Blueprint -- */

/** A glowing survey grid laid over the ground while a city is being planned. */
export function Blueprint({ width, depth, active }: { width: number; depth: number; active: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: worldUniforms.uTime, uOpacity: { value: 0 }, uSize: { value: new THREE.Vector2(width, depth) } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uOpacity; uniform vec2 uSize;
          varying vec2 vUv;
          void main() {
            vec2 p = (vUv - 0.5) * uSize;
            vec2 g = abs(fract(p / 1.7 - 0.5) - 0.5) / fwidth(p / 1.7);
            float line = 1.0 - min(min(g.x, g.y), 1.0);
            vec2 g2 = abs(fract(p / 6.8 - 0.5) - 0.5) / fwidth(p / 6.8);
            float major = 1.0 - min(min(g2.x, g2.y), 1.0);
            float r = length(p) / (0.5 * max(uSize.x, uSize.y));
            float sweep = smoothstep(0.18, 0.0, abs(fract(r - uTime * 0.35) - 0.5) - 0.32);
            vec2 edge = smoothstep(vec2(0.0), vec2(0.08), vUv) * smoothstep(vec2(0.0), vec2(0.08), 1.0 - vUv);
            float a = (line * 0.35 + major * 0.55) * (0.55 + sweep * 0.9) * edge.x * edge.y;
            gl_FragColor = vec4(vec3(0.93, 0.98, 1.0), a * uOpacity);
          }`,
      }),
    [width, depth],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    const target = active ? 1 : 0;
    const u = material.uniforms.uOpacity;
    u.value += (target - u.value) * (1 - Math.exp(-delta * 3));
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.06} material={material} raycast={noRaycast} renderOrder={2}>
      <planeGeometry args={[width, depth]} />
    </mesh>
  );
}

/* --------------------------------------------------------------- Clouds -- */

function puffGeometry(): THREE.BufferGeometry {
  const puffs: [number, number, number, number][] = [
    [0, 0, 0, 1.2],
    [1.3, -0.2, 0.2, 0.9],
    [-1.25, -0.25, -0.1, 0.85],
    [0.5, 0.45, -0.3, 0.8],
    [-0.4, 0.3, 0.4, 0.75],
    [2.1, -0.45, 0, 0.55],
    [-2, -0.5, 0.15, 0.5],
  ];
  const parts = puffs.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 2).translate(x, y, z));
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  g.scale(1, 0.62, 0.8);
  return g;
}

export function Clouds({ radius, reducedMotion }: { radius: number; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = 18;
  const geometry = useMemo(() => puffGeometry(), []);
  const seeds = useMemo(() => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: count }, () => ({
      angle: rnd() * Math.PI * 2,
      dist: 0.75 + rnd() * 1.1,
      height: 20 + rnd() * 26,
      scale: 1.8 + rnd() * 2.6,
      speed: 0.25 + rnd() * 0.35,
      stretch: 1 + rnd() * 0.8,
    }));
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const m = useMemo(() => new THREE.Matrix4(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const R = Math.max(70, radius * 1.4);

  useFrame(({ clock }) => {
    const inst = mesh.current;
    if (!inst) return;
    const t = reducedMotion ? 0 : clock.elapsedTime;
    seeds.forEach((c, i) => {
      const span = R * 2.4;
      const baseX = Math.cos(c.angle) * R * c.dist;
      const x = ((((baseX + t * c.speed + span / 2) % span) + span) % span) - span / 2;
      const z = Math.sin(c.angle) * R * c.dist;
      pos.set(x, c.height, z);
      scl.set(c.scale * c.stretch, c.scale, c.scale);
      m.compose(pos, quat, scl);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, count]} frustumCulled={false} raycast={noRaycast}>
      <meshStandardMaterial color="#ffffff" emissive="#ffe9d6" emissiveIntensity={0.38} roughness={1} />
    </instancedMesh>
  );
}
