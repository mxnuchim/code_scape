"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BuildingLayout } from "@/lib/layout/types";
import { FIXED_ROLE_COLORS, kitFor, variantIndexFor, type ColorRole, type MaterialKind } from "./buildingGeometries";
import { CATEGORY_COLORS, WORLD, languageColor } from "@/theme/palette";
import type { CityStyle } from "@/theme/cityStyles";
import type { ColorLens } from "@/state/preferences";
import { markShadowsDirty } from "./shadows";
import { getSharedMaterials } from "./sharedMaterials";

export interface BuildingVisualState {
  /** 1 = shown, 0 = filtered out (sinks to its foundation). Indexed like `buildings`. */
  visible: Uint8Array | null;
  /** Building ids that stay bright while everything else dims. */
  focus: ReadonlySet<string> | null;
  hovered: number;
}

interface BuildingsProps {
  buildings: BuildingLayout[];
  state: BuildingVisualState;
  style: CityStyle;
  lens: ColorLens;
  interactive?: boolean;
  leaving?: boolean;
  onLeft?: () => void;
  reducedMotion?: boolean;
  onHover?: (index: number | null) => void;
  onSelect?: (index: number) => void;
}

interface PartMesh {
  mesh: THREE.InstancedMesh;
  /** Per instance: sx, sy, sz, ox, oy, oz. */
  local: Float32Array;
  base: Float32Array;
  glow: boolean;
  material: MaterialKind;
  color: ColorRole;
}

interface Group {
  members: number[];
  parts: PartMesh[];
}

const EASE_OUT_BACK = 0;
const EASE_IN_OUT = 1;
const EASE_IN = 2;

function ease(kind: number, t: number): number {
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  switch (kind) {
    case EASE_OUT_BACK: {
      const c1 = 1.55;
      const c3 = c1 + 1;
      return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    }
    case EASE_IN:
      return t * t * t;
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }
}

/** One animated channel per building, stored as structure-of-arrays. */
class Channel {
  value: Float32Array;
  from: Float32Array;
  to: Float32Array;
  start: Float32Array;
  dur: Float32Array;
  kind: Uint8Array;
  constructor(n: number, initial: number) {
    this.value = new Float32Array(n).fill(initial);
    this.from = new Float32Array(n).fill(initial);
    this.to = new Float32Array(n).fill(initial);
    this.start = new Float32Array(n);
    this.dur = new Float32Array(n);
    this.kind = new Uint8Array(n);
  }
  set(i: number, to: number, now: number, delay: number, dur: number, kind: number) {
    this.from[i] = this.value[i];
    this.to[i] = to;
    this.start[i] = now + delay;
    this.dur[i] = Math.max(dur, 0.0001);
    this.kind[i] = kind;
  }
  /** Advance; returns true while still moving. */
  step(i: number, now: number): boolean {
    const t = (now - this.start[i]) / this.dur[i];
    if (t <= 0) return true;
    if (t >= 1) {
      this.value[i] = this.to[i];
      return false;
    }
    this.value[i] = this.from[i] + (this.to[i] - this.from[i]) * ease(this.kind[i], t);
    return true;
  }
  moving(i: number) {
    return this.value[i] !== this.to[i];
  }
}

const tmpColor = new THREE.Color();
const dimColor = new THREE.Color(WORLD.dim);
const RISE_FILTERED = 0.045;
const now = () => performance.now() / 1000;

const pick = (list: string[], b: BuildingLayout, salt: number) => list[Math.floor(b.variant * 9973 + salt) % list.length];

/**
 * A part's colour. The lens decides what facades encode: believable materials
 * (architectural), the file's language, or its role. The language band always
 * shows the language, so it's never lost.
 */
