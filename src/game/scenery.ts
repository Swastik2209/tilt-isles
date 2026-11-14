import * as THREE from 'three';
import { C, mat } from './materials';
import { clamp, mulberry32 } from './math';

/**
 * Builders for the hand-made look of the world: floating isles with rocky
 * roots and dripping turf, lollipop trees, lanterns, pinwheels.
 * Everything is built with its top surface at y = 0.
 */

const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });
const cTop = new THREE.Color(C.rockTop);
const cBottom = new THREE.Color(C.rockBottom);
const tmpColor = new THREE.Color();

/** Jitter a tapered cylinder into a craggy root and paint a top→bottom gradient. */
function craggify(g: THREE.BufferGeometry, depth: number, amp: number, seed: number) {
  const rnd = mulberry32(seed);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const t = clamp(y / depth + 0.5, 0, 1); // 1 at the top ring, 0 at the tip
    // Seam / cap vertices are duplicated — key on position so they stay welded.
    const key = `${Math.round(x * 40)}|${Math.round(y * 40)}|${Math.round(z * 40)}`;
    let j = cache.get(key);
    if (!j) {
      const a = amp * (1 - t);
      j = [(rnd() - 0.5) * a, (rnd() - 0.5) * a * 0.5, (rnd() - 0.5) * a];
      cache.set(key, j);
    }
    p.setXYZ(i, x + j[0], y + j[1], z + j[2]);
    tmpColor.copy(cBottom).lerp(cTop, Math.pow(t, 0.8));
    col[i * 3] = tmpColor.r;
    col[i * 3 + 1] = tmpColor.g;
    col[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
}

export interface IsleShape {
  /** Round isle radius… */
  r?: number;
  /** …or a rectangular isle (width along x, depth along z). */
  w?: number;
  d?: number;
}

export function buildIsle(shape: IsleShape, seed: number, lowDetail = false): THREE.Group {
  const g = new THREE.Group();
  const rnd = mulberry32(seed * 7 + 3);
  const turfMat = mat(C.turf, { rough: 0.95 });
  const dripMat = mat(C.turfDark, { rough: 0.95, flat: true });
  const patchMat = mat(C.turfLight, { rough: 0.95 });
  const round = shape.r !== undefined;
  const r = shape.r ?? 1;
  const hx = (shape.w ?? 2) / 2;
  const hz = (shape.d ?? 2) / 2;
  const span = round ? r : Math.min(hx, hz);
  const depth = span * 1.25 + 0.7;

  // Turf slab.
  const turfGeo = round
    ? new THREE.CylinderGeometry(r, r * 0.985, 0.5, lowDetail ? 14 : 40)
    : new THREE.BoxGeometry(hx * 2, 0.5, hz * 2);
  const turf = new THREE.Mesh(turfGeo, turfMat);
  turf.position.y = -0.25;
  turf.receiveShadow = true;
  turf.castShadow = true;
  g.add(turf);

  // Rocky root.
  let rockGeo: THREE.BufferGeometry;
  if (round) {
    rockGeo = new THREE.CylinderGeometry(r * 0.93, r * 0.14, depth, lowDetail ? 7 : 10, 3);
  } else {
    rockGeo = new THREE.CylinderGeometry(1, 0.26, depth, 4, 3);
    rockGeo.rotateY(Math.PI / 4);
    rockGeo.scale(hx * Math.SQRT2 * 0.95, 1, hz * Math.SQRT2 * 0.95);
  }
  craggify(rockGeo, depth, span * 0.42, seed);
  const rock = new THREE.Mesh(rockGeo, rockMat);
  rock.position.y = -0.48 - depth / 2;
  rock.castShadow = true;
  g.add(rock);

  // Grass "drips" hanging over the rim.
  const perimeter = round ? Math.PI * 2 * r : 4 * (hx + hz);
  const n = Math.max(8, Math.round(perimeter * (lowDetail ? 0.8 : 1.6)));
  const drips = new THREE.InstancedMesh(new THREE.ConeGeometry(0.24, 0.6, 5), dripMat, n);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const u = (i + rnd() * 0.6) / n;
    if (round) {
      const a = u * Math.PI * 2;
      v.set(Math.cos(a) * r * 0.955, 0, Math.sin(a) * r * 0.955);
    } else {
      // Walk the rectangle's perimeter.
      let dist = u * perimeter;
      const sides = [hx * 2, hz * 2, hx * 2, hz * 2];
      let side = 0;
      while (dist > sides[side]) {
        dist -= sides[side];
        side++;
      }
      const e = 0.955;
      if (side === 0) v.set(-hx + dist, 0, hz * e);
      else if (side === 1) v.set(hx * e, 0, hz - dist);
      else if (side === 2) v.set(hx - dist, 0, -hz * e);
      else v.set(-hx * e, 0, -hz + dist);
    }
    const sc = 0.7 + rnd() * 0.9;
    s.set(sc, 0.6 + rnd() * 1.1, sc);
    v.y = -0.46 - 0.3 * s.y;
    m4.compose(v, q, s);
    drips.setMatrixAt(i, m4);
  }
  drips.castShadow = true;
  g.add(drips);

  if (!lowDetail) {
    // Lighter lawn patches for a painted feel.
    const patches = round ? Math.max(2, Math.round(r)) : 4;
    for (let i = 0; i < patches; i++) {
      const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 18), patchMat);
      patch.rotation.x = -Math.PI / 2;
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * 0.55;
      patch.position.set(Math.cos(a) * rr * (round ? r : hx), 0.012 + i * 0.002, Math.sin(a) * rr * (round ? r : hz));
      const ps = span * (0.18 + rnd() * 0.2);
      patch.scale.set(ps * (0.8 + rnd() * 0.6), ps, 1);
      patch.rotation.z = rnd() * Math.PI;
      patch.receiveShadow = true;
      g.add(patch);
    }
    // A few loose shards drifting under the isle.
    const shards = round && r < 2 ? 1 : 3;
    for (let i = 0; i < shards; i++) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.22 + rnd() * 0.3, 0), rockMat2());
      const a = rnd() * Math.PI * 2;
      shard.position.set(Math.cos(a) * span * 0.75, -depth * (0.55 + rnd() * 0.5), Math.sin(a) * span * 0.75);
      shard.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      shard.scale.y = 1.4;
      shard.userData.bob = rnd() * 6;
      shard.name = 'shard';
      g.add(shard);
    }
  }
  return g;
}

