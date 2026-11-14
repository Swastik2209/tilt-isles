import * as THREE from 'three';
import type { SwayUniforms } from './materials';
import { mulberry32 } from './math';
import { buildIsle, buildTree } from './scenery';

/** Direction TOWARD the sun: behind-left of the camera so Pip's face stays lit. */
export const SUN_DIR = new THREE.Vector3(-0.5, 0.75, 0.42).normalize();

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uBelow;
  uniform vec3 uSunDir; uniform vec3 uSunCol;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.26, d.y));
    col = mix(col, uTop, smoothstep(0.18, 0.85, d.y));
    col = mix(col, uBelow, smoothstep(0.0, -0.3, d.y));
    float s = max(dot(d, uSunDir), 0.0);
    col += uSunCol * (pow(s, 420.0) * 4.0 + pow(s, 28.0) * 0.4 + pow(s, 5.0) * 0.14);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const POLLEN_VERT = /* glsl */ `
  uniform float uTime; uniform float uScale; uniform vec3 uCam; uniform vec3 uDrift;
  attribute float aSeed;
  varying float vTw;
  const float BOX = 46.0;
  void main() {
    vec3 p = position + uDrift;
    p.x += sin(uTime * 0.6 + aSeed * 20.0) * 0.8;
    p.y += cos(uTime * 0.45 + aSeed * 31.0) * 0.6;
    p.z += sin(uTime * 0.5 + aSeed * 12.0) * 0.8;
    // Wrap into a box that follows the camera, so pollen is everywhere for free.
    p = mod(p - uCam + BOX * 0.5, BOX) - BOX * 0.5 + uCam;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vTw = 0.55 + 0.45 * sin(uTime * 2.0 + aSeed * 50.0);
    gl_PointSize = (0.07 + aSeed * 0.09) * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const POLLEN_FRAG = /* glsl */ `
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.1, 0.5, d)) * vTw * 0.75;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(1.5, 1.35, 0.95), a);
  }
