"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { RepoModel } from "@/lib/analysis/types";
import type { LayoutResult } from "@/lib/layout/cityLayout";
import { useCity } from "@/state/store";
import { WORLD } from "@/theme/palette";
import { Buildings, type BuildingVisualState } from "./Buildings";
import { CameraRig } from "./CameraRig";
import { City } from "./City";
import { Effects } from "./Effects";
import { buildLandingTown } from "./landingTown";
import { Blueprint, Clouds, Island, Ocean, SkyDome, SUN_DIRECTION } from "./Landscape";
import { worldUniforms } from "./materials";
import { consumeShadowDirty, markShadowsDirty } from "./shadows";
import { SignPost } from "./SignPost";
import { Trees } from "./Trees";

const STATIC_STATE: BuildingVisualState = { visible: null, focus: null, hovered: -1 };

function WorldClock() {
  const reducedMotion = useCity((s) => s.reducedMotion);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    markShadowsDirty(2);
  }, [gl]);
  useFrame((_, dt) => {
    if (!reducedMotion) worldUniforms.uTime.value += Math.min(dt, 0.1);
    if (consumeShadowDirty()) gl.shadowMap.needsUpdate = true;
  });
  return null;
}

function Sun({ size, tier }: { size: number; tier: "high" | "low" }) {
  const light = useMemo(() => {
    const l = new THREE.DirectionalLight(WORLD.sun, 2.5);
    l.castShadow = true;
    return l;
  }, []);
  useEffect(() => {
    const half = size * 0.62 + 6;
    const cam = light.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = size * 3 + 160;
    cam.updateProjectionMatrix();
    light.position.copy(SUN_DIRECTION).multiplyScalar(size * 1.2 + 70);
    light.shadow.mapSize.setScalar(tier === "high" ? 4096 : 2048);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.035;
    light.shadow.map?.dispose();
    light.shadow.map = null;
    markShadowsDirty(2);
  }, [light, size, tier]);
  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}

interface RenderedCity {
  key: number;
  model: RepoModel;
  layout: LayoutResult;
}

export function Scene() {
  const phase = useCity((s) => s.phase);
  const layout = useCity((s) => s.layout);
  const model = useCity((s) => s.model);
  const cityKey = useCity((s) => s.cityKey);
  const tier = useCity((s) => s.tier);
  const reducedMotion = useCity((s) => s.reducedMotion);
  const error = useCity((s) => s.error);

  const town = useMemo(() => buildLandingTown(), []);

  // Keep the previous city around while it sinks away.
  const [rendered, setRendered] = useState<RenderedCity | null>(null);
  const live = phase === "city" && layout && model ? { key: cityKey, model, layout } : null;
  if (live && rendered?.key !== live.key) setRendered(live);
  const cityLeaving = !!rendered && rendered.key !== live?.key;

  // The landing village leaves when a city starts loading.
  const townWanted = !rendered && (phase === "landing" || phase === "error");
  const [townMounted, setTownMounted] = useState(true);
  if (townWanted && !townMounted) setTownMounted(true);
  const townLeaving = townMounted && !townWanted;

  const island = rendered?.layout.island ?? town.island;
  const size = Math.max(island.width, island.depth);

  const signText = useMemo(() => {
    if (phase !== "error" || !error) return null;
    switch (error.kind) {
      case "rate-limited":
      case "secondary-rate-limit":
        return "Back soon";
      case "network":
      case "unavailable":
        return "Signal lost";
      case "empty-repo":
      case "nothing-to-build":
        return "Empty plot";
      case "ref-not-found":
        return "Wrong turn";
      default:
        return "No entry";
    }
  }, [phase, error]);

  return (
    <>
      <WorldClock />
      <color attach="background" args={[WORLD.horizon]} />
      <fog attach="fog" args={[WORLD.fog, size * 1.6 + 30, size * 5 + 260]} />
      <hemisphereLight args={[WORLD.hemiSky, WORLD.hemiGround, 1.05]} />
      <Sun size={size} tier={tier} />
      <Environment resolution={64} frames={1} environmentIntensity={0.45}>
        <Lightformer intensity={2} color="#fff1dc" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
        <Lightformer intensity={1.2} color="#cfe5ff" position={[-6, 2, -4]} scale={[10, 4, 1]} />
        <Lightformer intensity={1} color="#ffd8b0" position={[6, 1, 4]} scale={[10, 3, 1]} />
      </Environment>

      <SkyDome />
      <Ocean island={island} />
      <Clouds radius={size} reducedMotion={reducedMotion} />
      <Island island={island} city={rendered?.layout.city ?? null} plaza={rendered?.layout.plaza ?? null} reducedMotion={reducedMotion} />

      <Blueprint width={town.plot.width} depth={town.plot.depth} active={!rendered && (phase === "landing" || phase === "error")} />
      <Blueprint width={island.width - 3} depth={island.depth - 3} active={phase === "loading"} />

      {townMounted && (
        <group>
          <Buildings
            buildings={town.buildings}
            state={STATIC_STATE}
            leaving={townLeaving}
            onLeft={() => setTownMounted(false)}
            reducedMotion={reducedMotion}
          />
          <Trees trees={town.trees} leaving={townLeaving} reducedMotion={reducedMotion} delay={0.05} />
        </group>
      )}

      {rendered && (
        <City
          key={rendered.key}
          model={rendered.model}
          layout={rendered.layout}
          leaving={cityLeaving}
          onLeft={() => setRendered((r) => (r && r.key === rendered.key ? null : r))}
        />
      )}

      {signText && !rendered && (
        <Suspense fallback={null}>
          <SignPost text={signText} tone={signText === "Back soon" ? "wait" : "warn"} reducedMotion={reducedMotion} />
        </Suspense>
      )}

      <CameraRig island={island} cityKey={rendered?.key ?? -1} />
      <Effects tier={tier} />
    </>
  );
}
