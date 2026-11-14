import * as THREE from 'three';
import type { Game } from './Game';
import type { Player } from './player';
import { C, mat } from './materials';
import { clamp, smooth } from './math';
import { buildIsle, type IsleShape } from './scenery';
import { Solid } from './solid';

/** Solid ground: a floating isle, round or rectangular. */
export class Island extends Solid {
  private shards: THREE.Object3D[] = [];

  constructor(x: number, y: number, z: number, shape: IsleShape, seed: number) {
    super();
    this.kind = 'isle';
    this.pos.set(x, y, z);
    if (shape.r !== undefined) {
      this.shape = 'cyl';
      this.radius = shape.r;
    } else {
      this.shape = 'box';
      this.hx = (shape.w ?? 2) / 2;
      this.hz = (shape.d ?? 2) / 2;
    }
    this.thickness = 1.4;
    this.group.add(buildIsle(shape, seed));
    this.group.position.copy(this.pos);
    this.group.traverse((o) => {
      if (o.name === 'shard') this.shards.push(o);
    });
    this.shards.forEach((s) => (s.userData.y0 = s.position.y));
  }

  frame(_dt: number, t: number) {
    for (const s of this.shards) {
      s.position.y = s.userData.y0 + Math.sin(t * 0.8 + s.userData.bob) * 0.18;
      s.rotation.y = t * 0.2 + s.userData.bob;
    }
  }
}

/** A drifting deck that glides between two points and carries Pip along. */
export class Mover extends Solid {
  private a: THREE.Vector3;
  private b: THREE.Vector3;
  private period: number;
  private phase: number;
  private crystal: THREE.Mesh;
  private next = new THREE.Vector3();

  constructor(a: THREE.Vector3, b: THREE.Vector3, size: number, period: number, phase = 0) {
    super();
    this.kind = 'mover';
    this.shape = 'box';
    this.oneWay = true;
    this.hx = this.hz = size / 2;
    this.thickness = 0.4;
    this.a = a;
    this.b = b;
    this.period = period;
    this.phase = phase;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(size, 0.26, size), mat(C.wood, { flat: true }));
    deck.position.y = -0.13;
    deck.castShadow = deck.receiveShadow = true;
    this.group.add(deck);
    // Plank seams + a painted border so the edge reads clearly from above.
    for (let i = -1; i <= 1; i += 2) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, size * 0.9), mat(C.woodDark));
      seam.position.set((i * size) / 6, 0.005, 0);
      this.group.add(seam);
      const railX = new THREE.Mesh(new THREE.BoxGeometry(size + 0.14, 0.34, 0.14), mat(C.coral, { flat: true }));
      railX.position.set(0, -0.15, (i * size) / 2);
      const railZ = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, size + 0.14), mat(C.coral, { flat: true }));
      railZ.position.set((i * size) / 2, -0.15, 0);
      railX.castShadow = railZ.castShadow = true;
      this.group.add(railX, railZ);
    }
    const keel = new THREE.Mesh(new THREE.ConeGeometry(size * 0.5, 0.9, 4), mat(C.woodDark, { flat: true }));
    keel.rotation.set(Math.PI, Math.PI / 4, 0);
    keel.position.y = -0.72;
    keel.castShadow = true;
    this.group.add(keel);
    // Levitation crystal.
    this.crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3, 0),
      mat(C.teal, { flat: true, emissive: C.teal, ei: 2.2, rough: 0.3 }),
    );
    this.crystal.position.y = -1.5;
    this.crystal.scale.y = 1.5;
    this.group.add(this.crystal);

    this.evaluate(0, this.pos);
    this.group.position.copy(this.pos);
  }

  private evaluate(t: number, out: THREE.Vector3) {
    const s = (((t / this.period + this.phase) % 1) + 1) % 1;
    const tri = s < 0.5 ? s * 2 : 2 - s * 2;
    // Dwell briefly at each end, ease in between.
    const e = smooth((tri - 0.1) / 0.8);
    out.lerpVectors(this.a, this.b, e);
  }

  step(dt: number, t: number) {
    this.evaluate(t, this.next);
    this.delta.subVectors(this.next, this.pos);
    this.vel.copy(this.delta).divideScalar(dt);
    this.pos.copy(this.next);
    this.group.position.copy(this.pos);
  }

  frame(_dt: number, t: number, game: Game) {
    this.crystal.rotation.y = t * 1.6;
    this.crystal.position.y = -1.5 + Math.sin(t * 2.2 + this.phase * 6) * 0.08;
    if (Math.random() < 0.12) {
      game.spark.emit({
        x: this.pos.x + (Math.random() - 0.5) * 0.3,
        y: this.pos.y - 1.7,
        z: this.pos.z + (Math.random() - 0.5) * 0.3,
        vy: -0.9,
        life: 0.7,
        size: 0.13,
        r: 0.2,
        g: 1.5,
        b: 1.3,
        alpha: 0.9,
      });
    }
  }
}

