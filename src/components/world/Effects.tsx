"use client";

import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import { ToneMappingMode, type BloomEffect } from "postprocessing";
import { useRef } from "react";
import type { Tier } from "@/state/store";
import { liveEnvironment } from "./EnvironmentRig";

/**
 * Post-processing, tiered by device capability:
 * - high: ambient occlusion for contact shadows between buildings, bloom for
 *   lit windows and streetlights, and a light vignette.
 * - low: bloom and tone mapping only.
 * Bloom strength follows the environment, so nights glow and days stay crisp.
 */
export function Effects({ tier }: { tier: Tier }) {
  const bloom = useRef<BloomEffect>(null);
  useFrame(() => {
    if (bloom.current) bloom.current.intensity = liveEnvironment.preset.bloom;
  });
  if (tier === "low") {
    return (
      <EffectComposer multisampling={0}>
        <Bloom ref={bloom} mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={0.5} radius={0.62} />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={4}>
      <N8AO aoRadius={1.2} distanceFalloff={0.8} intensity={1.8} quality="medium" halfRes color="#1c1f26" />
      <Bloom ref={bloom} mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.22} intensity={0.5} radius={0.66} />
      <Vignette offset={0.3} darkness={0.38} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}
