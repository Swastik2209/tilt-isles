/**
 * Wire protocol shared by the phone controller and the desktop viewer.
 * Keys are deliberately terse: InputFrame is sent ~30x per second.
 */

export type Role = 'controller' | 'viewer';

/** flick = tilt + flick-to-jump, tap = tilt + jump button, stick = on-screen thumbstick. */
export type ControlMode = 'flick' | 'tap' | 'stick';

export interface InputFrame {
  k: 'in';
  /** Sequence number (lets the viewer drop stale / out-of-order frames). */
  n: number;
  /** Stick X in [-1, 1] — right is positive. */
  x: number;
  /** Stick Y in [-1, 1] — forward (away from the player) is positive. */
  y: number;
  /** Smoothed roll in degrees, relative to the calibrated rest pose. */
  r: number;
  /** Smoothed pitch in degrees, relative to the calibrated rest pose. */
  p: number;
  /** Linear acceleration magnitude envelope (m/s²). */
  a: number;
  /** Jump press counter — increments on every flick / tap. */
  j: number;
  /** Jump currently held (drives variable jump height). */
  h: 0 | 1;
  m: ControlMode;
  /** Raw, unfiltered sensor angles for advanced gestures. */
  rb?: number;
  rg?: number;
}

export interface ViewerState {
  k: 'state';
  phase: 'attract' | 'play' | 'done';
  motes: number;
  total: number;
  blooms: number;
  bloomTotal: number;
}

export type Msg =
  | InputFrame
  | ViewerState
  | { k: 'hello'; role: Role; id: string }
  | { k: 'ping'; t: number }
  | { k: 'pong'; t: number }
  | { k: 'cmd'; c: 'restart' }
  | { k: 'fx'; v: number | number[] }
  | { k: 'rtc'; kind: 'offer' | 'answer' | 'ice'; data: unknown; from: string };
