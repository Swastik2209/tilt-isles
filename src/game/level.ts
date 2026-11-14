import * as THREE from 'three';
import { Checkpoint } from './collectibles';
import { BalanceBoard, Bouncecap, EchoTile } from './contraptions';
import { swayMaterial, type SwayUniforms } from './materials';
import { mulberry32 } from './math';
import { Crumble, Island, Mover } from './platforms';
import { buildPinwheel, buildSign, buildTree, type Pinwheel, type Tree } from './scenery';
import { Prop, type Solid } from './solid';

/**
 * THE HANGING ISLES — the one hand-built level.
 *
 * The route climbs away from the camera (toward -z), so nothing ever blocks
 * the view of Pip. Each stretch introduces one idea:
 *
 *   Home Isle ─ stepping stones ─ Drift Crossing (movers) ─ Slate Stair
 *   (crumbling) ─ Bouncecap Grove (momentum) ─ Balance Boards (weight) ─
 *   Echo Tiles (phase-swap on jump) ─ lift, slate and one last bounce ─ Summit.
 */

export interface Hint {
  pos: THREE.Vector3;
  r: number;
  text: string;
}

export interface Level {
  solids: Solid[];
  echo: EchoTile[];
  echoCenter: THREE.Vector3;
  motePoints: THREE.Vector3[];
  bloomPoints: THREE.Vector3[];
  checkpoints: Checkpoint[];
  hints: Hint[];
  beaconPos: THREE.Vector3;
  spawn: THREE.Vector3;
  trees: Tree[];
  pinwheels: Pinwheel[];
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Avoid {
  x: number;
  z: number;
  r: number;
}

export function buildLevel(scene: THREE.Scene, sway: SwayUniforms): Level {
  const solids: Solid[] = [];
  const motes: THREE.Vector3[] = [];
  const trees: Tree[] = [];
  const pinwheels: Pinwheel[] = [];
  const avoid: Avoid[] = [];
  const isles: Island[] = [];
  let seed = 11;

  const add = <S extends Solid>(s: S): S => {
    solids.push(s);
    scene.add(s.group);
    return s;
  };
  const isle = (x: number, y: number, z: number, r: number) => {
    const i = add(new Island(x, y, z, { r }, seed++));
    isles.push(i);
    return i;
  };
  const tree = (x: number, y: number, z: number, kind: 'blossom' | 'leaf', scale: number) => {
    const t = buildTree(kind, scale, seed++);
    t.group.position.set(x, y, z);
    scene.add(t.group);
    trees.push(t);
    solids.push(new Prop(x, y + 3.4, z, 0.26 * scale, 3.4)); // trunk collider
    avoid.push({ x, z, r: 0.7 });
  };
  const cap = (x: number, baseY: number, z: number, r: number, stemH: number) => {
    const c = add(new Bouncecap(x, baseY, z, r, stemH));
    solids.push(new Prop(x, baseY + stemH, z, r * 0.36, stemH)); // stem collider
    avoid.push({ x, z, r: r + 0.2 });
    return c;
  };
  const pinwheel = (x: number, y: number, z: number) => {
    const p = buildPinwheel();
    p.group.position.set(x, y, z);
    scene.add(p.group);
    pinwheels.push(p);
    avoid.push({ x, z, r: 0.4 });
  };

  // Sunmote placement helpers.
  const line = (a: THREE.Vector3, b: THREE.Vector3, n: number) => {
    for (let i = 0; i < n; i++) motes.push(a.clone().lerp(b, n === 1 ? 0.5 : i / (n - 1)));
  };
  /** Motes along a jump arc between two ledges — they show the way. */
  const arc = (a: THREE.Vector3, b: THREE.Vector3, n: number, h = 1.7) => {
    for (let i = 0; i < n; i++) {
      const u = (i + 1) / (n + 1);
      const p = a.clone().lerp(b, u);
      p.y += 0.9 + Math.sin(u * Math.PI) * h;
      motes.push(p);
    }
  };
  const ring = (c: THREE.Vector3, r: number, n: number, offset = 0) => {
    for (let i = 0; i < n; i++) {
      const a = offset + (i / n) * Math.PI * 2;
      motes.push(V(c.x + Math.cos(a) * r, c.y + 0.9, c.z + Math.sin(a) * r));
    }
  };

  // ───────────────────────────────────────────── 1. Home Isle & stepping stones
  const spawn = V(0, 0, 2.2);
  isle(0, 0, 0, 5.2);
  tree(-3.6, 0, 0.4, 'blossom', 1.1);
  tree(3.9, 0, -1.4, 'leaf', 0.85);
  pinwheel(2.3, 0, 2.7);
  const sign = buildSign();
  sign.position.set(1.7, 0, -3.3);
  sign.rotation.y = Math.PI / 2;
  scene.add(sign);
  avoid.push({ x: 1.7, z: -3.3, r: 0.5 });
  line(V(0, 0.9, -0.6), V(0.3, 0.9, -3.8), 3);

  isle(0.5, 0.7, -8.4, 1.7);
  isle(2.6, 1.5, -13.2, 1.7);
  arc(V(0.3, 0, -5), V(0.5, 0.7, -7.4), 3, 1.0);
  arc(V(0.8, 0.7, -9.6), V(2.3, 1.5, -12), 3, 1.3);

  isle(3.2, 2.2, -19.6, 2.8);
  pinwheel(5.0, 2.2, -20.3);
  arc(V(2.8, 1.5, -14.6), V(3.1, 2.2, -17.2), 3, 1.3);
  ring(V(3.2, 2.2, -19.6), 1.6, 4, 0.4);

  // ───────────────────────────────────────────── 2. Drift Crossing
  add(new Mover(V(3.2, 2.5, -25.6), V(-3.4, 2.5, -25.6), 3.2, 6, 0));
  add(new Mover(V(-3.6, 3.0, -30.6), V(-3.6, 3.0, -37.2), 3.2, 6, 0.5));
  line(V(2.4, 3.4, -25.6), V(-2.8, 3.4, -25.6), 4);
  line(V(-3.6, 3.9, -31.2), V(-3.6, 3.9, -36.6), 4);

  const isleC = isle(-3.0, 3.4, -44.0, 4.2);
  tree(-0.4, 3.4, -46.6, 'blossom', 1.0);
  ring(isleC.pos, 2.4, 5, 0.2);

  // ───────────────────────────────────────────── 3. Slate Stair
  const slate: [number, number, number][] = [
    [-8.6, 4.2, -47.4],
    [-12.2, 5.1, -51.0],
    [-11.6, 6.0, -56.0],
    [-7.6, 6.9, -59.4],
  ];
  for (const [x, y, z] of slate) {
    add(new Crumble(x, y, z, 2.4));
    motes.push(V(x, y + 1.0, z));
  }
  // Secret: a lonely rock off the stair with a bouncecap and a Skybloom.
  isle(-17.2, 3.6, -53.5, 1.8);
  const capSecret = cap(-17.2, 3.6, -53.5, 1.2, 0.7);

  // ───────────────────────────────────────────── 4. Bouncecap Grove
  const isleD = add(new Island(-1.0, 7.6, -62.5, { w: 9, d: 7 }, seed++));
  isles.push(isleD);
  tree(-4.4, 7.6, -64.9, 'leaf', 1.0);
  const capGrove = cap(0.5, 7.6, -63.5, 1.3, 0.8);
  line(V(-4.2, 8.5, -61.2), V(-1.6, 8.5, -62.6), 3);
  line(V(0.5, capGrove.pos.y + 1.6, -63.5), V(0.5, capGrove.pos.y + 7.0, -63.5), 5);

  const isleE = isle(-0.5, 14.6, -72.5, 3.6);
  tree(-2.9, 14.6, -73.6, 'blossom', 0.8);
  pinwheel(1.7, 14.6, -74.3);
  ring(isleE.pos, 2.0, 4, 0.8);

  // ───────────────────────────────────────────── 5. Balance Boards
  add(new BalanceBoard(-0.5, 14.9, -81.0, 2.8, 7));
  add(new BalanceBoard(4.6, 15.4, -88.3, 7, 2.8));
  line(V(-0.5, 15.8, -78.6), V(-0.5, 15.8, -83.4), 4);
  line(V(2.2, 16.3, -88.3), V(7.0, 16.3, -88.3), 4);

  const isleF = isle(12.4, 15.9, -90.0, 2.6);
  motes.push(V(12.4, 16.8, -91.2));

  // ───────────────────────────────────────────── 6. Echo Tiles
  // A checkerboard of two phases with one square missing, so the path snakes.
  const echo: EchoTile[] = [];
  const cols = [10.0, 14.8];
  const rows = [-96.2, -100.8, -105.4, -110.0];
  rows.forEach((z, r) => {
    cols.forEach((x, c) => {
      if (r === 2 && c === 1) return; // the gap
      const y = 16.3 + r * 0.5;
      echo.push(add(new EchoTile(x, y, z, 2.8, (r + c) % 2 === 0 ? 'A' : 'B')));
      motes.push(V(x, y + 1.0, z));
    });
  });
  // Far-flung tile holding the second Skybloom — needs a jump AND a spin dash.
  // (A plain running jump covers ~5 m; this gap is nearly 8.)
  echo.push(add(new EchoTile(25.6, 17.4, -100.8, 3.4, 'B')));

  const isleG = isle(12.4, 18.3, -116.4, 3.0);
  tree(10.5, 18.3, -117.9, 'leaf', 0.8);

  // ───────────────────────────────────────────── 7. The last climb
  add(new Mover(V(6.4, 18.6, -120.2), V(6.4, 24.2, -120.2), 3.2, 7, 0));
  line(V(6.4, 20.4, -120.2), V(6.4, 24.4, -120.2), 3);
  add(new Crumble(1.6, 24.8, -122.6, 2.4));
  add(new Crumble(-2.8, 25.5, -125.6, 2.4));
  motes.push(V(1.6, 25.8, -122.6), V(-2.8, 26.5, -125.6));

  const isleH = isle(-7.4, 26.2, -129.0, 2.8);
  const capSummit = cap(-7.8, 26.2, -129.6, 1.3, 0.8);
  line(V(-7.2, capSummit.pos.y + 2.4, -131.0), V(-6.0, capSummit.pos.y + 5.2, -133.0), 2);

  const summit = isle(-3.0, 33.4, -139.5, 5.5);
  const beaconPos = V(-3.0, 33.4, -141.0);
  solids.push(new Prop(beaconPos.x, beaconPos.y + 0.5, beaconPos.z, 1.2, 0.5));
  avoid.push({ x: beaconPos.x, z: beaconPos.z, r: 1.6 });
  tree(-6.9, 33.4, -141.8, 'blossom', 1.15);
  tree(0.9, 33.4, -142.4, 'leaf', 0.95);
  pinwheel(-0.3, 33.4, -136.6);
  ring(V(-3.0, 33.4, -138.6), 2.3, 4, Math.PI * 0.75);

  // ───────────────────────────────────────────── Checkpoints, blooms, hints
  const checkpoints = [
    new Checkpoint(isleC.pos, 4.2, V(-3.0, 3.4, -43.2), V(-0.2, 3.4, -41.6)),
    new Checkpoint(isleE.pos, 3.6, V(-0.5, 14.6, -71.6), V(1.9, 14.6, -71.0)),
    new Checkpoint(isleF.pos, 2.6, V(12.4, 15.9, -89.6), V(14.1, 15.9, -89.2)),
    new Checkpoint(isleG.pos, 3.0, V(12.4, 18.3, -115.6), V(14.5, 18.3, -115.5)),
  ];
  for (const c of checkpoints) {
    scene.add(c.lantern.group);
    avoid.push({ x: c.lantern.group.position.x, z: c.lantern.group.position.z, r: 0.5 });
  }

  const bloomPoints = [
    V(capSecret.pos.x, capSecret.pos.y + 2.3, capSecret.pos.z),
    V(capGrove.pos.x, capGrove.pos.y + 8.4, capGrove.pos.z),
    V(25.6, 18.6, -100.8),
  ];

  const hints: Hint[] = [
    { pos: V(3.2, 2.2, -19.6), r: 2.6, text: 'Press jump again in mid-air to spin-dash' },
    { pos: isleC.pos, r: 4, text: 'Slate crumbles underfoot — keep moving' },
    { pos: isleD.pos, r: 4.5, text: 'Bouncecaps return what you bring. Keep bouncing to climb.' },
    { pos: isleE.pos, r: 3.4, text: 'Balance boards lean under your weight' },
    { pos: isleF.pos, r: 2.5, text: 'Echo tiles swap every time you jump' },
    { pos: isleH.pos, r: 2.6, text: 'One last climb — ride the bounce to the Beacon' },
  ];

  scene.add(buildFoliage(isles, avoid, sway));
  void summit;

  return {
    solids,
    echo,
    echoCenter: V(12.4, 17, -103),
    motePoints: motes,
    bloomPoints,
    checkpoints,
    hints,
    beaconPos,
    spawn,
    trees,
    pinwheels,
  };
}

/** Scatter instanced grass tufts and flowers over every isle (two draw calls + stems). */
function buildFoliage(isles: Island[], avoid: Avoid[], sway: SwayUniforms): THREE.Group {
  const rnd = mulberry32(5150);
  const blades: THREE.Matrix4[] = [];
  const bladeColors: THREE.Color[] = [];
  const flowers: THREE.Matrix4[] = [];
  const flowerColors: THREE.Color[] = [];
  const greens = [0x5cc24f, 0x6fd45a, 0x4bb04a, 0x86df62];
  const petals = [0xffffff, 0xffd4e4, 0xffe27a, 0xff9db8, 0xc9b8ff];
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();

  for (const isle of isles) {
    const round = isle.shape === 'cyl';
    const area = round ? Math.PI * isle.radius * isle.radius : isle.hx * isle.hz * 4;
    const count = Math.round(area * 1.5);
    for (let i = 0; i < count; i++) {
      let lx: number;
      let lz: number;
      if (round) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * isle.radius * 0.93;
        lx = Math.cos(a) * r;
        lz = Math.sin(a) * r;
      } else {
        lx = (rnd() * 2 - 1) * isle.hx * 0.94;
        lz = (rnd() * 2 - 1) * isle.hz * 0.94;
      }
      const x = isle.pos.x + lx;
      const z = isle.pos.z + lz;
      if (avoid.some((a) => (a.x - x) ** 2 + (a.z - z) ** 2 < a.r * a.r)) continue;

      if (rnd() < 0.16) {
        p.set(x, isle.pos.y, z);
        q.identity();
        s.set(1, 0.32 + rnd() * 0.28, 1);
        flowers.push(new THREE.Matrix4().compose(p, q, s));
        flowerColors.push(new THREE.Color(petals[Math.floor(rnd() * petals.length)]));
      } else {
        // A tuft is three blades fanned out from one root.
        const tint = new THREE.Color(greens[Math.floor(rnd() * greens.length)]);
        for (let b = 0; b < 3; b++) {
          p.set(x + (rnd() - 0.5) * 0.14, isle.pos.y, z + (rnd() - 0.5) * 0.14);
          e.set((rnd() - 0.5) * 0.7, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.7);
          q.setFromEuler(e);
          s.set(1 + rnd() * 0.8, 0.22 + rnd() * 0.3, 1 + rnd() * 0.8);
          blades.push(new THREE.Matrix4().compose(p, q, s));
          bladeColors.push(tint);
        }
      }
    }
  }

  const group = new THREE.Group();
  const instanced = (geo: THREE.BufferGeometry, m: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[]) => {
    const mesh = new THREE.InstancedMesh(geo, m, mats.length);
    mats.forEach((mm, i) => {
      mesh.setMatrixAt(i, mm);
      if (colors) mesh.setColorAt(i, colors[i]);
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  };

  const bladeGeo = new THREE.ConeGeometry(0.055, 1, 4, 1);
  bladeGeo.translate(0, 0.5, 0);
  instanced(bladeGeo, swayMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }, sway), blades, bladeColors);

  const stemGeo = new THREE.CylinderGeometry(0.014, 0.02, 1, 4);
  stemGeo.translate(0, 0.5, 0);
  instanced(stemGeo, swayMaterial({ color: 0x4bb04a, roughness: 0.9 }, sway), flowers);

  const headGeo = new THREE.IcosahedronGeometry(0.1, 0);
  headGeo.scale(1, 1.4, 1);
  headGeo.translate(0, 1, 0);
  instanced(headGeo, swayMaterial({ color: 0xffffff, roughness: 0.7, flatShading: true }, sway), flowers, flowerColors);

  return group;
}
