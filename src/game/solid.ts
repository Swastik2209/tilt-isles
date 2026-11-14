import * as THREE from 'three';
import type { Game } from './Game';
import type { Player } from './player';

export type SolidKind = 'isle' | 'prop' | 'mover' | 'crumble' | 'bounce' | 'board' | 'echo';

/**
 * Anything Pip can stand on or bump into.
 *
 * Collision shapes are deliberately simple — an axis-aligned box or an upright
 * cylinder, described by the centre of the TOP surface (`pos`) and a thickness
 * extending downward. Subclasses add behaviour (moving, crumbling, tilting…).
 */
export class Solid {
  kind: SolidKind = 'isle';
  readonly group = new THREE.Group();
  /** Centre of the top surface, world space. */
  readonly pos = new THREE.Vector3();
  /** Movement during the last physics step (used to carry Pip). */
  readonly delta = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  enabled = true;
  /** One-way platforms only collide from above (no walls, no head bumps). */
  oneWay = false;
  /** Traction multiplier. */
  grip = 1;
  thickness = 1;
  shape: 'box' | 'cyl' = 'cyl';
  radius = 1;
  hx = 1;
  hz = 1;

  contains(lx: number, lz: number, margin: number): boolean {
    if (this.shape === 'cyl') {
      const r = this.radius + margin;
      return lx * lx + lz * lz <= r * r;
    }
    return Math.abs(lx) <= this.hx + margin && Math.abs(lz) <= this.hz + margin;
  }

  /** Height of the walkable surface at a local offset from the centre. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  topAt(_lx: number, _lz: number): number {
    return this.pos.y;
  }

  /** Fixed-rate simulation. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  step(_dt: number, _t: number, _game: Game): void {}
  /** Per-frame visuals. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  frame(_dt: number, _t: number, _game: Game): void {}
  /** Pip touched down with the given impact speed. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onLand(_game: Game, _player: Player, _impact: number, _lx: number, _lz: number): void {}
  /** Called every physics step while Pip stands here. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStand(_game: Game, _player: Player, _lx: number, _lz: number, _dt: number): void {}
  reset(): void {}
}

/** Invisible static collider for trunks, stems and pedestals. */
export class Prop extends Solid {
  constructor(x: number, topY: number, z: number, radius: number, thickness: number) {
    super();
    this.kind = 'prop';
    this.shape = 'cyl';
    this.radius = radius;
    this.thickness = thickness;
    this.pos.set(x, topY, z);
    this.group.visible = false;
  }
}
