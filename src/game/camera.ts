import * as THREE from 'three';
import { clamp, damp, lerp, smooth } from './math';
import type { Player } from './player';

export type CameraMode = 'attract' | 'follow' | 'finish';

const PITCH = 0.42; // ~24° — high enough to judge jumps, low enough to see the horizon
const BASE_DIST = 13;

/**
 * Third-person camera with a fixed heading (tilting the phone "forward" always
 * means "into the screen"). It leads Pip slightly in his direction of travel,
 * ignores the bob of ordinary jumps, and shakes on impacts.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'attract';
  /** Centre of the slow orbit used on the finish screen. */
  readonly finishCenter = new THREE.Vector3();

  private focus = new THREE.Vector3();
  private focusY = 0;
  private targetY = 0;
  private pos = new THREE.Vector3(0, 8, 18);
  private look = new THREE.Vector3();
  private dPos = new THREE.Vector3();
  private dLook = new THREE.Vector3();
  private modeT = 10;
  private trauma = 0;
  private distScale = 1;
  private zoom = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.3, 1500);
    this.resize(aspect);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    // Pull back on narrow windows so the play space stays readable.
    this.distScale = aspect < 1.4 ? lerp(1.5, 1, clamp((aspect - 0.6) / 0.8, 0, 1)) : 1;
    this.camera.updateProjectionMatrix();
  }

  setMode(m: CameraMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.modeT = 0;
  }

  /** 0..1 — bigger hits, bigger shake (squared internally). */
  addShake(a: number) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  /** Jump the follow target straight to Pip (after a respawn). */
  snap(p: Player) {
    this.focus.copy(p.pos);
    this.focusY = this.targetY = p.pos.y;
    this.modeT = Math.min(this.modeT, 1.2);
  }

  /** Hard-place the camera (first frame). */
  place(p: Player) {
    this.snap(p);
    this.modeT = 10;
    this.computeDesired(0, p);
    this.pos.copy(this.dPos);
    this.look.copy(this.dLook);
  }

  private computeDesired(t: number, p: Player) {
    if (this.mode === 'attract') {
      // Gentle sway around the home isle with the whole level as backdrop.
      const a = 0.25 + Math.sin(t * 0.13) * 0.42;
      // Aim left of Pip so he sits clear of the pairing card.
      const c = this.dLook.set(-4.5, 2.2, -6);
      this.dPos.set(c.x + Math.sin(a) * 18, 7.5 + Math.sin(t * 0.21) * 1.2, c.z + Math.cos(a) * 18);
    } else if (this.mode === 'finish') {
      const a = t * 0.22;
      const c = this.dLook.copy(this.finishCenter);
      c.y += 1.6;
      this.dPos.set(c.x + Math.sin(a) * 12.5, c.y + 4.2, c.z + Math.cos(a) * 12.5);
    } else {
      const dist = (BASE_DIST + this.zoom) * this.distScale;
      this.dLook.set(this.focus.x, this.focusY + 1.3, this.focus.z - 1.6);
      this.dPos.set(this.focus.x, this.focusY + 0.9 + Math.sin(PITCH) * dist, this.focus.z + Math.cos(PITCH) * dist);
    }
  }

  update(dt: number, t: number, p: Player) {
    this.modeT += dt;

    // --- Follow target (kept current in every mode so transitions are smooth).
    this.focus.x = damp(this.focus.x, p.pos.x + p.vel.x * 0.26, 5.5, dt);
    this.focus.z = damp(this.focus.z, p.pos.z + p.vel.z * 0.2, 5.5, dt);
    if (p.grounded) this.targetY = p.pos.y;
    else {
      // Airborne: only chase when Pip leaves a comfortable vertical window.
      if (p.pos.y > this.targetY + 3.0) this.targetY = p.pos.y - 3.0;
      if (p.pos.y < this.targetY - 0.4) this.targetY = p.pos.y + 0.4;
    }
    this.focusY = damp(this.focusY, this.targetY, p.grounded ? 4.5 : 8, dt);
    const wantZoom = clamp(p.speed * 0.09, 0, 1.2) + (p.grounded ? 0 : clamp(p.airTime * 1.5, 0, 2.2));
    this.zoom = damp(this.zoom, wantZoom, 2.2, dt);

    this.computeDesired(t, p);
    // Ease between modes, then lock on tightly.
    const rate = lerp(1.8, 28, smooth(this.modeT / 2.2));
    this.pos.x = damp(this.pos.x, this.dPos.x, rate, dt);
    this.pos.y = damp(this.pos.y, this.dPos.y, rate, dt);
    this.pos.z = damp(this.pos.z, this.dPos.z, rate, dt);
    this.look.x = damp(this.look.x, this.dLook.x, rate, dt);
    this.look.y = damp(this.look.y, this.dLook.y, rate, dt);
    this.look.z = damp(this.look.z, this.dLook.z, rate, dt);

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    // --- Trauma-based shake.
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    if (this.trauma > 0.001) {
      const k = this.trauma * this.trauma;
      this.camera.position.x += Math.sin(t * 61.3) * Math.sin(t * 37.1 + 1.3) * k * 0.55;
      this.camera.position.y += Math.sin(t * 53.7 + 2.1) * Math.sin(t * 29.9) * k * 0.55;
      this.camera.rotation.z += Math.sin(t * 47.0 + 0.7) * k * 0.035;
    }
  }
}