const rockMat2 = () => mat(0xb98a7d, { flat: true, rough: 0.9 });

export interface Tree {
  group: THREE.Group;
  blobs: THREE.Mesh[];
}

export function buildTree(kind: 'blossom' | 'leaf', scale: number, seed: number): Tree {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 1.9, 7), mat(0x9c6b5a, { flat: true }));
  trunk.position.y = 0.95;
  trunk.rotation.z = (rnd() - 0.5) * 0.12;
  trunk.castShadow = true;
  group.add(trunk);

  const palette = kind === 'blossom' ? [0xff9db8, 0xffb9cc, 0xff86a8] : [0x3fb58a, 0x56c99a, 0x2f9e7c];
  const spots: [number, number, number, number][] = [
    [0, 2.45, 0, 1.0],
    [0.62, 2.0, 0.2, 0.66],
    [-0.58, 2.1, -0.15, 0.62],
    [0.08, 3.1, 0.05, 0.56],
    [-0.1, 2.2, 0.55, 0.5],
  ];
  const blobs: THREE.Mesh[] = [];
  spots.forEach(([x, y, z, r], i) => {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat(palette[i % 3], { flat: true, rough: 0.9 }));
    blob.position.set(x, y, z);
    blob.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    blob.castShadow = true;
    blob.userData.phase = rnd() * 6;
    blobs.push(blob);
    group.add(blob);
  });
  group.scale.setScalar(scale);
  return { group, blobs };
}

export interface Lantern {
  group: THREE.Group;
  glow: THREE.MeshStandardMaterial;
  head: THREE.Vector3;
}

/** Checkpoint lantern — unlit until Pip reaches its isle. */
export function buildLantern(): Lantern {
  const group = new THREE.Group();
  const wood = mat(0x6d4a4f, { flat: true });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.7, 6), wood);
  post.position.y = 0.85;
  post.castShadow = true;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.07), wood);
  arm.position.set(0.2, 1.66, 0);
  const glow = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, emissive: 0xffb84a, emissiveIntensity: 0, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), glow);
  body.position.set(0.4, 1.38, 0);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.16, 4), wood);
  cap.position.set(0.4, 1.63, 0);
  cap.rotation.y = Math.PI / 4;
  group.add(post, arm, body, cap);
  return { group, glow, head: new THREE.Vector3(0.4, 1.38, 0) };
}

export interface Pinwheel {
  group: THREE.Group;
  rotor: THREE.Group;
}

/** Spins with the wind — and the wind follows the phone. */
export function buildPinwheel(): Pinwheel {
  const group = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.1, 5), mat(0xf7e6cc));
  stick.position.y = 0.55;
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.08, 0.05);
  const colors = [C.coral, C.sun, C.teal, C.cream];
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 3), mat(colors[i], { flat: true }));
    blade.scale.z = 0.25;
    const a = (i / 4) * Math.PI * 2;
    blade.position.set(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0);
    blade.rotation.z = a - Math.PI / 2 + 0.5;
    rotor.add(blade);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(C.ink));
  rotor.add(hub);
  group.add(stick, rotor);
  return { group, rotor };
}

/** A little arrow sign pointing the way. */
export function buildSign(): THREE.Group {
  const group = new THREE.Group();
  const wood = mat(C.woodDark, { flat: true });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6), wood);
  post.position.y = 0.55;
  post.castShadow = true;
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.06), mat(C.wood, { flat: true }));
  board.position.set(0, 1.0, 0);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.28, 3), mat(C.wood, { flat: true }));
  tip.scale.z = 0.25;
  tip.rotation.z = -Math.PI / 2;
  tip.position.set(0.48, 1.0, 0);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.065), mat(C.coral));
  stripe.position.set(-0.02, 1.0, 0.004);
  group.add(post, board, tip, stripe);
  return group;
}
