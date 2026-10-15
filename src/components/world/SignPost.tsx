"use client";

import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

const noRaycast = () => {};

/**
 * A little wooden sign planted on the empty plot when something goes wrong.
 * The words are short; the overlay card carries the explanation.
 */
export function SignPost({ text, tone = "warn", reducedMotion }: { text: string; tone?: "warn" | "wait"; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const born = useRef(performance.now() / 1000);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = performance.now() / 1000 - born.current;
    const p = reducedMotion ? 1 : Math.min(1, t / 0.6);
    // Pops out of the ground with a little wobble.
    const s = p >= 1 ? 1 : 1 - Math.cos(p * Math.PI * 2.2) * Math.exp(-p * 5);
    g.scale.setScalar(Math.max(0.001, s));
    g.rotation.z = reducedMotion ? 0 : Math.sin(t * 1.4) * 0.025;
  });
  const board = tone === "wait" ? "#f5d48a" : "#f4c9a6";
  return (
    <group ref={group} position={[0, 0, 1.5]}>
      <mesh position={[-1.05, 0.9, 0]} castShadow raycast={noRaycast}>
        <boxGeometry args={[0.16, 1.8, 0.16]} />
        <meshStandardMaterial color="#a77a55" roughness={0.9} />
      </mesh>
      <mesh position={[1.05, 0.9, 0]} castShadow raycast={noRaycast}>
        <boxGeometry args={[0.16, 1.8, 0.16]} />
        <meshStandardMaterial color="#a77a55" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.45, 0.05]} castShadow raycast={noRaycast}>
        <boxGeometry args={[2.9, 0.95, 0.14]} />
        <meshStandardMaterial color={board} roughness={0.85} />
      </mesh>
      <Text
        font="/fonts/bricolage-700.woff"
        position={[0, 1.45, 0.13]}
        fontSize={0.34}
        maxWidth={2.6}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        color="#4a3424"
        raycast={noRaycast}
      >
        {text}
      </Text>
    </group>
  );
}