interface Chunk {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

/** Slate that shudders under Pip, breaks apart, and later reforms. */
export class Crumble extends Solid {
  private state: 'idle' | 'shaking' | 'fallen' = 'idle';
  private timer = 0;
  private pop = 1;
  private chunks: Chunk[] = [];

  constructor(x: number, y: number, z: number, size: number) {
    super();
    this.kind = 'crumble';
    this.shape = 'box';
    this.oneWay = true;
    this.hx = this.hz = size / 2;
    this.thickness = 0.4;
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);

    // Four quadrant chunks with hairline gaps, so it visibly comes apart.
    const q = size / 2 - 0.03;
    for (let ix = -1; ix <= 1; ix += 2) {
      for (let iz = -1; iz <= 1; iz += 2) {
        const light = ix * iz > 0;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(q, 0.34, q),
          mat(light ? C.slate : C.slateDark, { flat: true, rough: 0.7 }),
        );
        const home = new THREE.Vector3((ix * size) / 4, -0.17, (iz * size) / 4);
        mesh.position.copy(home);
        mesh.castShadow = mesh.receiveShadow = true;
        this.group.add(mesh);
        this.chunks.push({ mesh, home, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
      }
    }
  }

  onStand(game: Game) {
    if (this.state !== 'idle') return;
    this.state = 'shaking';
    this.timer = 0.62;
    game.sfx.crumbleWarn();
  }

  step(dt: number, _t: number, game: Game) {
    if (this.state === 'shaking') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'fallen';
        this.timer = 3.2;
        this.enabled = false;
        game.sfx.crumbleFall();
        for (const c of this.chunks) {
          c.vel.set(c.home.x * (1 + Math.random()), -1 - Math.random() * 2, c.home.z * (1 + Math.random()));
          c.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(7);
        }
        for (let i = 0; i < 10; i++) {
          game.dust.emit({
            x: this.pos.x + (Math.random() - 0.5) * this.hx * 2,
            y: this.pos.y - 0.1,
            z: this.pos.z + (Math.random() - 0.5) * this.hz * 2,
            vy: -0.5 - Math.random(),
            life: 0.7,
            size: 0.45,
            r: 0.75,
            g: 0.8,
            b: 0.95,
            alpha: 0.6,
            drag: 1.5,
          });
        }
      }
    } else if (this.state === 'fallen') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.reset();
        this.pop = 0;
        game.sfx.crumbleBack();
      }
    }
  }

  frame(dt: number, t: number) {
    this.pop = Math.min(1, this.pop + dt * 3.2);
    // Overshooting pop-in when the slate reforms.
    const p = this.pop;
    const scale = p < 1 ? 1 + Math.sin(p * Math.PI) * 0.18 - (1 - p) * (1 - p) : 1;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (this.state === 'fallen') {
        c.vel.y -= 26 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.spin.x * dt;
        c.mesh.rotation.y += c.spin.y * dt;
        c.mesh.rotation.z += c.spin.z * dt;
        const k = clamp(1 + (c.mesh.position.y + 2) / 14, 0, 1);
        c.mesh.scale.setScalar(k);
      } else {
        const shake = this.state === 'shaking' ? 0.035 + (0.62 - this.timer) * 0.07 : 0;
        c.mesh.position.set(
          c.home.x + Math.sin(t * 71 + i * 2.1) * shake,
          c.home.y + Math.sin(t * 93 + i * 1.3) * shake,
          c.home.z + Math.cos(t * 83 + i * 3.7) * shake,
        );
        c.mesh.rotation.set(0, 0, 0);
        c.mesh.scale.setScalar(Math.max(0.001, scale));
      }
    }
  }

  reset() {
    this.state = 'idle';
    this.enabled = true;
    this.timer = 0;
    this.pop = 1;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onLand(_g: Game, _p: Player) {}
}
