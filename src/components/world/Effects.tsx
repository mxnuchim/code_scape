"use client";

import { Bloom, EffectComposer, N8AO, TiltShift2, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { Tier } from "@/state/store";

/**
 * Post-processing, tiered by device capability:
 * - high: ambient occlusion for the clay look, bloom for windows and beacons,
 *   a whisper of tilt-shift to sell the miniature, and a vignette.
 * - low: bloom and tone mapping only.
 */
export function Effects({ tier }: { tier: Tier }) {
  if (tier === "low") {
    return (
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.2} intensity={0.55} radius={0.6} />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={4}>
      <N8AO aoRadius={1.4} distanceFalloff={0.9} intensity={2.2} quality="medium" halfRes color="#3b3550" />
      <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.25} intensity={0.7} radius={0.65} />
      <TiltShift2 blur={0.08} taper={0.55} start={[0, 0.48]} end={[1, 0.48]} />
      <Vignette offset={0.28} darkness={0.42} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}
