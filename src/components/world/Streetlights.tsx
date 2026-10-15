"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { LampLayout } from "@/lib/layout/types";
import { worldUniforms } from "./materials";

const noRaycast = () => {};
const POLE_HEIGHT = 0.62;

/**
 * Streetlights along the avenues. By day they are quiet poles; at night their
 * heads glow and cast soft pools of light on the road. The light is cosmetic;
 * it carries no information about the code.
 */
export function Streetlights({ lamps, top }: { lamps: LampLayout[]; top: number }) {
  const poles = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);

  const headMaterial = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ toneMapped: false });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uStreetGlow = worldUniforms.uStreetGlow;
      shader.uniforms.uStreetLight = worldUniforms.uStreetLight;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uStreetGlow;\nuniform vec3 uStreetLight;")
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\ndiffuseColor.rgb = mix(vec3(0.42, 0.42, 0.4), uStreetLight * 1.6, clamp(uStreetGlow * 0.5, 0.0, 1.0));",
        );
    };
    m.customProgramCacheKey = () => "sc-lamp-head-v1";
    return m;
  }, []);

  const poolMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uStreetGlow: worldUniforms.uStreetGlow, uStreetLight: worldUniforms.uStreetLight },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uStreetGlow; uniform vec3 uStreetLight; varying vec2 vUv;
          void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2) * 0.16 * uStreetGlow;
          if (a < 0.002) discard; gl_FragColor = vec4(uStreetLight * a, a); }`,
      }),
    [],
  );
  useEffect(
    () => () => {
      headMaterial.dispose();
      poolMaterial.dispose();
    },
    [headMaterial, poolMaterial],
  );

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const one = new THREE.Vector3(1, 1, 1);
    lamps.forEach((l, i) => {
      m.compose(new THREE.Vector3(l.x, top + POLE_HEIGHT / 2, l.z), new THREE.Quaternion(), one);
      poles.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(l.x, top + POLE_HEIGHT + 0.03, l.z), new THREE.Quaternion(), one);
      heads.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(l.x, top + 0.012, l.z), q, new THREE.Vector3(2.4, 2.4, 1));
      pools.current?.setMatrixAt(i, m);
    });
    for (const inst of [poles.current, heads.current, pools.current]) if (inst) inst.instanceMatrix.needsUpdate = true;
  }, [lamps, top]);

  if (lamps.length === 0) return null;
  return (
    <group>
      <instancedMesh key={`p${lamps.length}`} ref={poles} args={[undefined, undefined, lamps.length]} castShadow raycast={noRaycast} frustumCulled={false}>
        <cylinderGeometry args={[0.022, 0.03, POLE_HEIGHT, 6]} />
        <meshStandardMaterial color="#3a3d42" roughness={0.5} metalness={0.6} />
      </instancedMesh>
      <instancedMesh key={`h${lamps.length}`} ref={heads} args={[undefined, headMaterial, lamps.length]} raycast={noRaycast} frustumCulled={false}>
        <boxGeometry args={[0.09, 0.04, 0.09]} />
      </instancedMesh>
      <instancedMesh key={`l${lamps.length}`} ref={pools} args={[undefined, poolMaterial, lamps.length]} raycast={noRaycast} frustumCulled={false} renderOrder={1}>
        <planeGeometry args={[1, 1]} />
      </instancedMesh>
    </group>
  );
}
