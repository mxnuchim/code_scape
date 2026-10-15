"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { RepoModel } from "@/lib/analysis/types";
import type { LayoutResult } from "@/lib/layout/cityLayout";
import { useCity } from "@/state/store";
import { CITY_STYLES } from "@/theme/cityStyles";
import { profileHeight } from "@/lib/layout/styleHeights";
import { Buildings, type BuildingVisualState } from "./Buildings";
import { CameraRig } from "./CameraRig";
import { City } from "./City";
import { Effects } from "./Effects";
import { EnvironmentRig } from "./EnvironmentRig";
import { buildLandingTown } from "./landingTown";
import { Blueprint, Clouds, Island, Ocean, SkyDome } from "./Landscape";
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
  const cityStyle = useCity((s) => s.cityStyle);
  const lens = useCity((s) => s.colorLens);
  const style = CITY_STYLES[cityStyle];

  const town = useMemo(() => buildLandingTown(), []);
  // The landing village follows the chosen style too.
  const townBuildings = useMemo(
    () => town.buildings.map((b) => ({ ...b, height: profileHeight(b.archetype, b.height, style.heights) })),
    [town, style],
  );

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
      <EnvironmentRig size={size} />
      {/* Studio reflections for glass and water; their strength follows the time of day. */}
      <Environment resolution={128} frames={1} environmentIntensity={0.6}>
        <Lightformer intensity={1.6} color="#f4f6f8" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[16, 16, 1]} />
        <Lightformer intensity={1.1} color="#c9dcf2" position={[-8, 2, -5]} scale={[14, 3, 1]} />
        <Lightformer intensity={0.7} color="#f2e2cc" position={[8, 1.5, 5]} scale={[14, 2.5, 1]} />
        <Lightformer intensity={0.35} color="#9aa7b8" position={[0, 1, 9]} scale={[18, 2, 1]} />
      </Environment>

      <SkyDome />
      <Ocean island={island} />
      <Clouds radius={size} reducedMotion={reducedMotion} />
      <Island style={style} island={island} city={rendered?.layout.city ?? null} plaza={rendered?.layout.plaza ?? null} reducedMotion={reducedMotion} />

      <Blueprint width={town.plot.width} depth={town.plot.depth} active={!rendered && (phase === "landing" || phase === "error")} />
      <Blueprint width={island.width - 3} depth={island.depth - 3} active={phase === "loading"} />

      {townMounted && (
        <group>
          <Buildings
            buildings={townBuildings}
            state={STATIC_STATE}
            style={style}
            lens={lens}
            leaving={townLeaving}
            onLeft={() => setTownMounted(false)}
            reducedMotion={reducedMotion}
          />
          <Trees trees={town.trees} leaving={townLeaving} reducedMotion={reducedMotion} delay={0.05} palette={style.trees} />
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
