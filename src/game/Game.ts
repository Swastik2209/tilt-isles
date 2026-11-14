import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Sfx } from './audio';
import { CameraRig } from './camera';
import { Character } from './character';
import { Beacon, Bloom, Motes } from './collectibles';
import { Environment } from './environment';
import { InputState } from './input';
import { buildLevel, type Level } from './level';
import { C } from './materials';
import { clamp, damp } from './math';
import { ParticleSystem } from './particles';
import { Player } from './player';
import { T } from './tuning';

export type Phase = 'attract' | 'play' | 'done';

export interface FinishStats {
  timeMs: number;
  motes: number;
  total: number;
  blooms: number;
  bloomTotal: number;
  falls: number;
  mode: string;
}

export type GameEvent =
  | { type: 'hud'; motes: number; total: number; blooms: number; bloomTotal: number; falls: number }
  | { type: 'hint'; text: string }
  | { type: 'phase'; phase: Phase }
  | { type: 'respawn' }
  | { type: 'finish'; stats: FinishStats }
  | { type: 'haptic'; pattern: number | number[] };

const cDust = new THREE.Color(0xfff4e0);
const cSun = new THREE.Color(C.sun);
const cPink = new THREE.Color(0xff8fc0);
const cTeal = new THREE.Color(C.teal);
const cWhite = new THREE.Color(0xfff6d8);
const tmp = new THREE.Vector3();

/**
 * Orchestrates everything on the desktop: renderer + post-processing, the
 * fixed-step simulation, game rules (collecting, checkpoints, finishing) and
 * all the "juice" hooks that the player controller and platforms call into.
 */
export class Game {
  readonly input = new InputState();
  readonly sfx = new Sfx();
  readonly dust: ParticleSystem;
  readonly spark: ParticleSystem;
  readonly player = new Player();
  phase: Phase = 'attract';

  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private scene = new THREE.Scene();
  private rig: CameraRig;
  private env: Environment;
  private level: Level;
  private character: Character;
  private motes: Motes;
  private blooms: Bloom[];
  private beacon: Beacon;
  private blob: THREE.Mesh;
  private particleScale = { value: 600 };
  private wind = new THREE.Vector2(0.3, 0);

  private onEvent: (e: GameEvent) => void;
  private container: HTMLElement;
  private ro: ResizeObserver;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private simT = 0;
  private clock = 0;
  private hitStopT = 0;
  private pendingJump = false;
  private runTime = 0;
  private timerOn = false;
  private falls = 0;
  private combo = 0;
  private comboT = 0;
  private echoA = true;
  private cpIndex = -1;
  private hintsShown = new Set<number>();
  private celebrateT = 0;
  private frameMs = 16;
  private slowFrames = 0;
  private pixelRatio: number;
  private disposed = false;

  constructor(container: HTMLElement, onEvent: (e: GameEvent) => void) {
    this.container = container;
    this.onEvent = onEvent;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.rig = new CameraRig(w / h);
    // HDR, multisampled target → clean edges and bloom that only catches real glow.
    const target = new THREE.WebGLRenderTarget(w * this.pixelRatio, h * this.pixelRatio, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.48, 0.7, 1.28));
    this.composer.addPass(new OutputPass());

    this.env = new Environment(this.scene, this.particleScale);
    this.dust = new ParticleSystem(500, false, this.particleScale);
    this.spark = new ParticleSystem(900, true, this.particleScale);
    this.scene.add(this.dust.points, this.spark.points);

    this.level = buildLevel(this.scene, this.env.sway);
    this.motes = new Motes(this.level.motePoints);
    this.scene.add(this.motes.mesh);
    this.blooms = this.level.bloomPoints.map((p) => new Bloom(p));
    this.blooms.forEach((b) => this.scene.add(b.group));
    this.beacon = new Beacon(this.level.beaconPos);
    this.scene.add(this.beacon.group);
    this.rig.finishCenter.copy(this.level.beaconPos);

    this.character = new Character(this.scene);
    this.character.onStep = () => {
      this.sfx.step();
      this.puff(this.player.pos, 2, 0.8, 0.22);
    };

    // Blob shadow: the single most important depth cue in a 3D platformer.
    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x10222e, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 2;
    this.scene.add(this.blob);

    this.player.teleport(this.level.spawn, 0.35);
    this.applyEcho(true);
    this.character.settle(this.player);
    this.rig.place(this.player);
    this.resize();

    this.input.attach();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ─────────────────────────────────────────────────────────── public API

  get timeMs() {
    return this.runTime * 1000;
  }

  /** Leave the lobby and hand control to the player. */
  begin() {
    if (this.phase !== 'attract') return;
    this.setPhase('play');
    this.rig.setMode('follow');
    this.emitHud();
  }

