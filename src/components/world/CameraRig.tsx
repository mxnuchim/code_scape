"use client";

import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { CityBounds } from "@/lib/layout/types";
import { useCity, type CameraApi } from "@/state/store";
import { styleLayout } from "@/lib/layout/styleHeights";
import { CITY_STYLES } from "@/theme/cityStyles";

/** The current city as the active style draws it (heights matter for framing). */
function styledLayout() {
  const { layout, cityStyle } = useCity.getState();
  return layout ? styleLayout(layout, CITY_STYLES[cityStyle].heights) : null;
}

const { ACTION } = CameraControlsImpl;
const DEFAULT_AZIMUTH = 0.62;
const CITY_POLAR = 1.0;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const sph = new THREE.Spherical();

/** Distance at which a rectangle of ground, seen from (azimuth, polar), fills the view. */
function framingDistance(
  bounds: CityBounds,
  camera: THREE.PerspectiveCamera,
  azimuth: number,
  polar: number,
  maxHeight: number,
  insets: { right: number; bottom: number } = { right: 0, bottom: 0 },
): number {
  const sa = Math.abs(Math.sin(azimuth));
  const ca = Math.abs(Math.cos(azimuth));
  const projW = bounds.width * ca + bounds.depth * sa;
  const projV = (bounds.width * sa + bounds.depth * ca) * Math.cos(polar) + maxHeight * 0.7 * Math.sin(polar);
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;
  // Leave room for the HUD along the top and bottom edges.
  return Math.max(projW / (2 * tanH * (1 - insets.right)), (projV * 1.22) / (2 * tanV * (1 - insets.bottom))) * 1.04;
}

function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/** How much UI covers the canvas, so focused things land in the visible part. */
function overlayInsets() {
  if (typeof window === "undefined") return { right: 0, bottom: 0 };
  const w = window.innerWidth;
  const h = window.innerHeight;
  const { selected, panel } = useCity.getState();
  const hasPanel = Boolean(selected) || panel === "repo";
  if (!hasPanel) return { right: 0, bottom: 0 };
  if (w < 640) return { right: 0, bottom: Math.min(h * 0.46, 420) / h };
  return { right: Math.min(400, w * 0.36) / w, bottom: 0 };
}

function maxBuildingHeight(buildings: { y: number; height: number }[]) {
  let h = 0;
  for (const b of buildings) h = Math.max(h, b.y + b.height);
  return h;
}

interface CameraRigProps {
  island: CityBounds;
  cityKey: number;
}

