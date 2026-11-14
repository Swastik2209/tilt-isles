import * as THREE from 'three';

/** The world's palette. */
export const C = {
  turf: 0x7cd65c,
  turfLight: 0x9be873,
  turfDark: 0x47a549,
  rockTop: 0xe2a77c,
  rockBottom: 0x86607c,
  cream: 0xf7e6cc,
  coral: 0xff6452,
  coralDark: 0xd9483b,
  teal: 0x22c3b0,
  sun: 0xffc94d,
  violet: 0x8e7dff,
  amber: 0xffb238,
  wood: 0xe3b176,
  woodDark: 0xb07257,
  slate: 0x9fb0d6,
  slateDark: 0x7284b5,
  ink: 0x1a2740,
  blossom: 0xff9db8,
  leaf: 0x3fb58a,
};

export interface MatOpts {
  rough?: number;
  metal?: number;
  flat?: boolean;
  emissive?: number;
  ei?: number;
  vertexColors?: boolean;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Cached standard material — identical requests share one instance. */
export function mat(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(o);
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.82,
      metalness: o.metal ?? 0,
      flatShading: !!o.flat,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.ei ?? 1,
      vertexColors: !!o.vertexColors,
    });
    cache.set(key, m);
  }
  return m;
}

export interface SwayUniforms {
  uTime: { value: number };
  uPlayer: { value: THREE.Vector3 };
  uWind: { value: THREE.Vector2 };
}

/**
 * Standard material for instanced foliage that bends in the wind and leans
 * away from Pip. Geometry must be 0..1 tall (y = bend weight).
 */
export function swayMaterial(params: THREE.MeshStandardMaterialParameters, u: SwayUniforms) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uPlayer = u.uPlayer;
    shader.uniforms.uWind = u.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uPlayer;\nuniform vec2 uWind;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        #ifdef USE_INSTANCING
        {
          vec4 iw = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float hh = position.y * position.y;
          float ph = iw.x * 0.9 + iw.z * 0.7;
          vec2 bend = uWind * (0.34 + 0.14 * sin(uTime * 1.7 + ph))
                    + vec2(sin(uTime * 2.1 + ph), cos(uTime * 1.6 + ph * 1.3)) * 0.035;
          vec2 dp = iw.xz - uPlayer.xz;
          float dl = length(dp);
          float push = (1.0 - smoothstep(0.25, 1.3, dl)) * (1.0 - smoothstep(0.3, 1.2, abs(iw.y - uPlayer.y)));
          bend += (dp / max(dl, 0.001)) * push * 0.32;
          vec4 off = viewMatrix * vec4(bend.x * hh, -length(bend) * hh * 0.35, bend.y * hh, 0.0);
          mvPosition.xyz += off.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'sway-v1';
  return m;
}
