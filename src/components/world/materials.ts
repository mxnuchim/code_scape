import * as THREE from "three";
import { WORLD } from "@/theme/palette";

/**
 * Uniforms shared by every animated material. One clock and one window-glow
 * level drive the whole world, so ambient motion costs a single uniform write
 * per frame.
 */
export const worldUniforms = {
  uTime: { value: 0 },
  uWindowGlow: { value: 1 },
};

/**
 * Clay material with procedural windows. The vertex shader recovers each
 * instance's scale, so windows keep a real-world size on any building. Each
 * window is lit or dark based on a hash of the instance position.
 */
export function createWindowMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindowGlow = worldUniforms.uWindowGlow;
    shader.uniforms.uWindowLit = { value: new THREE.Color(WORLD.windowLit) };
    shader.uniforms.uGlassColor = { value: new THREE.Color(WORLD.windowGlass) };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vWinPos;
         varying vec3 vWinNormal;
         varying vec3 vWinSize;
         varying float vWinSeed;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 instScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
           vWinSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
         #else
           vec3 instScale = vec3(1.0);
           vWinSeed = 0.5;
         #endif
         vWinPos = position * instScale;
         vWinSize = instScale;
         vWinNormal = normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uWindowGlow;
         uniform vec3 uWindowLit;
         uniform vec3 uGlassColor;
         varying vec3 vWinPos;
         varying vec3 vWinNormal;
         varying vec3 vWinSize;
         varying float vWinSeed;
         float winHash(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.17))) * 15731.743); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         float winMask = 0.0;
         float winLit = 0.0;
         {
           vec3 n = normalize(vWinNormal);
           if (abs(n.y) < 0.5 && vWinSize.y > 0.32) {
             bool xFace = abs(n.x) > abs(n.z);
             float along = xFace ? vWinPos.z : vWinPos.x;
             float extent = xFace ? vWinSize.z : vWinSize.x;
             const float colW = 0.3;
             const float floorH = 0.36;
             float cols = floor((extent - 0.12) / colW);
             float floors = floor((vWinSize.y - 0.26) / floorH);
             float offset = (extent - cols * colW) * 0.5;
             vec2 cell = vec2((along + extent * 0.5 - offset) / colW, (vWinPos.y - 0.16) / floorH);
             vec2 id = floor(cell);
             vec2 f = fract(cell);
             float inside = step(0.0, cell.x) * step(cell.x, cols) * step(0.0, cell.y) * step(cell.y, floors);
             float pane = step(0.3, f.x) * step(f.x, 0.7) * step(0.28, f.y) * step(f.y, 0.74);
             winMask = inside * pane;
             float side = xFace ? sign(n.x) * 3.0 : sign(n.z) * 7.0;
             winLit = step(0.42, winHash(id + vec2(side, vWinSeed * 97.0)));
           }
         }
         // Unlit panes are a cool tint of the wall, so towers keep their language colour.
         diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.62, uGlassColor, 0.35), winMask * (1.0 - winLit * 0.6));`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += uWindowLit * winMask * winLit * uWindowGlow;`,
      );
  };
  material.customProgramCacheKey = () => "sc-windows-v1";
  return material;
}

export function createClayMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0 });
}

export function createGlassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    roughness: 0.12,
    metalness: 0.15,
    emissive: new THREE.Color("#9fe3d6"),
    emissiveIntensity: 0.18,
  });
}

/** Lamps, beacons, clock faces. Bright enough to bloom. */
export function createGlowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), toneMapped: false });
}

/**
 * Foliage that sways gently in the wind. Displacement grows with height and
 * uses each instance's position as phase, so trees never move in lockstep.
 */
export function createSwayMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;
           float sway = sin(uTime * 1.3 + phase) * 0.045 + sin(uTime * 2.1 + phase * 1.7) * 0.02;
           transformed.x += sway * max(position.y, 0.0);
           transformed.z += sway * 0.6 * max(position.y, 0.0);
         #endif`,
      );
  };
  material.customProgramCacheKey = () => "sc-sway-v1";
  return material;
}
