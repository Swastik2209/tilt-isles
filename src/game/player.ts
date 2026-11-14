import * as THREE from 'three';
import type { Bouncecap } from './contraptions';
import type { Game } from './Game';
import { dampAngle } from './math';
import type { Solid } from './solid';
import { T } from './tuning';

export interface StepInput {
  /** Desired movement in world space, magnitude 0..1. */
  mx: number;
  mz: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
}

/**
 * Pip's kinematic character controller.
 *
 * Runs at a fixed 120 Hz. Movement is resolved horizontally (walls), then
 * vertically (floors / ceilings). While grounded, velocity is expressed in the
 * frame of whatever Pip stands on, so moving platforms carry momentum
 * naturally: jump off a moving deck and you keep its speed.
 */
export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  grounded = false;
  ground: Solid | null = null;
  /** Yaw of the character model (0 faces +z, toward the camera). */
  facing = 0;
  dashT = 0;
  dashAvailable = true;
  airTime = 0;
  lastGroundY = 0;
  /** Horizontal speed, for animation. */
  speed = 0;

  private coyote = 0;
  private buffer = 0;
  private recover = 0;
  /** Rising from a real jump (eligible for the early-release height cut). */
  private jumping = false;
  /** Launched by a bounce/dash — ignore jump release. */
  private noCut = false;
  private dashX = 0;
  private dashZ = 0;

  teleport(p: THREE.Vector3, facing = 0) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.ground = null;
    this.facing = facing;
    this.dashT = 0;
    this.dashAvailable = true;
    this.coyote = this.buffer = this.recover = 0;
    this.jumping = this.noCut = false;
    this.airTime = 0;
    this.lastGroundY = p.y;
  }

  /** Swap reference frames so world-space momentum is preserved. */
  private setGround(g: Solid | null) {
    const old = this.ground;
    if (old === g) return;
    if (old) {
      this.vel.x += old.vel.x;
      this.vel.z += old.vel.z;
    }
    if (g) {
      this.vel.x -= g.vel.x;
      this.vel.z -= g.vel.z;
    }
    this.ground = g;
  }

  step(dt: number, inp: StepInput, solids: Solid[], game: Game) {
    const { pos, vel } = this;
    const wasGrounded = this.grounded;
    let canSnap = wasGrounded;

    // 1. Ride whatever we're standing on.
    if (this.ground) {
      if (this.ground.enabled) pos.add(this.ground.delta);
      else {
        this.setGround(null);
        this.grounded = false;
      }
    }

    // 2. Timers.
    this.coyote = wasGrounded ? T.COYOTE : this.coyote - dt;
    this.buffer = inp.jumpPressed ? T.BUFFER : this.buffer - dt;
    this.recover -= dt;
    this.airTime = wasGrounded ? 0 : this.airTime + dt;

    // 3. Jump / spin dash.
    if (inp.jumpPressed && !wasGrounded && this.coyote <= 0) {
      // Mid-air press: if we're about to land, keep it buffered as a jump;
      // otherwise it's a spin dash.
      const gy = game.groundBelow(pos.x, pos.y, pos.z);
      const h = gy === null ? Infinity : pos.y - gy;
      const landingSoon = vel.y <= 0 && h < Math.max(0.45, -vel.y * T.BUFFER);
      if (!landingSoon && this.dashAvailable) {
        const len = Math.hypot(inp.mx, inp.mz);
        if (len > 0.2) {
          this.dashX = inp.mx / len;
          this.dashZ = inp.mz / len;
        } else {
          this.dashX = Math.sin(this.facing);
          this.dashZ = Math.cos(this.facing);
        }
        this.dashT = T.DASH_TIME;
        this.dashAvailable = false;
        this.noCut = true;
        this.buffer = 0;
        vel.y = Math.max(vel.y, T.DASH_UP);
        this.facing = Math.atan2(this.dashX, this.dashZ);
        game.onPlayerDash();
      }
    }
    if (this.buffer > 0 && this.coyote > 0) {
      const g = this.ground;
      vel.y = T.JUMP_V + (g ? Math.max(0, g.vel.y) * 0.7 : 0);
      this.setGround(null);
      this.grounded = false;
      canSnap = false;
      this.coyote = 0;
      this.buffer = 0;
      this.jumping = true;
      this.noCut = false;
      game.onPlayerJump();
    }

    // 4. Horizontal velocity: move toward the stick's target velocity.
    const inLen = Math.min(1, Math.hypot(inp.mx, inp.mz));
    if (this.dashT > 0) {
      this.dashT -= dt;
      vel.x = this.dashX * T.DASH_SPEED;
      vel.z = this.dashZ * T.DASH_SPEED;
    } else {
      const maxSp = T.MAX_SPEED * (this.recover > 0 ? T.RECOVER_MULT : 1);
      const tx = inp.mx * maxSp;
      const tz = inp.mz * maxSp;
      let rate: number;
      if (this.grounded) {
        rate = inLen > 0.02 ? T.GROUND_ACCEL : T.GROUND_DECEL;
        if (inLen > 0.02 && vel.x * tx + vel.z * tz < 0) rate = T.TURN_ACCEL;
        rate *= this.ground ? this.ground.grip : 1;
      } else {
        rate = inLen > 0.02 ? T.AIR_ACCEL : T.AIR_DECEL;
      }
      const dx = tx - vel.x;
      const dz = tz - vel.z;
      const dl = Math.hypot(dx, dz);
      const maxStep = rate * dt;
      if (dl <= maxStep) {
        vel.x = tx;
        vel.z = tz;
      } else {
        vel.x += (dx / dl) * maxStep;
        vel.z += (dz / dl) * maxStep;
      }
    }
    if (inLen > 0.12 && this.dashT <= 0) {
      this.facing = dampAngle(this.facing, Math.atan2(inp.mx, inp.mz), this.grounded ? 16 : 9, dt);
    }

    // 5. Gravity — asymmetric, with a soft apex and an early-release cut.
    if (!this.grounded) {
      let g = vel.y > 0 ? T.GRAV_UP : T.GRAV_DOWN;
      if (vel.y > 0 && this.jumping && !this.noCut && !inp.jumpHeld) g *= T.CUT_MULT;
      else if (Math.abs(vel.y) < T.HANG_V) g *= T.HANG_MULT;
      if (this.dashT > 0) g *= 0.25;
      vel.y = Math.max(-T.TERMINAL, vel.y - g * dt);
    }

    // 6. Horizontal move + wall push-out (full solids only).
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s.enabled || s.oneWay) continue;
      const top = s.pos.y;
      if (pos.y >= top - T.LEDGE || pos.y + T.HEIGHT <= top - s.thickness) continue;
      const lx = pos.x - s.pos.x;
      const lz = pos.z - s.pos.z;
      let nx = 0;
      let nz = 0;
      let pen = 0;
      if (s.shape === 'cyl') {
        const d = Math.hypot(lx, lz);
        if (d >= s.radius + T.RADIUS) continue;
        nx = d > 1e-5 ? lx / d : 1;
        nz = d > 1e-5 ? lz / d : 0;
        pen = s.radius + T.RADIUS - d;
      } else {
        const cx = Math.max(-s.hx, Math.min(s.hx, lx));
        const cz = Math.max(-s.hz, Math.min(s.hz, lz));
        const ox = lx - cx;
        const oz = lz - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= T.RADIUS * T.RADIUS) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = ox / d;
          nz = oz / d;
          pen = T.RADIUS - d;
        } else {
          // Centre is inside the box: leave through the nearest face.
          const px = s.hx - Math.abs(lx);
          const pz = s.hz - Math.abs(lz);
          if (px < pz) {
            nx = lx >= 0 ? 1 : -1;
            pen = px + T.RADIUS;
          } else {
            nz = lz >= 0 ? 1 : -1;
            pen = pz + T.RADIUS;
          }
        }
      }
      pos.x += nx * pen;
      pos.z += nz * pen;
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) {
        vel.x -= nx * vn;
        vel.z -= nz * vn;
      }
    }

    // 7. Vertical move + floors / ceilings.
    const prevY = pos.y;
    pos.y += vel.y * dt;
    const snap = canSnap && vel.y <= 0 ? T.SNAP : 0;
    let best: Solid | null = null;
    let bestTop = -Infinity;
    let bestLx = 0;
    let bestLz = 0;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s.enabled) continue;
      const lx = pos.x - s.pos.x;
      const lz = pos.z - s.pos.z;
      if (!s.contains(lx, lz, T.EDGE_MARGIN)) continue;
      const top = s.topAt(lx, lz);
      const prevTop = top - s.delta.y;
      const relVy = canSnap && this.ground === s ? 0 : vel.y - s.vel.y;
      if (relVy <= 0.01 && pos.y <= top + snap && prevY >= prevTop - T.LEDGE) {
        if (top > bestTop) {
          best = s;
          bestTop = top;
          bestLx = lx;
          bestLz = lz;
        }
      } else if (!s.oneWay && vel.y > 0 && s.contains(lx, lz, 0)) {
        const bottom = s.pos.y - s.thickness;
        if (pos.y + T.HEIGHT > bottom && prevY + T.HEIGHT <= bottom + 0.25) {
          pos.y = bottom - T.HEIGHT;
          vel.y = -1;
        }
      }
    }

    if (best) {
      const impact = wasGrounded ? 0 : Math.max(0, -(vel.y - best.vel.y));
      pos.y = bestTop;
      if (best.kind === 'bounce') {
        // Bouncecaps never ground Pip — they throw him straight back up.
        const boosted = this.buffer > 0;
        vel.y = (best as Bouncecap).bounce(game, impact, boosted);
        this.setGround(null);
        this.grounded = false;
        this.dashAvailable = true;
        this.dashT = 0;
        this.jumping = false;
        this.noCut = true;
        this.buffer = 0;
        this.coyote = 0;
        game.onPlayerBounce(vel.y);
      } else {
        this.setGround(best);
        vel.y = 0;
        this.grounded = true;
        this.dashAvailable = true;
        this.jumping = false;
        this.noCut = false;
        this.lastGroundY = pos.y;
        if (!wasGrounded) {
          this.dashT = 0;
          if (impact > T.HARD_LAND) this.recover = T.RECOVER_TIME;
          best.onLand(game, this, impact, bestLx, bestLz);
          game.onPlayerLand(impact);
        }
        best.onStand(game, this, bestLx, bestLz, dt);
      }
    } else {
      if (this.ground) this.setGround(null);
      this.grounded = false;
    }

    this.speed = Math.hypot(vel.x, vel.z);
  }
}
