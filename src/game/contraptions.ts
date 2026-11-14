import * as THREE from 'three';
import type { Game } from './Game';
import type { Player } from './player';
import { C, mat } from './materials';
import { clamp, damp } from './math';
import { Solid } from './solid';

const tmpColor = new THREE.Color();

/**
 * Bouncecap — a springy mushroom with memory.
 * It returns most of the speed you hit it with, plus a little extra, so every
 * consecutive bounce (or a drop from higher up) launches Pip further.
 */
export class Bouncecap extends Solid {
  private cap = new THREE.Group();
  private sq = 0;
  private sqV = 0;

  constructor(x: number, baseY: number, z: number, r: number, stemH: number) {
    super();
    this.kind = 'bounce';
    this.shape = 'cyl';
    this.oneWay = true;
    this.radius = r * 0.94;
    this.thickness = 0.5;
    const capH = r * 0.55;
    this.pos.set(x, baseY + stemH + capH * 0.88, z);
    this.group.position.set(x, baseY, z);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.42, stemH, 12), mat(C.cream));
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    this.group.add(stem);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(r, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      mat(C.coral, { rough: 0.55 }),
    );
    dome.scale.y = 0.55;
    dome.castShadow = true;
    const gills = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.97, r * 0.42, 0.16, 28), mat(C.cream));
    gills.position.y = -0.08;
    this.cap.add(dome, gills);
    // Cream spots.
    const spots: [number, number, number][] = [
      [0, 0, 0.36],
      [0.55, 0.2, 0.2],
      [-0.5, 0.45, 0.24],
      [0.1, -0.62, 0.22],
      [-0.25, -0.2, 0.14],
      [0.6, -0.4, 0.13],
    ];
    for (const [sx, sz, sr] of spots) {
      const spot = new THREE.Mesh(new THREE.SphereGeometry(sr * r, 12, 8), mat(C.cream, { rough: 0.6 }));
      const d = Math.hypot(sx, sz);
      spot.position.set(sx * r, Math.sqrt(Math.max(0, 1 - d * d)) * capH * 0.97, sz * r);
      spot.scale.y = 0.22;
      this.cap.add(spot);
    }
    this.cap.position.y = stemH;
    this.group.add(this.cap);
  }

  /** Returns Pip's launch speed for a given impact speed. */
  bounce(game: Game, impact: number, boosted: boolean): number {
    let out = clamp(impact * 0.8 + 4, 13, 25);
    if (boosted) out = Math.min(27, out + 3); // well-timed jump press
    this.sqV = -out * 0.42;
    const power = (out - 13) / 14;
    game.sfx.bounce(power);
    tmpColor.set(C.sun);
    game.spark.burst(this.pos, 8 + Math.round(power * 14), tmpColor, 3 + power * 4, { life: 0.6, size: 0.22, vy: 2 }, 2.2);
    game.shake(0.12 + power * 0.25);
    return out;
  }

  frame(dt: number) {
    // Damped spring: squash on impact, wobble back.
    this.sqV += (-240 * this.sq - 11 * this.sqV) * dt;
    this.sq = clamp(this.sq + this.sqV * dt, -0.6, 0.5);
    this.cap.scale.set(1 - this.sq * 0.35, 1 + this.sq, 1 - this.sq * 0.35);
  }
}

/**
 * Balance board — a plank on a pivot that leans under Pip's weight.
 * Stand off-centre and it tips; the steeper it tips, the faster Pip drifts
 * downhill, so crossing is a little act of balance.
 */
export class BalanceBoard extends Solid {
  private tiltX = 0;
  private tiltZ = 0;
  private vX = 0;
  private vZ = 0;
  private loaded = false;
  private loadX = 0;
  private loadZ = 0;
  private plank = new THREE.Group();
  private maxX: number;
  private maxZ: number;

