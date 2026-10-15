import * as THREE from "three";

/**
 * Uniforms shared by every environment-aware material. The EnvironmentRig
 * writes them once per frame, so day/night and style changes cost a handful
 * of uniform writes no matter how big the city is.
 */
export const worldUniforms = {
  uTime: { value: 0 },
  /** 0 = day, 1 = night (eased). */
  uNight: { value: 0 },
  /** Emissive strength of lit windows. */
  uWindowGlow: { value: 0 },
  /** Share of windows that are lit. */
  uLitRatio: { value: 0.4 },
  uWindowLit: { value: new THREE.Color("#ffc983") },
  /** Style's floor height and window column width, in world units. */
  uFloor: { value: 0.34 },
  uColumn: { value: 0.26 },
  /** Brightness multiplier for self-lit accents (language bands). */
  uAccentBoost: { value: 0.85 },
  /** Brightness multiplier for lamps and beacons. */
  uGlowBoost: { value: 0.6 },
  uStreetGlow: { value: 0 },
  uStreetLight: { value: new THREE.Color("#ffb768") },
};

export type FacadeKind = "masonry" | "curtain" | "curtainRound";

/**
 * Facade material with procedural windows. The vertex shader recovers each
 * instance's scale, so windows keep a real-world size on any building.
 * - masonry: punched windows in a solid wall
 * - curtain: a glass curtain wall with thin mullions and spandrels
 * - curtainRound: the same, wrapped around a curved tower
 * Which windows are lit is hashed from the building's position, so it never
 * flickers when the time of day changes.
 */
export function createFacadeMaterial(kind: FacadeKind): THREE.MeshStandardMaterial {
  const glass = kind !== "masonry";
  const material = new THREE.MeshStandardMaterial({
    roughness: glass ? 0.2 : 0.82,
    metalness: glass ? 0.25 : 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uWindowGlow: worldUniforms.uWindowGlow,
      uLitRatio: worldUniforms.uLitRatio,
      uWindowLit: worldUniforms.uWindowLit,
      uFloor: worldUniforms.uFloor,
      uColumn: worldUniforms.uColumn,
      uNight: worldUniforms.uNight,
    });
    shader.defines = { ...shader.defines, ...(glass ? { FACADE_CURTAIN: "" } : {}), ...(kind === "curtainRound" ? { FACADE_ROUND: "" } : {}) };
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
         uniform float uLitRatio;
         uniform vec3 uWindowLit;
         uniform float uFloor;
         uniform float uColumn;
         uniform float uNight;
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
         float winTone = 1.0;
         {
           vec3 n = normalize(vWinNormal);
           if (abs(n.y) < 0.6 && vWinSize.y > 0.3) {
             #ifdef FACADE_ROUND
               float radius = 0.25 * (vWinSize.x + vWinSize.z);
               float along = (atan(vWinPos.z, vWinPos.x) + 3.14159265) * radius;
               float extent = 6.2831853 * radius;
               float side = 0.0;
             #else
               bool xFace = abs(n.x) > abs(n.z);
               float along = xFace ? vWinPos.z : vWinPos.x;
               float extent = xFace ? vWinSize.z : vWinSize.x;
               float side = xFace ? sign(n.x) * 3.0 : sign(n.z) * 7.0;
               along += extent * 0.5;
             #endif
             #ifdef FACADE_CURTAIN
               float colW = uColumn * 0.85;
               float floorH = uFloor * 0.92;
             #else
               float colW = uColumn;
               float floorH = uFloor;
             #endif
             float cols = max(1.0, floor((extent - 0.08) / colW));
             float floors = floor((vWinSize.y - 0.18) / floorH);
             float offset = (extent - cols * colW) * 0.5;
             vec2 cell = vec2((along - offset) / colW, (vWinPos.y - 0.12) / floorH);
             vec2 id = floor(cell);
             vec2 f = fract(cell);
             float inside = step(0.0, cell.x) * step(cell.x, cols) * step(0.0, cell.y) * step(cell.y, floors);
             #ifdef FACADE_CURTAIN
               float pane = step(0.05, f.x) * step(f.x, 0.95) * step(0.16, f.y) * step(f.y, 0.94);
             #else
               float pane = step(0.27, f.x) * step(f.x, 0.73) * step(0.24, f.y) * step(f.y, 0.78);
             #endif
             winMask = inside * pane;
             float h = winHash(id + vec2(side, vWinSeed * 97.0));
             winLit = step(1.0 - uLitRatio, h);
             winTone = 0.7 + 0.6 * winHash(id * 1.7 + vWinSeed * 13.0);
           }
         }
         #ifdef FACADE_CURTAIN
           // Spandrels and mullions are a touch lighter than the glass; at night unlit glass goes dark.
           diffuseColor.rgb *= mix(1.18, 1.0, winMask);
           diffuseColor.rgb *= 1.0 - uNight * 0.55 * winMask * (1.0 - winLit);
         #else
           vec3 paneTint = mix(diffuseColor.rgb * 0.42, vec3(0.20, 0.24, 0.29), 0.55);
           diffuseColor.rgb = mix(diffuseColor.rgb, paneTint, winMask * (1.0 - winLit * uNight));
         #endif`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += uWindowLit * winMask * winLit * winTone * uWindowGlow;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         #ifdef FACADE_CURTAIN
           roughnessFactor = mix(0.55, roughnessFactor, winMask);
         #endif`,
      );
  };
  material.customProgramCacheKey = () => `sc-facade-v2-${kind}`;
  return material;
}

export function createClayMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
}

export function createMetalMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.7 });
}

export function createGlassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.08, metalness: 0.5 });
}

/** A basic material whose brightness follows a shared uniform. */
function boostedBasic(boost: { value: number }, toneMapped: boolean, key: string): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), toneMapped });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBoost = boost;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uBoost;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= uBoost;");
  };
  material.customProgramCacheKey = () => key;
  return material;
}

/** Language bands: self-lit so they read by day and glow softly by night. */
export function createAccentMaterial(): THREE.MeshBasicMaterial {
  return boostedBasic(worldUniforms.uAccentBoost, true, "sc-accent-v1");
}

/** Lamps, beacons, clock faces. Bright enough to bloom at night. */
export function createGlowMaterial(): THREE.MeshBasicMaterial {
  return boostedBasic(worldUniforms.uGlowBoost, false, "sc-glow-v1");
}

/**
 * Foliage that sways gently in the wind. Displacement grows with height and
 * uses each instance's position as phase, so trees never move in lockstep.
 */
export function createSwayMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;
           float sway = sin(uTime * 1.1 + phase) * 0.03 + sin(uTime * 1.9 + phase * 1.7) * 0.012;
           transformed.x += sway * max(position.y, 0.0);
           transformed.z += sway * 0.6 * max(position.y, 0.0);
         #endif`,
      );
  };
  material.customProgramCacheKey = () => "sc-sway-v1";
  return material;
}
