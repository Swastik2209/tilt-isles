import * as THREE from 'three';
import { C, mat } from './materials';
import { buildLantern, type Lantern } from './scenery';
import { T } from './tuning';

interface Mote {
  base: THREE.Vector3;
  pos: THREE.Vector3;
  phase: number;
  /** 0 = waiting, 1 = flying to Pip, 2 = collected */
  state: 0 | 1 | 2;
  speed: number;
}

const m4 = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const scl = new THREE.Vector3();
const target = new THREE.Vector3();

/**
 * Sunmotes — small shards of bottled daylight. They bob and spin, swoop to
 * Pip when he's near, and chime their way up a pentatonic scale when gathered
 * in quick succession.
 */
export class Motes {
  readonly mesh: THREE.InstancedMesh;
  readonly items: Mote[];
  collected = 0;

  constructor(points: THREE.Vector3[]) {
    const geo = new THREE.OctahedronGeometry(0.2, 0);
    geo.scale(1, 1.45, 1);
    this.mesh = new THREE.InstancedMesh(
      geo,
      mat(0xffd76a, { flat: true, emissive: 0xffa200, ei: 2.8, rough: 0.3 }),
      points.length,
    );
    this.mesh.frustumCulled = false;
    this.items = points.map((p, i) => ({ base: p.clone(), pos: p.clone(), phase: i * 0.9, state: 0, speed: 0 }));
  }

  get total() {
    return this.items.length;
  }

  reset() {
    this.collected = 0;
    for (const m of this.items) {
      m.state = 0;
      m.speed = 0;
      m.pos.copy(m.base);
    }
  }

  /** @param onCollect called with the mote's final position */
  update(dt: number, t: number, playerPos: THREE.Vector3, active: boolean, onCollect: (p: THREE.Vector3) => void) {
    target.copy(playerPos);
    target.y += 0.55;
    for (let i = 0; i < this.items.length; i++) {
      const m = this.items[i];
      let scale = 1;
      if (m.state === 0) {
        m.pos.set(m.base.x, m.base.y + Math.sin(t * 2.4 + m.phase) * 0.12, m.base.z);
        if (active && m.pos.distanceToSquared(target) < T.MAGNET_R * T.MAGNET_R) m.state = 1;
      } else if (m.state === 1) {
        // Accelerating swoop toward Pip.
        m.speed += 55 * dt;
        const d = m.pos.distanceTo(target);
        const stepLen = Math.min(d, (4 + m.speed) * dt);
        if (d > 1e-4) m.pos.addScaledVector(target.clone().sub(m.pos).divideScalar(d), stepLen);
        scale = 0.6 + Math.min(1, d / T.MAGNET_R) * 0.5;
        if (d - stepLen < T.COLLECT_R) {
          m.state = 2;
          this.collected++;
          onCollect(m.pos);
        }
      }
      if (m.state === 2) scale = 0;
      euler.set(0, t * 2.2 + m.phase, Math.sin(t * 1.3 + m.phase) * 0.25);
      quat.setFromEuler(euler);
      scl.setScalar(Math.max(0.0001, scale));
      m4.compose(m.pos, quat, scl);
      this.mesh.setMatrixAt(i, m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Skybloom — one of three rare lotus flowers tucked off the main path. */
export class Bloom {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  taken = false;
  private vanish = 0;

  constructor(pos: THREE.Vector3) {
    this.pos = pos.clone();
    this.group.position.copy(pos);
    const outer = mat(0xffd3e6, { emissive: 0xff7fb5, ei: 0.55, rough: 0.5 });
    const inner = mat(0xfff0f6, { emissive: 0xffa6cc, ei: 0.7, rough: 0.5 });
    const ring = (n: number, r: number, tilt: number, size: number, m: THREE.Material, y: number) => {
      for (let i = 0; i < n; i++) {
        const pivot = new THREE.Group();
        pivot.rotation.y = (i / n) * Math.PI * 2 + (r > 0.3 ? 0 : 0.4);
        const petal = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), m);
        petal.scale.set(0.5, 0.16, 1);
        petal.position.set(0, y, r);
        petal.rotation.x = -tilt;
        pivot.add(petal);
        this.group.add(pivot);
      }
    };
    ring(8, 0.36, 0.45, 0.34, outer, 0);
    ring(5, 0.2, 1.0, 0.26, inner, 0.1);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), mat(0xfff3a0, { emissive: 0xffc93c, ei: 3.2 }));
    core.position.y = 0.14;
    this.group.add(core);
  }

