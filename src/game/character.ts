import * as THREE from 'three';
import { C, mat } from './materials';
import { clamp, damp } from './math';
import type { Player } from './player';

/**
 * Pip — a round little wanderer in a coral hood with pointed ears and a
 * glowing ember tail. Built from primitives and animated procedurally:
 * squash & stretch on a spring, a distance-driven run cycle, lean, bank,
 * blinks, and a rope-simulated tail for secondary motion.
 */
export class Character {
  readonly root = new THREE.Group();
  /** Fired on each footfall (dust + sound). */
  onStep: (() => void) | null = null;

  private lean = new THREE.Group();
  private squash = new THREE.Group();
  private eyes: THREE.Mesh[] = [];
  private feet: THREE.Mesh[] = [];
  private hands: THREE.Mesh[] = [];
  private ears: THREE.Mesh[] = [];
  private tail: THREE.Mesh[] = [];
  private tailPts: THREE.Vector3[] = [];
  private anchor = new THREE.Vector3();

  private sq = 0;
  private sqV = 0;
  private phase = 0;
  private lastFoot = 0;
  private blinkIn = 2;
  private blink = 0;
  private spin = 0;
  private leanX = 0;
  private bank = 0;
  private lastYaw = 0;
  private joy = 0;

  constructor(scene: THREE.Scene) {
    const cream = mat(C.cream, { rough: 0.7 });
    const coral = mat(C.coral, { rough: 0.6 });
    const dark = mat(C.coralDark, { rough: 0.7 });
    const ink = mat(0x1b1b2a, { rough: 0.25 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 28, 20), cream);
    body.scale.set(1, 1.08, 0.96);
    body.position.y = 0.5;

    // Hood: a cap over the top half, pulled low at the back.
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.425, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), coral);
    hood.scale.set(1.02, 1.12, 1.02);
    hood.position.set(0, 0.52, -0.035);
    hood.rotation.x = -0.32;

    for (let s = -1; s <= 1; s += 2) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 10), coral);
      ear.position.set(s * 0.23, 1.0, -0.04);
      ear.rotation.z = -s * 0.42;
      this.ears.push(ear);

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.068, 14, 10), ink);
      eye.position.set(s * 0.15, 0.55, 0.352);
      eye.scale.set(1, 1.3, 0.55);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), mat(0xffffff, { emissive: 0xffffff, ei: 0.6 }));
      glint.position.set(0.02, 0.025, 0.06);
      eye.add(glint);
      this.eyes.push(eye);

      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat(0xffa08f, { rough: 0.9 }));
      cheek.position.set(s * 0.27, 0.44, 0.285);
      cheek.scale.set(1, 0.6, 0.3);
      this.squash.add(cheek);

      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), dark);
      foot.scale.set(1, 0.72, 1.35);
      foot.position.set(s * 0.17, 0.09, 0.03);
      foot.castShadow = true;
      this.feet.push(foot);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), cream);
      hand.position.set(s * 0.43, 0.42, 0.02);
      this.hands.push(hand);
    }
    body.castShadow = hood.castShadow = true;
    this.squash.add(body, hood, ...this.ears, ...this.eyes, ...this.hands);
    this.lean.add(this.squash, ...this.feet);
    this.root.add(this.lean);
    scene.add(this.root);

    // Ember tail: teal beads ending in a glowing tip. Lives in world space.
    const radii = [0.095, 0.082, 0.07, 0.06, 0.085];
    radii.forEach((r, i) => {
      const last = i === radii.length - 1;
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(r, 10, 8),
        last ? mat(C.sun, { emissive: 0xffa520, ei: 3 }) : mat(C.teal, { rough: 0.6 }),
      );
      bead.castShadow = !last;
      this.tail.push(bead);
      this.tailPts.push(new THREE.Vector3());
      scene.add(bead);
    });
  }

  /** Impulse into the squash spring: + stretches tall, − squashes flat. */
  kick(v: number) {
    this.sqV += v;
  }
  startSpin() {
    this.spin = 1;
  }
  cheer() {
    this.joy = 1.2;
  }

  /** Call after teleporting so the tail doesn't streak across the level. */
  settle(p: Player) {
    this.root.position.copy(p.pos);
    this.root.rotation.y = p.facing;
    this.lastYaw = p.facing;
    this.root.updateMatrixWorld(true);
    this.anchor.set(0, 0.5, -0.4).applyMatrix4(this.root.matrixWorld);
    this.tailPts.forEach((pt, i) => pt.copy(this.anchor).add(new THREE.Vector3(0, -0.04 * i, 0)));
    this.sq = this.sqV = 0;
  }

  update(dt: number, t: number, p: Player, wind: THREE.Vector2) {
    const speedK = clamp(p.speed / 7.2, 0, 1.4);
    this.root.position.copy(p.pos);

    // --- Squash & stretch (volume-preserving spring).
    const airStretch = p.grounded ? 0 : clamp(Math.abs(p.vel.y) * 0.011, 0, 0.2);
    this.sqV += (-260 * (this.sq - airStretch) - 15 * this.sqV) * dt;
    this.sq = clamp(this.sq + this.sqV * dt, -0.45, 0.5);
    const sy = 1 + this.sq;
    const sxz = 1 / Math.sqrt(sy);
    this.squash.scale.set(sxz, sy, sxz);

    // --- Facing, lean into speed, bank into turns, dash spin.
    let dyaw = p.facing - this.lastYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.lastYaw = p.facing;
    this.spin = Math.max(0, this.spin - dt * 2.6);
    const spinAngle = (1 - Math.pow(1 - this.spin, 2)) * Math.PI * 4;
    this.root.rotation.y = p.facing + spinAngle;
    const targetLean = p.grounded ? speedK * 0.2 : clamp(-p.vel.y * 0.012, -0.22, 0.25);
    this.leanX = damp(this.leanX, targetLean, 10, dt);
    this.bank = damp(this.bank, clamp((-dyaw / Math.max(dt, 1e-4)) * 0.035, -0.35, 0.35) * speedK, 8, dt);
    this.lean.rotation.x = this.leanX;
    this.lean.rotation.z = this.bank;

    // --- Run cycle driven by distance travelled, so feet never skate.
    this.joy = Math.max(0, this.joy - dt);
    const moving = p.grounded && p.speed > 0.4;
    if (moving) this.phase += p.speed * dt * 2.7;
    const amp = moving ? Math.min(1, speedK * 1.3) : 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const ph = this.phase + (i === 0 ? 0 : Math.PI);
      const foot = this.feet[i];
      const hand = this.hands[i];
      if (p.grounded) {
        foot.position.set(side * 0.17, 0.09 + Math.max(0, Math.cos(ph)) * 0.15 * amp, 0.03 + Math.sin(ph) * 0.22 * amp);
        foot.rotation.x = -Math.cos(ph) * 0.5 * amp;
        hand.position.set(side * (0.43 + this.joy * 0.05), 0.42 + this.joy * 0.25, 0.02 - Math.sin(ph) * 0.2 * amp);
      } else {
        // Airborne: tuck when rising, dangle and flail a little when falling.
        const rising = p.vel.y > 0;
        const flail = rising ? 0 : Math.sin(t * 22 + i * 2) * 0.05;
        foot.position.set(side * (rising ? 0.14 : 0.2), rising ? 0.2 : 0.04 + flail, rising ? -0.08 : 0.06);
        foot.rotation.x = rising ? 0.7 : -0.3;
        hand.position.set(side * 0.46, rising ? 0.5 : 0.66 + flail, 0.02);
      }
    }
    this.squash.position.y = Math.abs(Math.sin(this.phase)) * 0.045 * amp + (moving ? 0 : Math.sin(t * 2.2) * 0.008);
    // Footfalls: one each time a foot swings past the bottom of its arc.
    const footIndex = Math.floor(this.phase / Math.PI);
    if (moving && footIndex !== this.lastFoot && p.speed > 2.5) this.onStep?.();
    this.lastFoot = footIndex;

    // --- Ears flop with vertical speed; eyes blink, widen when falling.
    const flop = clamp(p.vel.y * 0.02, -0.3, 0.3);
    this.ears[0].rotation.z = 0.42 + flop;
    this.ears[1].rotation.z = -0.42 - flop;
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkIn = 2 + Math.random() * 3.5;
      this.blink = 0.13;
    }
    this.blink = Math.max(0, this.blink - dt);
    const wide = !p.grounded && p.vel.y < -16 ? 1.22 : 1;
    const eyeY = this.joy > 0 ? 0.35 : this.blink > 0 ? 0.1 : 1.3 * wide;
    for (const eye of this.eyes) eye.scale.set(wide, eyeY, 0.55);

    // --- Tail: a simple rope following a point on Pip's back.
    this.root.updateMatrixWorld(true);
    this.anchor.set(0, 0.5 * sy, -0.4).applyMatrix4(this.root.matrixWorld);
    const pts = this.tailPts;
    pts[0].copy(this.anchor);
    const seg = 0.17;
    const floor = p.grounded ? p.pos.y + 0.09 : -Infinity;
    for (let i = 1; i < pts.length; i++) {
      const pt = pts[i];
      pt.y -= 1.5 * dt;
      pt.x += (wind.x * 0.9 + Math.sin(t * 5 + i) * 0.25) * dt;
      pt.z += (wind.y * 0.9 + Math.cos(t * 4.3 + i * 1.7) * 0.25) * dt;
      const prev = pts[i - 1];
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      const dz = pt.z - prev.z;
      const d = Math.hypot(dx, dy, dz) || 1e-4;
      const k = seg / d;
      pt.set(prev.x + dx * k, Math.max(floor, prev.y + dy * k), prev.z + dz * k);
    }
    for (let i = 0; i < pts.length; i++) this.tail[i].position.copy(pts[i]);
  }
}
