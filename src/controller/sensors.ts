import { OneEuro } from './filters';

/**
 * Phone motion pipeline:
 *
 *   deviceorientation ─► gravity vector ─► tilt relative to calibrated pose
 *                      ─► One Euro low-pass ─► dead-zone + response curve ─► stick
 *   devicemotion      ─► linear accel magnitude ─► flick detection (+ gesture gate)
 *
 * Working from the gravity vector (instead of raw beta/gamma) means any
 * comfortable rest pose works — flat like a tray, angled toward your face,
 * portrait or landscape — and there are no Euler-angle flips.
 */

type V3 = [number, number, number];
const DEG = Math.PI / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export type PermissionResult = 'granted' | 'denied' | 'unsupported';

interface PermissionAPI {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * iOS 13+ requires an explicit permission prompt triggered from a user gesture.
 * Android / desktop browsers expose the events without one. Both requests are
 * started synchronously so they share the same user activation.
 */
export async function requestMotionPermission(): Promise<PermissionResult> {
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'unsupported';
  const ori = DeviceOrientationEvent as unknown as PermissionAPI;
  const mot = (typeof DeviceMotionEvent !== 'undefined' ? DeviceMotionEvent : {}) as unknown as PermissionAPI;
  try {
    const asks: Promise<'granted' | 'denied'>[] = [];
    if (typeof ori.requestPermission === 'function') asks.push(ori.requestPermission());
    if (typeof mot.requestPermission === 'function') asks.push(mot.requestPermission());
    if (asks.length === 0) return 'granted';
    const results = await Promise.all(asks);
    return results.every((r) => r === 'granted') ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((Math.round(a / 90) * 90) % 360 + 360) % 360;
}

export class MotionPipeline {
  /** Latest processed values — read by the send loop and the UI. */
  sample = { roll: 0, pitch: 0, x: 0, y: 0, accel: 0, rawBeta: 0, rawGamma: 0 };

  /** Degrees of tilt that map to full stick deflection. */
  maxTilt = 22;
  /** m/s² of linear acceleration that counts as a flick. */
  flickThreshold = 12;
  flickEnabled = true;
  /** True for a short while after a flick — longer for harder flicks. */
  flickHeld = false;
  onFlick: (() => void) | null = null;

  private lastEventAt = 0;
  private up: V3 = [0, 0, 1];
  private ref: V3 | null = null;
  private axisX: V3 = [1, 0, 0];
  private axisY: V3 = [0, 1, 0];
  private fRoll = new OneEuro(1.6, 0.045, 1);
  private fPitch = new OneEuro(1.6, 0.045, 1);
  private gateUntil = 0;
  private lastFlick = 0;
  private lastMotionT = 0;
  private heldX = 0;
  private heldY = 0;
  private sawLinear = false;
  private running = false;

  /** True if orientation events are actually arriving. */
  get alive() {
    return performance.now() - this.lastEventAt < 1200;
  }

  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('deviceorientation', this.onOrientation);
    window.addEventListener('devicemotion', this.onMotion);
    window.addEventListener('orientationchange', this.calibrate);
  }

  stop() {
    this.running = false;
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('devicemotion', this.onMotion);
    window.removeEventListener('orientationchange', this.calibrate);
  }

  /** Treat the current pose as "neutral". */
  calibrate = () => {
    this.ref = null;
    this.fRoll.reset();
    this.fPitch.reset();
    this.heldX = 0;
    this.heldY = 0;
  };

  private setReference(up: V3) {
    this.ref = up;
    // Which device axis is "screen right" depends on how the UI is rotated.
    const angle = screenAngle();
    const right: V3 = angle === 90 ? [0, -1, 0] : angle === 270 ? [0, 1, 0] : angle === 180 ? [-1, 0, 0] : [1, 0, 0];
    const d = dot(right, up);
    let x: V3 = [right[0] - up[0] * d, right[1] - up[1] * d, right[2] - up[2] * d];
    if (Math.hypot(x[0], x[1], x[2]) < 0.15) x = [0, 0, 1]; // phone held on its edge — degenerate, pick something sane
    this.axisX = norm(x);
    this.axisY = norm(cross(up, this.axisX));
  }

  private onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    const now = performance.now();
    this.lastEventAt = now;
    const b = e.beta * DEG;
    const g = e.gamma * DEG;
    // World "up" expressed in device coordinates.
    const up: V3 = [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
    this.up = up;
    if (!this.ref) this.setReference(up);
    const ref = this.ref as V3;

    const uz = dot(up, ref);
    const rollRaw = Math.atan2(-dot(up, this.axisX), uz) / DEG; // right edge down = +
    const pitchRaw = Math.atan2(-dot(up, this.axisY), uz) / DEG; // top edge down (away) = +

    const roll = this.fRoll.filter(rollRaw, now);
    const pitch = this.fPitch.filter(pitchRaw, now);

    let x = this.curve(roll);
    let y = this.curve(pitch);
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }

    // Gesture gate: a flick rocks the phone, so hold the last steady stick
    // value while the acceleration spike passes.
    if (this.flickEnabled && now < this.gateUntil) {
      x = this.heldX;
      y = this.heldY;
    } else {
      this.heldX = x;
      this.heldY = y;
    }

    const s = this.sample;
    s.roll = roll;
    s.pitch = pitch;
    s.x = x;
    s.y = y;
    s.rawBeta = e.beta;
    s.rawGamma = e.gamma;
  };

  /** Dead-zone + gentle power curve: precise near centre, full speed at the edge. */
  private curve(deg: number): number {
    const dead = 2;
    const a = Math.abs(deg);
    if (a <= dead) return 0;
    const t = Math.min(1, (a - dead) / Math.max(4, this.maxTilt - dead));
    return Math.sign(deg) * Math.pow(t, 1.25);
  }

  private onMotion = (e: DeviceMotionEvent) => {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastMotionT) / 1000));
    this.lastMotionT = now;

    let mag = 0;
    const a = e.acceleration;
    if (a && a.x != null && a.y != null && a.z != null && (this.sawLinear || a.x !== 0 || a.y !== 0 || a.z !== 0)) {
      this.sawLinear = true;
      mag = Math.hypot(a.x, a.y, a.z);
    } else {
      const g = e.accelerationIncludingGravity;
      if (g && g.x != null && g.y != null && g.z != null) mag = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
    }

    // Envelope follower: instant attack, quick release. Drives the on-screen meter.
    const s = this.sample;
    s.accel = Math.max(mag, s.accel - 55 * dt);

    if (!this.flickEnabled) {
      this.flickHeld = false;
      return;
    }
    const thr = this.flickThreshold;
    if (mag > thr * 0.5) this.gateUntil = now + 150;
    if (mag > thr && now - this.lastFlick > 300) {
      this.lastFlick = now;
      this.flickHeld = true;
      this.onFlick?.();
    }
    // Stronger flicks keep the envelope up for longer => higher jump.
    if (this.flickHeld) {
      const age = now - this.lastFlick;
      if ((age > 110 && s.accel < thr * 0.55) || age > 360) this.flickHeld = false;
    }
  };
}