  restart() {
    this.runTime = 0;
    this.timerOn = false;
    this.falls = 0;
    this.combo = 0;
    this.cpIndex = -1;
    this.hintsShown.clear();
    this.motes.reset();
    this.blooms.forEach((b) => b.reset());
    this.level.checkpoints.forEach((c) => c.reset());
    this.level.solids.forEach((s) => s.reset());
    this.beacon.reset();
    this.echoA = true;
    this.applyEcho(true);
    this.player.teleport(tmp.copy(this.level.spawn).setY(this.level.spawn.y + 1), Math.PI);
    this.character.settle(this.player);
    this.rig.snap(this.player);
    this.rig.setMode('follow');
    this.setPhase('play');
    this.sfx.respawn();
    this.emitHud();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.input.detach();
    this.sfx.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ───────────────────────────────────────────── hooks for player / platforms

  shake(a: number) {
    this.rig.addShake(a);
  }

  /** Highest walkable surface under a point, or null over open sky. */
  groundBelow(x: number, y: number, z: number): number | null {
    let best: number | null = null;
    for (const s of this.level.solids) {
      if (!s.enabled) continue;
      const lx = x - s.pos.x;
      const lz = z - s.pos.z;
      if (!s.contains(lx, lz, 0.1)) continue;
      const top = s.topAt(lx, lz);
      if (top <= y + 0.35 && (best === null || top > best)) best = top;
    }
    return best;
  }

  onPlayerJump() {
    this.sfx.jump();
    this.character.kick(7);
    this.puff(this.player.pos, 7, 1.7, 0.4);
    this.haptic(10);
    // Every jump flips the echo tiles.
    this.echoA = !this.echoA;
    this.applyEcho(false);
    if (this.player.pos.distanceToSquared(this.level.echoCenter) < 30 * 30) this.sfx.echo(this.echoA);
  }

  onPlayerDash() {
    this.sfx.dash();
    this.character.startSpin();
    this.character.kick(3);
    tmp.copy(this.player.pos).setY(this.player.pos.y + 0.5);
    this.spark.burst(tmp, 16, cTeal, 4.5, { life: 0.45, size: 0.2, gravity: 2 }, 2.4);
    this.shake(0.16);
    this.haptic([12, 30, 12]);
  }

  onPlayerLand(impact: number) {
    const k = clamp(impact / 30, 0, 1);
    this.sfx.land(k);
    this.character.kick(-impact * 0.42);
    this.puff(this.player.pos, 4 + Math.round(k * 12), 1.4 + k * 3, 0.38 + k * 0.3);
    if (impact > 17) {
      this.shake((impact - 17) / 26);
      this.hitStop(0.03);
    }
    this.haptic(impact > 17 ? 28 : 8);
  }

  onPlayerBounce(out: number) {
    this.character.kick(out * 0.42);
    this.haptic(22);
  }

  // ─────────────────────────────────────────────────────────── internals

  private emit(e: GameEvent) {
    if (!this.disposed) this.onEvent(e);
  }
  private haptic(pattern: number | number[]) {
    this.emit({ type: 'haptic', pattern });
  }
  private hitStop(seconds: number) {
    this.hitStopT = Math.max(this.hitStopT, seconds);
  }
  private setPhase(p: Phase) {
    this.phase = p;
    this.emit({ type: 'phase', phase: p });
  }
  private emitHud() {
    this.emit({
      type: 'hud',
      motes: this.motes.collected,
      total: this.motes.total,
      blooms: this.blooms.filter((b) => b.taken).length,
      bloomTotal: this.blooms.length,
      falls: this.falls,
    });
  }

  private applyEcho(instant: boolean) {
    for (const tile of this.level.echo) tile.setSolid((tile.set === 'A') === this.echoA, instant);
  }

  /** Ring of soft dust at ground level. */
  private puff(p: THREE.Vector3, n: number, speed: number, size: number) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const s = speed * (0.5 + Math.random() * 0.7);
      this.dust.emit({
        x: p.x + Math.cos(a) * 0.2,
        y: p.y + 0.08,
        z: p.z + Math.sin(a) * 0.2,
        vx: Math.cos(a) * s,
        vy: 0.5 + Math.random() * 0.9,
        vz: Math.sin(a) * s,
        life: 0.32 + Math.random() * 0.3,
        size: size * (0.7 + Math.random() * 0.6),
        r: cDust.r,
        g: cDust.g,
        b: cDust.b,
        alpha: 0.62,
        drag: 3.2,
      });
    }
  }

  private respawn() {
    this.falls++;
    this.sfx.fall();
    const cp = this.cpIndex >= 0 ? this.level.checkpoints[this.cpIndex].spawn : this.level.spawn;
    this.player.teleport(tmp.copy(cp).setY(cp.y + 1.4), Math.PI);
    this.echoA = true;
    this.applyEcho(true);
    this.level.solids.forEach((s) => s.reset());
    this.character.settle(this.player);
    this.rig.snap(this.player);
    this.spark.burst(tmp.copy(cp).setY(cp.y + 0.6), 18, cWhite, 3.5, { life: 0.6, size: 0.2, gravity: -1 }, 1.8);
    this.emit({ type: 'respawn' });
    this.emitHud();
    this.haptic([40, 60, 40]);
  }

  private rules(dt: number) {
    const p = this.player;
    this.comboT -= dt;
    if (this.phase !== 'play') return;

    // Fell into the clouds?
    if (p.pos.y < p.lastGroundY - 16 || p.pos.y < -18) {
      this.respawn();
      return;
    }

    // Checkpoints light when Pip sets foot on their isle.
    this.level.checkpoints.forEach((c, i) => {
      if (c.lit || !p.grounded || Math.abs(p.pos.y - c.center.y) > 0.6) return;
      if ((p.pos.x - c.center.x) ** 2 + (p.pos.z - c.center.z) ** 2 > c.radius * c.radius) return;
      c.lit = true;
      this.cpIndex = Math.max(this.cpIndex, i);
      this.sfx.checkpoint();
      this.spark.burst(c.headWorld, 22, cSun, 3.5, { life: 0.8, size: 0.2, gravity: 2 }, 2.4);
      this.haptic([15, 40, 15]);
    });

    // Contextual hints, once each.
    this.level.hints.forEach((h, i) => {
      if (this.hintsShown.has(i) || p.pos.distanceToSquared(h.pos) > h.r * h.r) return;
      this.hintsShown.add(i);
      this.emit({ type: 'hint', text: h.text });
    });

    // Skyblooms.
    tmp.copy(p.pos).setY(p.pos.y + 0.55);
    for (const b of this.blooms) {
      if (b.taken || b.group.position.distanceToSquared(tmp) > 1.25 * 1.25) continue;
      b.collect();
      this.sfx.bloom();
      this.spark.burst(b.group.position, 46, cPink, 6.5, { life: 1.0, size: 0.26, gravity: 3 }, 2.2);
      this.spark.burst(b.group.position, 20, cWhite, 3, { life: 0.7, size: 0.2, gravity: 0 }, 2.5);
      this.character.cheer();
      this.hitStop(0.1);
      this.shake(0.25);
      this.haptic([20, 40, 20, 40, 60]);
      this.emitHud();
    }

    // The Beacon.
    const bp = this.level.beaconPos;
    if ((p.pos.x - bp.x) ** 2 + (p.pos.z - bp.z) ** 2 < 2.2 * 2.2 && Math.abs(p.pos.y - bp.y) < 3) {
      this.timerOn = false;
      this.setPhase('done');
      this.rig.setMode('finish');
      this.beacon.ignite();
      this.sfx.finish();
      this.shake(0.4);
      this.haptic([30, 50, 30, 50, 120]);
      this.celebrateT = 0;
      this.emit({
        type: 'finish',
        stats: {
          timeMs: Math.round(this.runTime * 1000),
          motes: this.motes.collected,
          total: this.motes.total,
          blooms: this.blooms.filter((b) => b.taken).length,
          bloomTotal: this.blooms.length,
          falls: this.falls,
          mode: this.input.source === 'phone' ? (this.input.mode ?? 'flick') : 'keys',
        },
      });
    }
  }

  private onMote = (pos: THREE.Vector3) => {
    this.combo = this.comboT > 0 ? this.combo + 1 : 0;
    this.comboT = 1.8;
    this.sfx.mote(this.combo);
    this.spark.burst(pos, 9, cSun, 3.2, { life: 0.5, size: 0.17, gravity: 4 }, 2.6);
    this.haptic(8);
    this.emitHud();
  };

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.rig.resize(w / h);
    const fov = (this.rig.camera.fov * Math.PI) / 180;
    this.particleScale.value = (h * this.pixelRatio) / (2 * Math.tan(fov / 2));
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const rawMs = now - this.last;
    const realDt = Math.min(0.05, Math.max(0, rawMs / 1000));
    this.last = now;
    this.clock += realDt;
    const t = this.clock;

    // Drop resolution once if this machine is clearly struggling.
    this.frameMs = damp(this.frameMs, rawMs, 2, realDt);
    if (this.frameMs > 27 && this.pixelRatio > 1) {
      if (++this.slowFrames > 120) {
        this.pixelRatio = 1;
        this.slowFrames = 0;
        this.resize();
      }
    } else this.slowFrames = 0;

    this.hitStopT = Math.max(0, this.hitStopT - realDt);
    const dt = this.hitStopT > 0 ? realDt * 0.06 : realDt;

    // ── Input → world-space intent (camera heading is fixed: forward = -z).
    const inp = this.input;
    inp.update(realDt);
    const playing = this.phase === 'play';
    const mx = playing ? inp.moveX : 0;
    const mz = playing ? -inp.moveY : 0;
    if (inp.consumeJump() && playing) this.pendingJump = true;
    if (playing && !this.timerOn && (Math.abs(mx) + Math.abs(mz) > 0.15 || this.pendingJump)) this.timerOn = true;
    if (this.timerOn) this.runTime += realDt;
    if (this.phase === 'done') {
      // Victory hops, facing the camera.
      this.celebrateT += dt;
      if (this.celebrateT > 0.85 && this.player.grounded) {
        this.celebrateT = 0;
        this.pendingJump = true;
        this.character.cheer();
      }
      this.player.facing = damp(this.player.facing, 0, 4, dt);
      if (Math.random() < 0.5) {
        tmp.copy(this.level.beaconPos).setY(this.level.beaconPos.y + 2.4);
        this.spark.burst(tmp, 1, Math.random() < 0.5 ? cSun : cPink, 7, { life: 1.3, size: 0.24, gravity: 5, vy: 5 }, 2.4);
      }
    }

    // ── Fixed-step simulation.
    this.acc += dt;
    let steps = 0;
    while (this.acc >= T.STEP && steps < 8) {
      this.simT += T.STEP;
      for (const s of this.level.solids) s.step(T.STEP, this.simT, this);
      this.player.step(
        T.STEP,
        { mx, mz, jumpPressed: this.pendingJump, jumpHeld: inp.jumpHeld || this.phase === 'done' },
        this.level.solids,
        this,
      );
      this.pendingJump = false;
      this.acc -= T.STEP;
      steps++;
    }
    if (steps === 8) this.acc = 0;
    this.rules(dt);

    // ── Wind: a lazy breeze that leans with the phone.
    const p = this.player;
    this.wind.x = damp(this.wind.x, 0.28 + Math.sin(t * 0.31) * 0.14 + clamp(inp.roll / 24, -1, 1) * 0.95, 3, realDt);
    this.wind.y = damp(this.wind.y, Math.cos(t * 0.23) * 0.1 - clamp(inp.pitch / 24, -1, 1) * 0.95, 3, realDt);
    const windMag = this.wind.length();

    // ── Visual updates.
    for (const s of this.level.solids) s.frame(dt, t, this);
    this.motes.update(dt, t, p.pos, playing, this.onMote);
    for (const b of this.blooms) {
      b.update(dt, t);
      if (!b.taken && Math.random() < 0.1) {
        this.spark.emit({
          x: b.pos.x + (Math.random() - 0.5) * 0.8,
          y: b.pos.y - 0.2,
          z: b.pos.z + (Math.random() - 0.5) * 0.8,
          vy: 0.9,
          life: 1.1,
          size: 0.12,
          r: 2.2,
          g: 1.2,
          b: 1.7,
          alpha: 0.9,
        });
      }
    }
    for (const c of this.level.checkpoints) c.update(dt, t);
    this.beacon.update(dt, t);
    for (const tr of this.level.trees) {
      for (const blob of tr.blobs) {
        const ph = blob.userData.phase as number;
        blob.scale.setScalar(1 + Math.sin(t * 1.3 + ph) * 0.035 * (1 + windMag));
        blob.rotation.z = Math.sin(t * 0.9 + ph) * 0.06 * (1 + windMag * 2);
      }
    }
    for (const pw of this.level.pinwheels) pw.rotor.rotation.z -= (1.5 + windMag * 11) * dt;
    if (p.dashT > 0) {
      this.spark.emit({ x: p.pos.x, y: p.pos.y + 0.5, z: p.pos.z, life: 0.3, size: 0.3, r: 0.3, g: 2.0, b: 1.8, alpha: 0.8 });
    }

    this.character.update(dt, t, p, this.wind);
    const gy = this.groundBelow(p.pos.x, p.pos.y, p.pos.z);
    this.blob.visible = gy !== null;
    if (gy !== null) {
      const k = clamp(1 - (p.pos.y - gy) * 0.07, 0.4, 1);
      this.blob.position.set(p.pos.x, gy + 0.03, p.pos.z);
      this.blob.scale.setScalar(k);
      (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.34 * k;
    }
    this.dust.update(dt);
    this.spark.update(dt);
    this.rig.update(realDt, t, p);
    this.env.update(dt, t, this.rig.camera, p.pos, this.wind);
    this.sfx.update(realDt);

    this.composer.render();
  };
}