  constructor(x: number, y: number, z: number, w: number, d: number) {
    super();
    this.kind = 'board';
    this.shape = 'box';
    this.oneWay = true;
    this.grip = 0.85;
    this.hx = w / 2;
    this.hz = d / 2;
    this.thickness = 0.4;
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);
    // The long axis tips freely; the short one only a little.
    this.maxX = d >= w ? 0.3 : 0.09;
    this.maxZ = w > d ? 0.3 : 0.09;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.24, d), mat(C.wood, { flat: true }));
    deck.position.y = -0.12;
    deck.castShadow = deck.receiveShadow = true;
    this.plank.add(deck);
    // Painted end caps + chevrons hint at "this tips".
    const long = Math.max(w, d);
    const alongZ = d >= w;
    for (let s = -1; s <= 1; s += 2) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(alongZ ? w + 0.06 : 0.5, 0.26, alongZ ? 0.5 : d + 0.06),
        mat(C.teal, { flat: true }),
      );
      cap.position.set(alongZ ? 0 : s * (long / 2 - 0.25), -0.12, alongZ ? s * (long / 2 - 0.25) : 0);
      cap.castShadow = true;
      this.plank.add(cap);
      for (let k = 1; k <= 2; k++) {
        const chev = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? w * 0.5 : 0.1, 0.02, alongZ ? 0.1 : d * 0.5), mat(C.cream));
        const off = s * (long / 2 - 0.5 - k * 0.5);
        chev.position.set(alongZ ? 0 : off, 0.005, alongZ ? off : 0);
        this.plank.add(chev);
      }
    }
    this.group.add(this.plank);

    // Pivot: ball joint on a post rooted in a small floating rock.
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), mat(C.coral, { rough: 0.5 }));
    joint.position.y = -0.42;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.5, 8), mat(C.woodDark, { flat: true }));
    post.position.y = -1.3;
    post.castShadow = true;
    const rock = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.7, 7), mat(0xb98a7d, { flat: true, rough: 0.9 }));
    rock.rotation.x = Math.PI;
    rock.position.y = -2.85;
    rock.castShadow = true;
    const turf = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.0, 0.22, 10), mat(C.turf));
    turf.position.y = -1.95;
    this.group.add(joint, post, rock, turf);
  }

  topAt(lx: number, lz: number) {
    return this.pos.y + lx * Math.tan(this.tiltZ) - lz * Math.tan(this.tiltX);
  }

  onLand(_game: Game, _player: Player, impact: number, lx: number, lz: number) {
    this.vX += lz * impact * 0.014;
    this.vZ -= lx * impact * 0.014;
  }

  onStand(_game: Game, player: Player, lx: number, lz: number, dt: number) {
    this.loaded = true;
    this.loadX = lx;
    this.loadZ = lz;
    // Drift downhill in proportion to the slope.
    const DRIFT = 7;
    player.pos.x -= Math.tan(this.tiltZ) * DRIFT * dt;
    player.pos.z += Math.tan(this.tiltX) * DRIFT * dt;
  }

  step(dt: number) {
    const W = 2.1; // weight torque
    const K = 22; // return spring
    const D = 5; // damping
    const tx = this.loaded ? this.loadZ : 0;
    const tz = this.loaded ? -this.loadX : 0;
    this.vX += (W * tx - K * this.tiltX - D * this.vX) * dt;
    this.vZ += (W * tz - K * this.tiltZ - D * this.vZ) * dt;
    this.tiltX += this.vX * dt;
    this.tiltZ += this.vZ * dt;
    if (Math.abs(this.tiltX) > this.maxX) {
      this.tiltX = Math.sign(this.tiltX) * this.maxX;
      this.vX *= -0.25;
    }
    if (Math.abs(this.tiltZ) > this.maxZ) {
      this.tiltZ = Math.sign(this.tiltZ) * this.maxZ;
      this.vZ *= -0.25;
    }
    this.loaded = false;
  }

  frame() {
    this.plank.rotation.x = this.tiltX;
    this.plank.rotation.z = this.tiltZ;
  }

  reset() {
    this.tiltX = this.tiltZ = this.vX = this.vZ = 0;
  }
}

export type EchoSet = 'A' | 'B';

/**
 * Echo tile — exists in one of two phases. Every time Pip jumps, the whole
 * world flips phase: amber tiles and violet tiles trade places between solid
 * and ghost. You always jump toward the tile that isn't there yet.
 */
export class EchoTile extends Solid {
  readonly set: EchoSet;
  private fill: THREE.Group;
  private level = 1;
  private target = 1;
  private flash = 0;
  private glow: THREE.MeshStandardMaterial;

  constructor(x: number, y: number, z: number, size: number, set: EchoSet) {
    super();
    this.kind = 'echo';
    this.set = set;
    this.shape = 'box';
    this.oneWay = true;
    this.hx = this.hz = size / 2;
    this.thickness = 0.4;
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);
    const color = set === 'A' ? C.amber : C.violet;

    // Ghost: a faint slab plus a bright wire frame — always visible.
    const box = new THREE.BoxGeometry(size, 0.3, size);
    const ghost = new THREE.Mesh(
      box,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false }),
    );
    ghost.position.y = -0.15;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    edges.position.y = -0.15;
    this.group.add(ghost, edges);

    // Solid: glowing slab with a symbol (ring = amber, diamond = violet) so
    // the two sets differ by shape as well as colour.
    this.fill = new THREE.Group();
    this.glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.45 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(size * 0.985, 0.29, size * 0.985), this.glow);
    slab.position.y = -0.15;
    slab.castShadow = slab.receiveShadow = true;
    const icon = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.2, 0.06, 6, set === 'A' ? 28 : 4),
      mat(0xffffff, { emissive: 0xffffff, ei: 1.1 }),
    );
    icon.rotation.x = Math.PI / 2;
    icon.position.y = 0.012;
    icon.scale.z = 0.3;
    this.fill.add(slab, icon);
    this.group.add(this.fill);
  }

  setSolid(solid: boolean, instant = false) {
    if (this.enabled !== solid) this.flash = 1;
    this.enabled = solid;
    this.target = solid ? 1 : 0;
    if (instant) {
      this.level = this.target;
      this.flash = 0;
    }
  }

  frame(dt: number) {
    this.level = damp(this.level, this.target, 16, dt);
    this.flash = Math.max(0, this.flash - dt * 3.5);
    const visible = this.level > 0.03;
    this.fill.visible = visible;
    if (visible) {
      const s = 0.72 + 0.28 * this.level + (this.enabled ? this.flash * 0.1 : 0);
      this.fill.scale.set(s, this.level, s);
    }
    this.glow.emissiveIntensity = 0.45 + this.flash * 1.6;
  }
}
