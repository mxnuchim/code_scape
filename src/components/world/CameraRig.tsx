"use client";

import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { CityBounds } from "@/lib/layout/types";
import { useCity, type CameraApi } from "@/state/store";
import { styleLayout } from "@/lib/layout/styleHeights";
import { CITY_STYLES } from "@/theme/cityStyles";
import { aerialView } from "@/lib/camera/aerialView";
import { keysOwnedElsewhere } from "@/components/keyboardFocus";

/** The current city as the active style draws it (heights matter for framing). */
function styledLayout() {
  const { layout, cityStyle } = useCity.getState();
  return layout ? styleLayout(layout, CITY_STYLES[cityStyle].heights) : null;
}

const { ACTION } = CameraControlsImpl;
const DEFAULT_AZIMUTH = 0.62;
/** Tilt limits: almost straight down, to a low view just above the rooftops. Never under the ground. */
const MIN_POLAR = 0.02;
const MAX_POLAR = 1.42;
const SMOOTH = 0.32;

/** Physical keys the camera flies with (by `KeyboardEvent.code`, so held keys release cleanly with Shift). */
const FLIGHT_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "KeyQ", "KeyE", "KeyR", "KeyF", "PageUp", "PageDown",
  "Equal", "Minus", "NumpadAdd", "NumpadSubtract", "ShiftLeft", "ShiftRight",
]);

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

/** UI over the canvas that the opening view frames around: the guide (left), a panel (right), a sheet (below). */
function openingInsets() {
  const w = window.innerWidth;
  const { right, bottom } = overlayInsets();
  // The guide is a 390 px sheet, 16 px in from the left edge, on screens wider than a phone.
  const left = w >= 640 && useCity.getState().panel === "guide" ? (Math.min(390, w - 32) + 16) / w : 0;
  return { left, right, bottom };
}

function maxBuildingHeight(buildings: { y: number; height: number }[]) {
  let h = 0;
  for (const b of buildings) h = Math.max(h, b.y + b.height);
  return h;
}

/**
 * The opening shot: a low three-quarter aerial view across the whole island
 * from one corner, fitted exactly to the island and its towers (see aerialView).
 */
