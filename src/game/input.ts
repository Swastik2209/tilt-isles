import type { ControlMode, InputFrame } from '../net/protocol';
import { clamp, damp } from './math';

export type InputSource = 'none' | 'phone' | 'keys';

const JUMP_KEYS = ['Space', 'KeyJ', 'KeyK'];
const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

/**
 * Merges the phone stream with a keyboard fallback into one clean input state
 * that the game reads once per frame.
 */
export class InputState {
  moveX = 0;
  moveY = 0;
  jumpHeld = false;
  /** Smoothed phone tilt in degrees — drives wind and the HUD phone widget. */
  roll = 0;
  pitch = 0;
  accel = 0;
  source: InputSource = 'none';
  mode: ControlMode | null = null;

  // Latest remote frame.
  private rx = 0;
  private ry = 0;
  private rHeld = false;
  private rRoll = 0;
  private rPitch = 0;
  private rAt = -1e9;
  private rSeq = -1;
  private rJump = -1;
  // Smoothed remote stick (hides the 30 Hz stepping).
  private sx = 0;
  private sy = 0;

  private keys = new Set<string>();
  private queued = 0;

  attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Call when a controller (re)joins so its fresh counters are accepted. */
  resetRemote() {
    this.rSeq = -1;
    this.rJump = -1;
  }

  get phoneFresh() {
    return performance.now() - this.rAt < 450;
  }

  setRemote(f: InputFrame) {
    // The direct channel is unordered: drop frames that arrive late.
    if (this.rSeq >= 0 && f.n <= this.rSeq && this.rSeq - f.n < 300) return;
    this.rSeq = f.n;
    this.rx = clamp(Number(f.x) || 0, -1, 1);
    this.ry = clamp(Number(f.y) || 0, -1, 1);
    this.rHeld = f.h === 1;
    this.rRoll = Number(f.r) || 0;
    this.rPitch = Number(f.p) || 0;
    this.accel = Number(f.a) || 0;
    this.mode = f.m;
    this.rAt = performance.now();
    // Jumps travel as a counter, so a lost packet never loses a jump.
    if (this.rJump >= 0 && f.j > this.rJump) this.queued = Math.min(2, this.queued + 1);
    this.rJump = f.j;
  }

  /** Returns true once per queued jump press. */
  consumeJump(): boolean {
    if (this.queued > 0) {
      this.queued--;
      return true;
    }
    return false;
  }

  update(dt: number) {
    const fresh = this.phoneFresh;
    this.sx = damp(this.sx, fresh ? this.rx : 0, 38, dt);
    this.sy = damp(this.sy, fresh ? this.ry : 0, 38, dt);

    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const kl = Math.hypot(kx, ky);
    const keyJump = JUMP_KEYS.some((c) => k.has(c));

    if (kl > 0) {
      this.moveX = kx / kl;
      this.moveY = ky / kl;
      this.source = 'keys';
    } else {
      this.moveX = Math.abs(this.sx) < 0.004 ? 0 : this.sx;
      this.moveY = Math.abs(this.sy) < 0.004 ? 0 : this.sy;
      if (fresh) this.source = 'phone';
      else if (this.source === 'phone') this.source = 'none';
    }
    if (keyJump) this.source = 'keys';
    this.jumpHeld = keyJump || (fresh && this.rHeld);

    // With no phone, fake a little tilt from the keys so the world still reacts.
    const tr = fresh ? this.rRoll : kx * 14;
    const tp = fresh ? this.rPitch : ky * 14;
    this.roll = damp(this.roll, tr, 12, dt);
    this.pitch = damp(this.pitch, tp, 12, dt);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (JUMP_KEYS.includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (JUMP_KEYS.includes(e.code)) this.queued = Math.min(2, this.queued + 1);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
  };
}