  collect() {
    this.taken = true;
    this.vanish = 1;
  }

  reset() {
    this.taken = false;
    this.vanish = 0;
    this.group.visible = true;
  }

  update(dt: number, t: number) {
    if (this.taken) {
      if (this.vanish > 0) {
        this.vanish = Math.max(0, this.vanish - dt * 3);
        const s = this.vanish * (1 + (1 - this.vanish) * 1.5);
        this.group.scale.setScalar(Math.max(0.001, s));
        this.group.rotation.y += dt * 14;
        if (this.vanish === 0) this.group.visible = false;
      }
      return;
    }
    this.group.position.y = this.pos.y + Math.sin(t * 1.6) * 0.16;
    this.group.rotation.y = t * 0.9;
    this.group.scale.setScalar(1 + Math.sin(t * 3.1) * 0.05);
  }
}

/** A lantern that lights when Pip reaches its isle and marks the respawn point. */
export class Checkpoint {
  readonly center: THREE.Vector3;
  readonly radius: number;
  readonly spawn: THREE.Vector3;
  readonly lantern: Lantern;
  lit = false;
  private level = 0;

  constructor(center: THREE.Vector3, radius: number, spawn: THREE.Vector3, lanternAt: THREE.Vector3) {
    this.center = center;
    this.radius = radius;
    this.spawn = spawn;
    this.lantern = buildLantern();
    this.lantern.group.position.copy(lanternAt);
  }

  get headWorld() {
    return this.lantern.head.clone().add(this.lantern.group.position);
  }

  reset() {
    this.lit = false;
    this.level = 0;
    this.lantern.glow.emissiveIntensity = 0;
    this.lantern.glow.color.set(0x8fa3b8);
  }

  update(dt: number, t: number) {
    if (!this.lit) return;
    this.level = Math.min(1, this.level + dt * 3);
    this.lantern.glow.color.set(0xffe2a0);
    this.lantern.glow.emissiveIntensity = this.level * (2.6 + Math.sin(t * 7) * 0.25);
  }
}

/** The Beacon at the summit — touching it completes the run. */
export class Beacon {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  private crystal: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private beam: THREE.Mesh;
  private excite = 0;

  constructor(pos: THREE.Vector3) {
    this.pos = pos.clone();
    this.group.position.copy(pos);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.3, 0.5, 8), mat(C.cream, { flat: true }));
    base.position.y = 0.25;
    base.castShadow = base.receiveShadow = true;
    const trim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 6, 8), mat(C.coral));
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.5;
    this.crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.62, 0),
      mat(0xfff6d8, { flat: true, emissive: 0xffc24a, ei: 2.4, rough: 0.2 }),
    );
    this.crystal.scale.y = 1.6;
    this.crystal.position.y = 2.2;
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.0 + i * 0.28, 0.035, 6, 48),
        mat(C.sun, { emissive: C.sun, ei: 1.6 }),
      );
      ring.position.y = 2.2;
      this.rings.push(ring);
    }
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.5, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffe2a0,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.beam.position.y = 32;
    this.group.add(base, trim, this.crystal, ...this.rings, this.beam);
  }

  ignite() {
    this.excite = 1;
  }
  reset() {
    this.excite = 0;
  }

  update(_dt: number, t: number) {
    const k = 1 + this.excite * 3;
    this.crystal.rotation.y = t * 0.8 * k;
    this.crystal.position.y = 2.2 + Math.sin(t * 1.4) * 0.14;
    this.rings[0].rotation.set(t * 0.7 * k, t * 0.4, 0);
    this.rings[1].rotation.set(0.6, t * 0.5 * k, t * 0.6);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(t * 2) * 0.03 + this.excite * 0.3;
    this.beam.scale.x = this.beam.scale.z = 1 + this.excite * 1.4;
  }
}