function openingView(camera: THREE.PerspectiveCamera, island: CityBounds) {
  const layout = styledLayout();
  const points = layout ? layout.buildings.map((b) => ({ x: b.x, y: b.y + b.height, z: b.z })) : [];
  const half = Math.max(1, window.innerHeight / 2);
  // Keep the top bar and the bottom controls clear.
  const narrow = window.innerWidth < 640;
  const edge = narrow ? 0.04 : 0.08;
  const covered = openingInsets();
  // A landscape frame shows the whole island. A portrait one is width-bound, so
  // it frames the built-up area and lets the island's green ring run off the sides.
  let ground: CityBounds = layout?.island ?? island;
  if (layout && camera.aspect < 1) {
    const pad = Math.max(layout.city.width, layout.city.depth) * 0.06;
    ground = {
      ...layout.city,
      minX: layout.city.minX - pad,
      maxX: layout.city.maxX + pad,
      minZ: layout.city.minZ - pad,
      maxZ: layout.city.maxZ + pad,
    };
  }
  return aerialView({
    ground,
    points,
    fov: camera.fov,
    aspect: camera.aspect,
    // Margins are fractions of the half-frame, so a panel covering a fraction f of the width costs 2f.
    margin: {
      left: Math.min(0.9, edge + 2 * covered.left),
      right: Math.min(0.9, edge + 2 * covered.right),
      top: Math.min(0.3, 72 / half),
      bottom: Math.min(0.9, 76 / half + 2 * covered.bottom),
    },
  });
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
  /** True while the camera rests on the opening view, untouched; it then follows panels opening and closing. */
  const atOpening = useRef(false);

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

  /** Fly (or cut, under reduced motion) to the opening view. */
  const goToOpening = useCallback(
    (c: CameraControlsImpl, transition: boolean) => {
      const view = openingView(camera, island);
      // A tall phone frame can need more room than the usual zoom-out limit.
      c.maxDistance = Math.max(c.maxDistance, view.distance * 1.3);
      void c.setFocalOffset(0, 0, 0, transition);
      void c.setLookAt(view.position.x, view.position.y, view.position.z, view.target.x, view.target.y, view.target.z, transition);
      // Take the short way round, however many turns the loading spin made.
      c.normalizeRotations();
      atOpening.current = true;
    },
    [camera, island],
  );

  /** Ease a camera move over `seconds`, then return to the normal responsiveness. */
  const slowRestore = useRef<number | undefined>(undefined);
  const easeOver = useCallback(
    (c: CameraControlsImpl, seconds: number) => {
      window.clearTimeout(slowRestore.current);
      c.smoothTime = reducedMotion ? 0 : seconds;
      slowRestore.current = window.setTimeout(() => {
        if (ref.current) ref.current.smoothTime = reducedMotion ? 0.05 : SMOOTH;
      }, seconds * 2000 + 200);
    },
    [reducedMotion],
  );
  useEffect(() => () => window.clearTimeout(slowRestore.current), []);

  // Public camera API used by the UI.
  useEffect(() => {
    const api: CameraApi = {
      flyToBuilding(id) {
        atOpening.current = false;
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
        atOpening.current = false;
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
        const c = ref.current;
        if (!c) return;
        easeOver(c, 0.6);
        goToOpening(c, !reducedMotion);
      },
      zoom(direction) {
        atOpening.current = false;
        const c = ref.current;
        if (!c) return;
        void c.dolly(direction * c.distance * 0.28, true);
      },
    };
    useCity.setState({ camera: api });
    return () => useCity.setState({ camera: null });
  }, [island, applyFocalOffset, goToOpening, easeOver, reducedMotion, camera]);

  // Limits follow the size of the world: never under the ground, never far past the island.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = Math.max(island.width, island.depth);
    const layout = styledLayout();
    const tallest = layout ? maxBuildingHeight(layout.buildings) : 0;
    const slack = Math.max(6, size * 0.3);
    c.minDistance = 3.5;
    // Room to zoom out a little past the opening view, which a tall phone frame pushes far back.
    c.maxDistance = Math.max(60, size * 2.6, phase === "city" ? openingView(camera, island).distance * 1.3 : 0);
    c.minPolarAngle = MIN_POLAR;
    c.maxPolarAngle = MAX_POLAR;
    c.dollyToCursor = true;
    c.smoothTime = reducedMotion ? 0.05 : SMOOTH;
    c.draggingSmoothTime = 0.1;
    // Pans slide across the ground like a map, whatever the tilt.
    c.mouseButtons.left = ACTION.ROTATE;
    c.mouseButtons.right = ACTION.SCREEN_PAN;
    c.mouseButtons.middle = ACTION.DOLLY;
    c.mouseButtons.wheel = ACTION.DOLLY;
    c.touches.one = ACTION.TOUCH_ROTATE;
    // Pinch to zoom while two fingers pan across the ground. (Supported at runtime; missing from the library's types.)
    c.touches.two = ACTION.TOUCH_DOLLY_SCREEN_PAN as typeof ACTION.TOUCH_DOLLY_TRUCK;
    c.touches.three = ACTION.TOUCH_SCREEN_PAN;
    // The orbit pivot stays over the island (with some sea around it) and above the ground.
    c.setBoundary(
      new THREE.Box3(
        new THREE.Vector3(island.minX - slack, 0, island.minZ - slack),
        new THREE.Vector3(island.maxX + slack, Math.max(30, tallest), island.maxZ + slack),
      ),
    );
  }, [island, reducedMotion, phase, cityKey, camera]);

  // Shift + left-drag pans instead of orbiting. camera-controls reads the
  // button mapping on pointerdown, so set it just before (capture phase).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const c = ref.current;
      if (c && e.pointerType === "mouse") c.mouseButtons.left = e.shiftKey ? ACTION.SCREEN_PAN : ACTION.ROTATE;
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, []);

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

  // The opening shot for each new city: a short fly-in to the aerial view, or a
  // cut under reduced motion. A deep link's selection or journey flies on from
  // here once the city has assembled, so it always wins.
  useEffect(() => {
    if (phase !== "city" || introDone.current === cityKey) return;
    introDone.current = cityKey;
    const c = ref.current;
    if (!c || !styledLayout()) return;
    easeOver(c, 1.1);
    goToOpening(c, !reducedMotion);
  }, [phase, cityKey, reducedMotion, goToOpening, easeOver]);

  // While nobody has moved the camera since the opening view, keep the city framed in
  // the uncovered part of the screen as the guide and other panels open and close.
  useEffect(
    () =>
      useCity.subscribe((s, prev) => {
        if (s.panel === prev.panel && s.selected === prev.selected) return;
        const c = ref.current;
        if (!c || s.phase !== "city" || !atOpening.current) return;
        easeOver(c, 0.6);
        goToOpening(c, !s.reducedMotion);
      }),
    [goToOpening, easeOver],
  );

  // Expose the controls to browser automation (as the store is) so end-to-end checks can read the camera.
  useEffect(() => {
    if (!navigator.webdriver) return;
    const w = window as unknown as { __codescapeCamera?: CameraControlsImpl | null };
    w.__codescapeCamera = ref.current;
    return () => {
      w.__codescapeCamera = null;
    };
  }, []);

  // Keyboard flight. Keys are tracked while held and applied every frame.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!FLIGHT_KEYS.has(e.code) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (useCity.getState().phase !== "city" || keysOwnedElsewhere()) return;
      keys.current.add(e.code);
      // Arrows and Page keys would otherwise scroll a focused panel.
      if (e.code.startsWith("Arrow") || e.code.startsWith("Page")) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
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
    atOpening.current = false;
    if (c.smoothTime > 0.4) c.smoothTime = SMOOTH;
    const fast = k.has("ShiftLeft") || k.has("ShiftRight") ? 2.4 : 1;
    // A looser cap than the drift's, so held keys keep their speed on a slow device.
    const step = Math.min(delta, 0.12);
    const speed = Math.max(4, c.distance * 0.9) * fast * step;
    let fx = 0;
    let fz = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) fz -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) fz += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) fx -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) fx += 1;
    if (fx || fz) {
      // Relative to the view, along the ground.
      const az = c.azimuthAngle;
      const dx = (fx * Math.cos(az) + fz * Math.sin(az)) * speed;
      const dz = (-fx * Math.sin(az) + fz * Math.cos(az)) * speed;
      c.getTarget(v1, true);
      void c.moveTo(v1.x + dx, v1.y, v1.z + dz, true);
    }
    const turn = 1.3 * step * fast;
    if (k.has("KeyQ")) void c.rotate(-turn, 0, true);
    if (k.has("KeyE")) void c.rotate(turn, 0, true);
    // R / PageUp tilt towards a top-down view; F / PageDown towards the ground.
    const tilt = 0.9 * step * fast;
    if (k.has("KeyR") || k.has("PageUp")) void c.rotate(0, -tilt, true);
    if (k.has("KeyF") || k.has("PageDown")) void c.rotate(0, tilt, true);
    if (k.has("Equal") || k.has("NumpadAdd")) void c.dolly(c.distance * 1.2 * step * fast, true);
    if (k.has("Minus") || k.has("NumpadSubtract")) void c.dolly(-c.distance * 1.2 * step * fast, true);
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      onStart={() => {
        interacting.current = true;
        atOpening.current = false;
        if (ref.current && ref.current.smoothTime > 0.4) ref.current.smoothTime = SMOOTH;
      }}
      onEnd={() => {
        interacting.current = false;
        lastInteraction.current = performance.now();
      }}
    />
  );
}

export { DEFAULT_AZIMUTH };