function roleColor(role: ColorRole, material: MaterialKind, b: BuildingLayout, style: CityStyle, lens: ColorLens, out: THREE.Color) {
  const f = style.facade;
  switch (role) {
    case "body": {
      const glass = material === "curtain" || material === "curtainRound";
      if (lens === "language") {
        out.set(languageColor(b.language));
        if (glass) out.multiplyScalar(0.8);
      } else if (lens === "role") {
        out.set(CATEGORY_COLORS[b.category]);
      } else {
        out.set(pick(glass ? f.glass : f.stone, b, 0));
      }
      // Small per-building variation so neighbours don't look stamped.
      return out.offsetHSL(0, 0, (b.variant - 0.5) * 0.05);
    }
    case "roof":
      return out.set(pick(f.roof, b, 3));
    case "trim":
    case "stone":
      return out.set(f.trim);
    case "metal":
      return out.set(f.metal);
    case "language":
      return out.set(languageColor(b.language));
    default:
      return out.set(FIXED_ROLE_COLORS[role] ?? "#ffffff");
  }
}

export function Buildings({
  buildings,
  state,
  style,
  lens,
  interactive = false,
  leaving = false,
  onLeft,
  reducedMotion = false,
  onHover,
  onSelect,
}: BuildingsProps) {
  const n = buildings.length;
  const proxyRef = useRef<THREE.InstancedMesh>(null);

  const built = useMemo(() => {
    const materials = getSharedMaterials();
    const matFor = (kind: MaterialKind) => materials[kind];
    const root = new THREE.Group();
    const groupOf = new Int32Array(n);
    const slotOf = new Int32Array(n);
    const byKey = new Map<string, number[]>();
    buildings.forEach((b, i) => {
      const key = `${b.archetype}:${variantIndexFor(style.id, b)}`;
      const list = byKey.get(key) ?? [];
      list.push(i);
      byKey.set(key, list);
    });

    const groups: Group[] = [];
    for (const [key, members] of byKey) {
      const [archetype, styleStr] = key.split(":") as [BuildingLayout["archetype"], string];
      const def = kitFor(style.id, archetype)[Number(styleStr)];
      const gi = groups.length;
      members.forEach((bi, slot) => {
        groupOf[bi] = gi;
        slotOf[bi] = slot;
      });
      const parts: PartMesh[] = def.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry(), matFor(part.material), members.length);
        mesh.castShadow = part.shadow !== false;
        mesh.receiveShadow = part.material !== "glow";
        mesh.frustumCulled = false;
        mesh.raycast = () => {};
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const local = new Float32Array(members.length * 6);
        const base = new Float32Array(members.length * 3);
        const glow = part.material === "glow";
        members.forEach((bi, slot) => {
          const b = buildings[bi];
          local.set(part.place({ w: b.width, d: b.depth, h: b.height, v: b.variant }), slot * 6);
        });
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(base.length), 3);
        // Start invisible; the assembly animation raises everything.
        mesh.instanceMatrix.array.fill(0);
        return { mesh, local, base, glow, material: part.material, color: part.color };
      });
      groups.push({ members, parts });
    }
    return { root, groups, groupOf, slotOf };
    // The kit depends only on the style's id; palettes are applied below.
  }, [buildings, n, style.id]);

  const anim = useMemo(
    () => ({
      rise: new Channel(n, 0),
      pop: new Channel(n, 0),
      dim: new Channel(n, 0),
      active: new Set<number>(),
      leftNotified: false,
    }),
    [n],
  );

  // Attach in an effect (not in useMemo) so StrictMode's mount/unmount/mount
  // cycle leaves the meshes in place. R3F's canvas inherits StrictMode.
  useLayoutEffect(() => {
    const { root, groups } = built;
    const meshes = groups.flatMap((g) => g.parts.map((p) => p.mesh));
    for (const m of meshes) root.add(m);
    return () => {
      for (const m of meshes) {
        root.remove(m);
        m.dispose();
      }
    };
  }, [built]);

  const writeBuilding = (i: number) => {
    const b = buildings[i];
    const g = built.groups[built.groupOf[i]];
    const slot = built.slotOf[i];
    const rise = anim.rise.value[i];
    const pop = anim.pop.value[i];
    const sxz = 1 + pop * 0.06;
    const sy = rise * (1 + pop * 0.04);
    const ty = b.y + pop * 0.16;
    for (const part of g.parts) {
      const arr = part.mesh.instanceMatrix.array as Float32Array;
      const l = slot * 6;
      const o = slot * 16;
      arr[o] = sxz * part.local[l];
      arr[o + 5] = sy * part.local[l + 1];
      arr[o + 10] = sxz * part.local[l + 2];
      arr[o + 12] = b.x + sxz * part.local[l + 3];
      arr[o + 13] = ty + sy * part.local[l + 4];
      arr[o + 14] = b.z + sxz * part.local[l + 5];
      arr[o + 15] = 1;
      part.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  const writeColor = (i: number) => {
    const g = built.groups[built.groupOf[i]];
    const slot = built.slotOf[i];
    const amount = anim.dim.value[i];
    for (const part of g.parts) {
      const c = part.mesh.instanceColor!;
      const arr = c.array as Float32Array;
      const o = slot * 3;
      if (part.glow) {
        const k = 1 - amount * 0.85;
        arr[o] = part.base[o] * k;
        arr[o + 1] = part.base[o + 1] * k;
        arr[o + 2] = part.base[o + 2] * k;
      } else {
        arr[o] = part.base[o] + (dimColor.r - part.base[o]) * amount * 0.78;
        arr[o + 1] = part.base[o + 1] + (dimColor.g - part.base[o + 1]) * amount * 0.78;
        arr[o + 2] = part.base[o + 2] + (dimColor.b - part.base[o + 2]) * amount * 0.78;
      }
      c.needsUpdate = true;
    }
  };

  // Colours follow the lens and the style's palette. Changing either repaints;
  // it never rebuilds or re-lays out anything.
  useLayoutEffect(() => {
    for (const g of built.groups) {
      for (const part of g.parts) {
        g.members.forEach((bi, slot) => {
          roleColor(part.color, part.material, buildings[bi], style, lens, tmpColor);
          if (part.glow) tmpColor.multiplyScalar(1.7);
          tmpColor.toArray(part.base, slot * 3);
        });
      }
    }
    for (let i = 0; i < n; i++) writeColor(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, style, lens]);

  // Assembly: rise in a wave from the centre. When only the style changed,
  // the same buildings re-rise quickly in their new architecture.
  const assembledOnce = useRef(false);
  const visibleRef = useRef(state.visible);
  visibleRef.current = state.visible;
  useLayoutEffect(() => {
    const t = now();
    const restyle = assembledOnce.current;
    assembledOnce.current = true;
    const visible = visibleRef.current;
    for (let i = 0; i < n; i++) {
      const target = !visible || visible[i] === 1 ? 1 : RISE_FILTERED;
      if (restyle) anim.rise.value[i] = 0;
      const delay = reducedMotion ? 0 : buildings[i].delay * (restyle ? 0.3 : 1);
      anim.rise.set(i, target, t, delay, reducedMotion ? 0.01 : restyle ? 0.55 : 0.75, EASE_OUT_BACK);
      anim.active.add(i);
    }
    anim.leftNotified = false;
    markShadowsDirty();
    // Only when the meshes are (re)built; later visual changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  // Leaving: sink in reverse order, then report back. If the leave is
  // cancelled midway (e.g. the user goes straight back), rise again.
  const wasLeaving = useRef(false);
  useEffect(() => {
    if (!leaving) {
      if (wasLeaving.current) {
        wasLeaving.current = false;
        const t = now();
        for (let i = 0; i < n; i++) {
          anim.rise.set(i, 1, t, reducedMotion ? 0 : buildings[i].delay * 0.4, reducedMotion ? 0.01 : 0.6, EASE_OUT_BACK);
          anim.active.add(i);
        }
      }
      return;
    }
    wasLeaving.current = true;
    const t = now();
    let maxDelay = 0;
    for (const b of buildings) maxDelay = Math.max(maxDelay, b.delay);
    for (let i = 0; i < n; i++) {
      const delay = reducedMotion ? 0 : (maxDelay - buildings[i].delay) * 0.3;
      anim.rise.set(i, 0, t, delay, reducedMotion ? 0.01 : 0.38, EASE_IN);
      anim.pop.set(i, 0, t, 0, 0.1, EASE_IN_OUT);
      anim.active.add(i);
    }
    anim.leftNotified = false;
  }, [leaving, anim, buildings, n, reducedMotion]);

  // Filters, focus and hover.
  const prev = useRef<{ visible: Uint8Array | null; focus: ReadonlySet<string> | null; hovered: number }>({
    visible: null,
    focus: null,
    hovered: -1,
  });
  useEffect(() => {
    if (leaving) return;
    const t = now();
    const { visible, focus, hovered } = state;
    const p = prev.current;
    const dur = reducedMotion ? 0.01 : 0.45;
    if (visible !== p.visible || focus !== p.focus) {
      for (let i = 0; i < n; i++) {
        const shown = !visible || visible[i] === 1;
        const wasShown = !p.visible || p.visible[i] === 1;
        const dimTarget = !shown ? 1 : focus && !focus.has(buildings[i].id) ? 0.72 : 0;
        if (shown !== wasShown) {
          const delay = reducedMotion ? 0 : (i % 17) * 0.008;
          anim.rise.set(i, shown ? 1 : RISE_FILTERED, t, delay, dur, shown ? EASE_OUT_BACK : EASE_IN_OUT);
          anim.active.add(i);
        }
        if (anim.dim.to[i] !== dimTarget) {
          anim.dim.set(i, dimTarget, t, 0, dur * 0.8, EASE_IN_OUT);
          anim.active.add(i);
        }
      }
    }
    if (hovered !== p.hovered) {
      if (p.hovered >= 0 && p.hovered < n) {
        anim.pop.set(p.hovered, 0, t, 0, reducedMotion ? 0.01 : 0.22, EASE_IN_OUT);
        anim.active.add(p.hovered);
      }
      if (hovered >= 0 && hovered < n) {
        anim.pop.set(hovered, 1, t, 0, reducedMotion ? 0.01 : 0.2, EASE_IN_OUT);
        anim.active.add(hovered);
      }
    }
    prev.current = { visible, focus, hovered };
  }, [state, anim, buildings, n, leaving, reducedMotion]);

  // Hit proxies: one invisible box per building, removed when it is filtered out.
  useLayoutEffect(() => {
    const proxy = proxyRef.current;
    if (!proxy || !interactive) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const b = buildings[i];
      const shown = !state.visible || state.visible[i] === 1;
      if (shown) m.compose(new THREE.Vector3(b.x, b.y + b.height / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.width * 1.08, b.height + 0.1, b.depth * 1.08));
      else m.makeScale(0, 0, 0);
      proxy.setMatrixAt(i, m);
    }
    proxy.instanceMatrix.needsUpdate = true;
    proxy.computeBoundingSphere();
    proxy.computeBoundingBox();
  }, [buildings, n, state.visible, interactive]);

  useFrame(() => {
    if (anim.active.size === 0) return;
    const t = now();
    for (const i of anim.active) {
      const r = anim.rise.step(i, t);
      const p = anim.pop.step(i, t);
      const dimMoving = anim.dim.moving(i);
      const d = anim.dim.step(i, t);
      writeBuilding(i);
      if (dimMoving) writeColor(i);
      if (!r && !p && !d) anim.active.delete(i);
    }
    markShadowsDirty();
    if (anim.active.size === 0 && leaving && !anim.leftNotified) {
      anim.leftNotified = true;
      onLeft?.();
    }
  });

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId === undefined) return;
    e.stopPropagation();
    // Touch has no hover; a drag across buildings shouldn't flicker labels.
    if (e.pointerType === "touch") return;
    onHover?.(e.instanceId);
  };
  const handleOut = () => onHover?.(null);
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId === undefined || e.delta > 6) return;
    e.stopPropagation();
    onSelect?.(e.instanceId);
  };

  return (
    <>
      <primitive object={built.root} />
      {interactive && (
        <instancedMesh
          ref={proxyRef}
          args={[undefined, undefined, n]}
          visible={false}
          onPointerMove={handleMove}
          onPointerOut={handleOut}
          onClick={handleClick}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial />
        </instancedMesh>
      )}
    </>
  );
}