`;

interface Cloud {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  speed: number;
}
interface Bird {
  group: THREE.Group;
  wings: THREE.Mesh[];
  cx: number;
  cy: number;
  cz: number;
  r: number;
  speed: number;
  phase: number;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const s = new THREE.Vector3();

/** Sky, light, weather and distant life — everything that isn't gameplay. */
export class Environment {
  readonly sway: SwayUniforms = {
    uTime: { value: 0 },
    uPlayer: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector2(0.3, 0) },
  };
  readonly sun: THREE.DirectionalLight;

  private sky: THREE.Mesh;
  private cloudMesh: THREE.InstancedMesh;
  private clouds: Cloud[] = [];
  private pollenUniforms: {
    uTime: { value: number };
    uScale: { value: number };
    uCam: { value: THREE.Vector3 };
    uDrift: { value: THREE.Vector3 };
  };
  private birds: Bird[] = [];
  private farIsles: THREE.Group[] = [];
  private sunAnchor = new THREE.Vector3(1e6, 0, 0);

  constructor(scene: THREE.Scene, particleScale: { value: number }) {
    const horizon = new THREE.Color(0xffe0bd);
    // Fog fades distance into a pale sky-blue, so the cream clouds stay crisp against it.
    scene.fog = new THREE.Fog(0xbfe1f3, 80, 330);

    // --- Sky dome.
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(700, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x2f7fd0) },
          uMid: { value: new THREE.Color(0x8fd0ee) },
          uHorizon: { value: horizon },
          uBelow: { value: new THREE.Color(0x9fd2f0) },
          uSunDir: { value: SUN_DIR },
          uSunCol: { value: new THREE.Color(1.0, 0.82, 0.55) },
        },
      }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // --- Lights: warm key with shadows, sky/ground fill, cool rim.
    scene.add(new THREE.HemisphereLight(0xcfeaff, 0xffc9a0, 2.0));
    this.sun = new THREE.DirectionalLight(0xfff0d2, 3.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -34;
    cam.right = cam.top = 34;
    cam.near = 1;
    cam.far = 160;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight(0xff9ec4, 0.9);
    rim.position.set(0.6, 0.35, -0.8);
    scene.add(rim);

    // --- Sea of clouds below + a few drifting banks at altitude.
    const rnd = mulberry32(2024);
    const COUNT = 230;
    this.cloudMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshLambertMaterial({ color: 0xdcd2d3 }),
      COUNT,
    );
    this.cloudMesh.frustumCulled = false;
    let made = 0;
    while (made < COUNT) {
      const high = rnd() < 0.2;
      const side = rnd() < 0.5 ? -1 : 1;
      const cx = high ? side * (34 + rnd() * 110) : (rnd() - 0.5) * 420;
      const cy = high ? 4 + rnd() * 46 : -24 + rnd() * 7;
      const cz = -70 + (rnd() - 0.5) * 420;
      const puffs = 3 + Math.floor(rnd() * 4);
      const size = high ? 2.5 + rnd() * 3 : 7 + rnd() * 9;
      const speed = 0.25 + rnd() * 0.5;
      for (let i = 0; i < puffs && made < COUNT; i++, made++) {
        const k = size * (0.6 + rnd() * 0.6);
        this.clouds.push({
          x: cx + (rnd() - 0.5) * size * 2.6,
          y: cy + (rnd() - 0.5) * size * 0.3,
          z: cz + (rnd() - 0.5) * size * 1.4,
          sx: k * 1.5,
          sy: k * 0.55,
          sz: k,
          speed,
        });
      }
    }
    scene.add(this.cloudMesh);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(600, 32), new THREE.MeshBasicMaterial({ color: 0x6fb4e6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -30, -70);
    scene.add(floor);

    // --- Far isles: silhouettes that promise a bigger world.
    const spots: [number, number, number, number][] = [
      [-62, 4, -58, 5.5],
      [58, 14, -96, 7],
      [-48, 28, -150, 6],
      [44, -4, -22, 4.5],
      [70, 30, -170, 8],
      [-88, 16, -110, 9],
      [10, 44, -215, 10],
      [-30, -6, 30, 5],
    ];
    spots.forEach(([x, y, z, r], i) => {
      const g = buildIsle({ r }, 900 + i, true);
      const tree = buildTree(i % 2 ? 'blossom' : 'leaf', 1 + r * 0.14, 77 + i).group;
      tree.position.set(r * 0.2, 0, -r * 0.1);
      g.add(tree);
      g.position.set(x, y, z);
      g.userData.y0 = y;
      this.farIsles.push(g);
      scene.add(g);
    });

    // --- Birds: tiny dark V's wheeling in the distance.
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x2a3552, side: THREE.DoubleSide });
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.14, 0, 0, 0.14, 0.8, 0, 0]), 3));
    for (let i = 0; i < 6; i++) {
      const group = new THREE.Group();
      const wl = new THREE.Mesh(wingGeo, birdMat);
      const wr = new THREE.Mesh(wingGeo, birdMat);
      wr.scale.x = -1;
      group.add(wl, wr);
      scene.add(group);
      this.birds.push({
        group,
        wings: [wl, wr],
        cx: (rnd() - 0.5) * 50,
        cy: 12 + rnd() * 30,
        cz: -40 - rnd() * 110,
        r: 16 + rnd() * 22,
        speed: (0.14 + rnd() * 0.12) * (i % 2 ? 1 : -1),
        phase: rnd() * 6,
      });
    }

    // --- Pollen: glowing dust that drifts with the wind.
    const N = 420;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rnd() * 46;
      pos[i * 3 + 1] = rnd() * 46;
      pos[i * 3 + 2] = rnd() * 46;
      seed[i] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.pollenUniforms = {
      uTime: { value: 0 },
      uScale: particleScale,
      uCam: { value: new THREE.Vector3() },
      uDrift: { value: new THREE.Vector3() },
    };
    const pollen = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: POLLEN_VERT,
        fragmentShader: POLLEN_FRAG,
        uniforms: this.pollenUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    pollen.frustumCulled = false;
    scene.add(pollen);
  }

  update(dt: number, t: number, camera: THREE.Camera, playerPos: THREE.Vector3, wind: THREE.Vector2) {
    this.sway.uTime.value = t;
    this.sway.uPlayer.value.copy(playerPos);
    this.sway.uWind.value.copy(wind);
    this.sky.position.copy(camera.position);

    // Re-anchor the shadow frustum only when Pip strays, so shadows don't shimmer.
    if (this.sunAnchor.distanceToSquared(playerPos) > 36) {
      this.sunAnchor.copy(playerPos);
      this.sun.target.position.copy(playerPos);
      this.sun.position.copy(playerPos).addScaledVector(SUN_DIR, 70);
      this.sun.target.updateMatrixWorld();
    }

    q.identity();
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.x += (c.speed + wind.x * 0.6) * dt;
      if (c.x > 215) c.x -= 430;
      if (c.x < -215) c.x += 430;
      v.set(c.x, c.y + Math.sin(t * 0.2 + i) * 0.3, c.z);
      s.set(c.sx, c.sy, c.sz);
      m4.compose(v, q, s);
      this.cloudMesh.setMatrixAt(i, m4);
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.farIsles.length; i++) {
      const g = this.farIsles[i];
      g.position.y = g.userData.y0 + Math.sin(t * 0.25 + i * 1.7) * 0.8;
      g.rotation.y = Math.sin(t * 0.05 + i) * 0.2;
    }

    for (const b of this.birds) {
      const a = t * b.speed + b.phase;
      b.group.position.set(b.cx + Math.cos(a) * b.r, b.cy + Math.sin(a * 2.3) * 1.5, b.cz + Math.sin(a) * b.r);
      b.group.rotation.y = -a + (b.speed > 0 ? 0 : Math.PI);
      const flap = Math.sin(t * 7 + b.phase) * 0.55;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
    }

    const u = this.pollenUniforms;
    u.uTime.value = t;
    u.uCam.value.copy(camera.position);
    u.uDrift.value.x += wind.x * 1.6 * dt;
    u.uDrift.value.y += 0.12 * dt;
    u.uDrift.value.z += wind.y * 1.6 * dt;
  }
}
