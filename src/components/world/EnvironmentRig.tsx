"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useCity } from "@/state/store";
import { CITY_STYLES, type EnvironmentPreset } from "@/theme/cityStyles";
import { blendPreset } from "@/theme/environment";
import { resolveNightFactor } from "@/theme/timeOfDay";
import { worldUniforms } from "./materials";
import { markShadowsDirty } from "./shadows";

/** Values other world components read each frame (sky, ocean, clouds, bloom). */
export const liveEnvironment = {
  night: 0,
  preset: CITY_STYLES.financial.day as EnvironmentPreset,
  sunDirection: new THREE.Vector3(-0.5, 0.6, 0.5).normalize(),
};

export const skyUniforms = {
  uTop: { value: new THREE.Color() },
  uMid: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSun: { value: new THREE.Color() },
  uStars: { value: 0 },
  uNight: { value: 0 },
};

export const oceanUniforms = {
  uShallow: { value: new THREE.Color() },
  uDeep: { value: new THREE.Color() },
  uNight: { value: 0 },
};

const CLOCK_POLL_MS = 1000;

/**
 * Owns the light. It resolves the time mode (auto/day/night) and the city
 * style into one environment, eases towards it, and writes the result into
 * lights, fog, sky, water and the shared material uniforms.
 * Day and night therefore change the whole world coherently, not just the
 * background colour.
 */
export function EnvironmentRig({ size }: { size: number }) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const tier = useCity((s) => s.tier);
  const sun = useMemo(() => {
    const l = new THREE.DirectionalLight("#ffffff", 2.5);
    l.castShadow = true;
    return l;
  }, []);
  const hemi = useMemo(() => new THREE.HemisphereLight("#ffffff", "#444444", 1), []);
  const fog = useMemo(() => new THREE.Fog("#cccccc", 100, 400), []);
  const background = useMemo(() => new THREE.Color(), []);

  const state = useRef<{
    night: number;
    target: number;
    current: EnvironmentPreset | null;
    lastPoll: number;
    sunDistance: number;
  }>({ night: 0, target: 0, current: null, lastPoll: 0, sunDistance: 100 });

  useEffect(() => {
    scene.fog = fog;
    scene.background = background;
    return () => {
      if (scene.fog === fog) scene.fog = null;
      if (scene.background === background) scene.background = null;
    };
  }, [scene, fog, background]);

  // Shadow camera covers the world; resolution follows the performance tier.
  useEffect(() => {
    const half = size * 0.62 + 6;
    const cam = sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = size * 4 + 200;
    cam.updateProjectionMatrix();
    sun.shadow.mapSize.setScalar(tier === "high" ? 4096 : 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    state.current.sunDistance = size * 1.3 + 80;
    markShadowsDirty(2);
  }, [sun, size, tier]);

  const sunDir = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const s = state.current;
    const { timeMode, cityStyle, reducedMotion } = useCity.getState();
    const nowMs = Date.now();
    if (nowMs - s.lastPoll > CLOCK_POLL_MS || s.current === null) {
      s.target = resolveNightFactor(timeMode, new Date(nowMs));
      s.lastPoll = nowMs;
    }
    // Manual switches re-read the mode every frame so they respond instantly.
    if (timeMode !== "auto") s.target = timeMode === "night" ? 1 : 0;

    const dt = Math.min(delta, 0.1);
    const style = CITY_STYLES[cityStyle];
    const first = s.current === null;
    if (first || reducedMotion) s.night = s.target;
    else s.night += (s.target - s.night) * (1 - Math.exp(-dt * 1.5));
    const target = blendPreset(style.day, style.night, s.night);
    const env = first || reducedMotion ? target : blendPreset(s.current!, target, 1 - Math.exp(-dt * 2.4));
    s.current = env;
    liveEnvironment.night = s.night;
    liveEnvironment.preset = env;

    // Lights
    sunDir.setFromSphericalCoords(1, Math.PI / 2 - env.sunElevation, env.sunAzimuth);
    if (sunDir.distanceToSquared(liveEnvironment.sunDirection) > 1e-7) {
      liveEnvironment.sunDirection.copy(sunDir);
      markShadowsDirty();
    }
    sun.position.copy(sunDir).multiplyScalar(s.sunDistance);
    sun.color.set(env.sun);
    sun.intensity = env.sunIntensity;
    hemi.color.set(env.hemiSky);
    hemi.groundColor.set(env.hemiGround);
    hemi.intensity = env.hemiIntensity;
    scene.environmentIntensity = env.envIntensity;

    // Atmosphere
    fog.color.set(env.fog);
    // The haze is tuned for a landscape view of the whole island. A camera
    // further back (a tall phone frame, or zoomed right out) pushes it back too,
    // so the city never sinks into fog.
    const away = camera.position.length();
    const pushBack = Math.max(0, away - size * 1.8);
    // And the far plane keeps the whole island and the sea around it in view.
    const far = Math.max(2600, away * 2.2);
    if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.far - far) > 50) {
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    fog.near = size * env.fogNear + 20 + pushBack;
    fog.far = size * env.fogFar + 160 + pushBack;
    background.set(env.horizon);
    skyUniforms.uTop.value.set(env.skyTop);
    skyUniforms.uMid.value.set(env.skyMid);
    skyUniforms.uHorizon.value.set(env.horizon);
    skyUniforms.uSun.value.set(env.sun);
    skyUniforms.uSunDir.value.copy(sunDir);
    skyUniforms.uStars.value = env.stars;
    skyUniforms.uNight.value = s.night;
    oceanUniforms.uShallow.value.set(env.water);
    oceanUniforms.uDeep.value.set(env.waterDeep);
    oceanUniforms.uNight.value = s.night;

    // Materials
    worldUniforms.uNight.value = s.night;
    worldUniforms.uWindowGlow.value = env.windowGlow;
    worldUniforms.uLitRatio.value = env.litRatio;
    worldUniforms.uWindowLit.value.set(env.windowLit);
    worldUniforms.uStreetGlow.value = env.streetGlow;
    worldUniforms.uStreetLight.value.set(env.streetLight);
    worldUniforms.uAccentBoost.value = 0.82 + 0.75 * s.night;
    worldUniforms.uGlowBoost.value = 0.55 + 1.3 * s.night;
    worldUniforms.uFloor.value = style.facade.floor;
    worldUniforms.uColumn.value = style.facade.column;
  });

  return (
    <>
      <primitive object={hemi} />
      <primitive object={sun} />
      <primitive object={sun.target} />
    </>
  );
}
