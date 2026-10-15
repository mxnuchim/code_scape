"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Component, useEffect, useState, type ReactNode } from "react";
import * as THREE from "three";
import { useCity } from "@/state/store";
import { disposeBuildingGeometries } from "./buildingGeometries";
import { Scene } from "./Scene";
import { disposeSharedMaterials } from "./sharedMaterials";

class WorldErrorBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("CodeScape: the 3D world crashed", error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function initialTier(): "high" | "low" {
  if (typeof window === "undefined") return "high";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const cores = navigator.hardwareConcurrency ?? 8;
  return coarse || small || cores <= 4 ? "low" : "high";
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

// This module only ever loads in the browser (next/dynamic with ssr: false),
// so reading the device up front is safe.
export default function World({ onFailure }: { onFailure: (reason: "crash" | "context-lost" | "unsupported") => void }) {
  const [supported] = useState(hasWebGL2);
  const [tier] = useState(initialTier);
  const [dpr, setDpr] = useState<[number, number]>(() => (tier === "high" ? [1, 1.5] : [1, 1.25]));

  useEffect(() => {
    if (!supported) onFailure("unsupported");
  }, [supported, onFailure]);

  useEffect(() => {
    useCity.setState({ tier });
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => useCity.setState({ reducedMotion: mq.matches });
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      disposeBuildingGeometries();
      disposeSharedMaterials();
    };
  }, [tier]);

  if (!supported) return null;

  return (
    <WorldErrorBoundary onError={() => onFailure("crash")}>
      <Canvas
        shadows="percentage"
        dpr={dpr}
        camera={{ fov: 30, near: 0.5, far: 2600, position: [38, 34, 46] }}
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping;
          const canvas = gl.domElement;
          let pending: number | undefined;
          canvas.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            // Unmounting the canvas also "loses" the context on purpose, and a
            // real loss often restores itself. Only give up if neither applies.
            window.clearTimeout(pending);
            pending = window.setTimeout(() => {
              if (canvas.isConnected) onFailure("context-lost");
            }, 2000);
          });
          canvas.addEventListener("webglcontextrestored", () => window.clearTimeout(pending));
        }}
        onPointerMissed={(e) => {
          if (e.type === "click") useCity.getState().select(null);
        }}
        fallback={null}
        aria-label="Interactive 3D city"
      >
        <PerformanceMonitor
          onDecline={() => {
            if (useCity.getState().tier === "high") useCity.setState({ tier: "low" });
            setDpr([1, 1.25]);
          }}
          flipflops={3}
          onFallback={() => setDpr([1, 1])}
        />
        <Scene />
      </Canvas>
    </WorldErrorBoundary>
  );
}