export function CameraRig({ island, cityKey }: CameraRigProps) {
  const ref = useRef<CameraControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const phase = useCity((s) => s.phase);
  const reducedMotion = useCity((s) => s.reducedMotion);
  const keys = useRef(new Set<string>());
  const interacting = useRef(false);
  const lastInteraction = useRef(0);

  const applyFocalOffset = useCallback(
    (distance: number, transition: boolean) => {
      const c = ref.current;
      if (!c) return;
      const { right, bottom } = overlayInsets();
      const viewH = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const viewW = viewH * camera.aspect;
      // Shift the camera so the focus sits in the middle of the uncovered area.
      void c.setFocalOffset(viewW * right * 0.5, -viewH * bottom * 0.5, 0, transition);
    },
    [camera],
  );

  const frameCity = useCallback(
    (c: CameraControlsImpl, bounds: CityBounds, azimuth: number, maxHeight: number) => {
      const distance = framingDistance(bounds, camera, azimuth, CITY_POLAR, maxHeight);
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cz = (bounds.minZ + bounds.maxZ) / 2;
      v1.setFromSphericalCoords(distance, CITY_POLAR, azimuth).add(v2.set(cx, 0, cz));
      void c.setFocalOffset(0, 0, 0, true);
      void c.setLookAt(v1.x, v1.y, v1.z, cx, 0, cz, true);
    },
    [camera],
  );


  // Public camera API used by the UI.
  useEffect(() => {
    const api: CameraApi = {
      flyToBuilding(id) {
        const c = ref.current;
        const layout = styledLayout();
        if (!c || !layout) return;
        const index = layout.buildingIndex.get(id);
        if (index === undefined) return;
        const b = layout.buildings[index];
        const distance = THREE.MathUtils.clamp(13 + b.height * 1.8 + Math.max(b.width, b.depth) * 3, 15, 40);
        c.getSpherical(sph, true);
        const polar = THREE.MathUtils.clamp(sph.phi, 0.7, 1.05);
        const theta = sph.theta;
        const tx = b.x;
        const ty = b.y + b.height * 0.45;
        const tz = b.z;
        v1.setFromSphericalCoords(distance, polar, theta).add(v2.set(tx, ty, tz));
        void c.setLookAt(v1.x, v1.y, v1.z, tx, ty, tz, true);
        applyFocalOffset(distance, true);
      },
      flyToDistrict(path) {
        const layout = styledLayout();
        if (!layout) return;
        if (path === "") {
          api.overview();
          return;
        }
        const index = layout.plateIndex.get(path);
        const c = ref.current;
        if (index === undefined || !c) return;
        const p = layout.plates[index];
        let maxH = 1;
        for (const b of layout.buildings) {
          if (b.dirPath === path || b.dirPath.startsWith(`${path}/`) || b.id === path) maxH = Math.max(maxH, b.y + b.height);
        }
        const bounds: CityBounds = {
          minX: p.x - p.width / 2,
          maxX: p.x + p.width / 2,
          minZ: p.z - p.depth_ / 2,
          maxZ: p.z + p.depth_ / 2,
          width: p.width,
          depth: p.depth_,
        };
        c.getSpherical(sph, true);
        const polar = THREE.MathUtils.clamp(sph.phi, 0.7, 1.0);
        // A little context around the district, and room for the side panel.
        const distance = Math.max(14, framingDistance(bounds, camera, sph.theta, polar, maxH, overlayInsets()) * 1.15);
        v1.setFromSphericalCoords(distance, polar, sph.theta).add(v2.set(p.x, 0, p.z));
        void c.setLookAt(v1.x, v1.y, v1.z, p.x, 0, p.z, true);
        applyFocalOffset(distance, true);
      },
      overview() {
        const layout = styledLayout();
        const c = ref.current;
        if (!c) return;
        c.getSpherical(sph, true);
        frameCity(c, layout?.city ?? island, sph.theta, layout ? maxBuildingHeight(layout.buildings) : 4);
      },
      zoom(direction) {
        const c = ref.current;
        if (!c) return;
        void c.dolly(direction * c.distance * 0.28, true);
      },
    };
    useCity.setState({ camera: api });
    return () => useCity.setState({ camera: null });
  }, [island, applyFocalOffset, frameCity, camera]);

  // Limits follow the size of the world.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = Math.max(island.width, island.depth);
    c.minDistance = 3.5;
    c.maxDistance = Math.max(60, size * 2.4);
    c.minPolarAngle = 0.12;
    c.maxPolarAngle = 1.3;
    c.dollyToCursor = true;
    c.smoothTime = reducedMotion ? 0.05 : 0.32;
    c.draggingSmoothTime = 0.1;
    c.mouseButtons.left = ACTION.ROTATE;
    c.mouseButtons.right = ACTION.TRUCK;
    c.mouseButtons.middle = ACTION.DOLLY;
    c.mouseButtons.wheel = ACTION.DOLLY;
    c.touches.one = ACTION.TOUCH_ROTATE;
    c.touches.two = ACTION.TOUCH_DOLLY_TRUCK;
    c.touches.three = ACTION.TOUCH_TRUCK;
    c.setBoundary(
      new THREE.Box3(
        new THREE.Vector3(island.minX - 4, -1, island.minZ - 4),
        new THREE.Vector3(island.maxX + 4, 30, island.maxZ + 4),
      ),
    );
  }, [island, reducedMotion]);

  // Phase choreography.
  const introDone = useRef(-1);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = Math.max(island.width, island.depth);
    if (phase === "landing" || phase === "error") {
      c.smoothTime = reducedMotion ? 0.05 : 1.1;
      const distance = size * 1.32;
      v1.setFromSphericalCoords(distance, 1.06, c.azimuthAngle).add(v2.set(0, 0, 0));
      void c.setLookAt(v1.x, v1.y, v1.z, 0, 0, 0, true);
      // Lift the island so the empty plot sits above the hero card.
      const viewH = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const narrow = window.innerWidth < 640;
      void c.setFocalOffset(0, -viewH * (narrow ? 0.2 : 0.13), 0, true);
    } else if (phase === "loading") {
      c.smoothTime = reducedMotion ? 0.05 : 1.4;
      void c.setFocalOffset(0, 0, 0, true);
      v1.setFromSphericalCoords(size * 1.15, 0.62, c.azimuthAngle + 0.3).add(v2.set(0, 0, 0));
      void c.setLookAt(v1.x, v1.y, v1.z, 0, 0, 0, true);
    }
  }, [phase, island, reducedMotion, camera]);

  // A cinematic establishing shot for each new city.
  useEffect(() => {
    if (phase !== "city" || introDone.current === cityKey) return;
    introDone.current = cityKey;
    const c = ref.current;
    const layout = styledLayout();
    if (!c || !layout) return;
    c.smoothTime = reducedMotion ? 0.05 : 1.25;
    frameCity(c, layout.city, c.azimuthAngle + (reducedMotion ? 0 : 0.55), maxBuildingHeight(layout.buildings));
    const restore = window.setTimeout(() => {
      if (ref.current) ref.current.smoothTime = reducedMotion ? 0.05 : 0.32;
    }, 2600);
    return () => window.clearTimeout(restore);
  }, [phase, cityKey, reducedMotion, frameCity]);

  // Keyboard flight.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "+", "=", "-", "_", "shift"].includes(k)) {
        keys.current.add(k);
        if (k.startsWith("arrow")) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useFrame((_, delta) => {
    const c = ref.current;
    if (!c) return;
    const dt = Math.min(delta, 0.05);

    // Gentle drift while nobody is touching anything on the landing page.
    if ((phase === "landing" || phase === "loading" || phase === "error") && !reducedMotion) {
      if (!interacting.current && performance.now() - lastInteraction.current > 2500) {
        void c.rotate(dt * (phase === "loading" ? 0.09 : 0.035), 0, false);
      }
    }

    const k = keys.current;
    if (k.size === 0 || phase !== "city") return;
    if (c.smoothTime > 0.4) c.smoothTime = 0.32;
    const fast = k.has("shift") ? 2.4 : 1;
    const speed = Math.max(4, c.distance * 0.9) * fast * dt;
    let fx = 0;
    let fz = 0;
    if (k.has("w") || k.has("arrowup")) fz -= 1;
    if (k.has("s") || k.has("arrowdown")) fz += 1;
    if (k.has("a") || k.has("arrowleft")) fx -= 1;
    if (k.has("d") || k.has("arrowright")) fx += 1;
    if (fx || fz) {
      const az = c.azimuthAngle;
      const dx = (fx * Math.cos(az) + fz * Math.sin(az)) * speed;
      const dz = (-fx * Math.sin(az) + fz * Math.cos(az)) * speed;
      c.getTarget(v1, true);
      void c.moveTo(v1.x + dx, v1.y, v1.z + dz, true);
    }
    if (k.has("q")) void c.rotate(-1.3 * dt * fast, 0, true);
    if (k.has("e")) void c.rotate(1.3 * dt * fast, 0, true);
    if (k.has("+") || k.has("=")) void c.dolly(c.distance * 1.2 * dt * fast, true);
    if (k.has("-") || k.has("_")) void c.dolly(-c.distance * 1.2 * dt * fast, true);
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      onStart={() => {
        interacting.current = true;
        if (ref.current && ref.current.smoothTime > 0.4) ref.current.smoothTime = 0.32;
      }}
      onEnd={() => {
        interacting.current = false;
        lastInteraction.current = performance.now();
      }}
    />
  );
}

export { DEFAULT_AZIMUTH };
