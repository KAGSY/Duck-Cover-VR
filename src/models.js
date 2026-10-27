// Procedural low-poly models built from primitives with baked vertex colour.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

const V = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3();
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, 'YXZ')), S.set(sx, sy, sz));
}
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const cone = (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg);
export const sph = (r, ws = 10, hs = 7) => new THREE.SphereGeometry(r, ws, hs);
export const ico = (r, detail = 0) => new THREE.IcosahedronGeometry(r, detail);
const col = (s) => (s instanceof THREE.Color ? s : new THREE.Color(s));

export class GeoBuilder {
  constructor(seed = 1) {
    this.pos = []; this.nrm = []; this.col = []; this.idx = []; this.bone = []; this.bone2 = []; this.w2 = [];
    this.vcount = 0;
    this.rnd = mulberry32(seed);
  }
  // opts: flat (faceted), ao (0..1 darkening toward local bottom), jitter (brightness noise), bone index,
  //       skin: (x,y,z) => [boneA, boneB, weightB] for smooth joints (position after the matrix),
  //       displace (vertex wobble for rocks), gradient: [colorBottom, colorTop]
  add(geo, color, matrix = null, opts = {}) {
    let g = geo;
    if (opts.displace) {
      g = g.index ? g.toNonIndexed() : g.clone();
      const p = g.attributes.position;
      const seed = this.rnd() * 1000;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
        const f = 1 + (h - Math.floor(h) - 0.5) * opts.displace;
        p.setXYZ(i, x * f, y * f, z * f);
      }
    }
    if (opts.flat) {
      g = g.index ? g.toNonIndexed() : (g === geo ? g.clone() : g);
      g.computeVertexNormals();
    } else if (g === geo) {
      g = g.clone();
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    const bb = g.boundingBox, minY = bb.min.y, spanY = Math.max(1e-4, bb.max.y - bb.min.y);
    const p = g.attributes.position, n = g.attributes.normal;
    const c0 = col(color);
    const g0 = opts.gradient ? col(opts.gradient[0]) : null, g1 = opts.gradient ? col(opts.gradient[1]) : null;
    const ao = opts.ao || 0, jit = opts.jitter || 0;
    const tmpN = new THREE.Vector3(), tmpP = new THREE.Vector3();
    const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
    const base = this.vcount;
    let faceJ = 0;
    for (let i = 0; i < p.count; i++) {
      tmpP.fromBufferAttribute(p, i);
      const ty = (tmpP.y - minY) / spanY;
      tmpN.fromBufferAttribute(n, i);
      if (matrix) { tmpP.applyMatrix4(matrix); tmpN.applyMatrix3(nm).normalize(); }
      this.pos.push(tmpP.x, tmpP.y, tmpP.z);
      this.nrm.push(tmpN.x, tmpN.y, tmpN.z);
      let r = c0.r, gg = c0.g, b = c0.b;
      if (g0) { r = g0.r + (g1.r - g0.r) * ty; gg = g0.g + (g1.g - g0.g) * ty; b = g0.b + (g1.b - g0.b) * ty; }
      let f = 1 - ao * (1 - ty);
      if (jit) {
        if (!g.index && opts.flat) { if (i % 3 === 0) faceJ = (this.rnd() - 0.5) * jit; f *= 1 + faceJ; }
        else f *= 1 + (this.rnd() - 0.5) * jit;
      }
      this.col.push(r * f, gg * f, b * f);
      if (opts.skin) { const sk = opts.skin(tmpP.x, tmpP.y, tmpP.z); this.bone.push(sk[0]); this.bone2.push(sk[1]); this.w2.push(sk[2]); }
      else { this.bone.push(opts.bone || 0); this.bone2.push(0); this.w2.push(0); }
    }
    if (g.index) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) this.idx.push(base + ia[i]); }
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    this.vcount += p.count;
    if (g !== geo) g.dispose();
    return this;
  }
  build({ skin = false } = {}) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (skin) {
      const si = new Uint16Array(this.vcount * 4), sw = new Float32Array(this.vcount * 4);
      for (let i = 0; i < this.vcount; i++) {
        const w = this.w2[i];
        si[i * 4] = this.bone[i]; sw[i * 4] = 1 - w;
        if (w > 0) { si[i * 4 + 1] = this.bone2[i]; sw[i * 4 + 1] = w; }
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    }
    geo.setIndex(this.vcount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

// ---------------------------------------------------------------- vegetation
export function treeOak(seed, leaf = '#4f7a2c', leaf2 = '#6b9238') {
  const b = new GeoBuilder(seed), r = b.rnd;
  const h = 3.0 + r() * 1.4;
  b.add(cyl(0.22, 0.42, h, 7), '#5b4330', M(0, h / 2, 0), { ao: 0.5, jitter: 0.1 });
  b.add(cyl(0.08, 0.14, 1.8, 5), '#5b4330', M(0.5, h * 0.75, 0, 0, 0, -0.9));
  b.add(cyl(0.08, 0.14, 1.6, 5), '#5b4330', M(-0.45, h * 0.8, 0.2, 0.3, 0, 0.9));
  const blobs = 5;
  for (let i = 0; i < blobs; i++) {
    const a = i / blobs * Math.PI * 2 + r();
    const rr = i === 0 ? 0 : 1.2 + r() * 0.7;
    const s = i === 0 ? 2.2 + r() * 0.4 : 1.4 + r() * 0.6;
    b.add(ico(s, 1), r() < 0.5 ? leaf : leaf2, M(Math.cos(a) * rr, h + 1.3 + r() * 1.2 + (i === 0 ? 0.6 : 0), Math.sin(a) * rr, r(), r(), r(), 1, 0.82, 1), { flat: true, jitter: 0.22, ao: 0.35, displace: 0.25 });
  }
  return b.build();
}

export function treePine(seed, snowy = false) {
  const b = new GeoBuilder(seed), r = b.rnd;
  const h = 1.6 + r() * 0.6;
  b.add(cyl(0.14, 0.28, h + 1, 6), '#4d3a2a', M(0, (h + 1) / 2, 0), { ao: 0.4 });
  const tiers = 4;
  let y = h, rad = 2.3 + r() * 0.4;
  for (let i = 0; i < tiers; i++) {
    const th = 2.5 - i * 0.2;
    b.add(cone(rad, th, 8), snowy ? '#2f4a36' : '#2e5a31', M(0, y + th / 2, 0, 0, r() * 3, 0), { flat: true, jitter: 0.15, ao: 0.45 });
    if (snowy) b.add(cone(rad * 0.82, th * 0.55, 8), '#eef3f6', M(0, y + th * 0.68, 0, 0, r() * 3, 0), { flat: true, jitter: 0.06 });
    y += th * 0.62; rad *= 0.74;
  }
  return b.build();
}

export function treeWillow(seed) {
  const b = new GeoBuilder(seed), r = b.rnd;
  const h = 2.6 + r() * 0.8;
  b.add(cyl(0.25, 0.45, h, 7), '#5a4a35', M(0, h / 2, 0, 0, 0, 0.06), { ao: 0.5 });
  b.add(cyl(0.07, 0.12, 1.6, 5), '#5a4a35', M(0.55, h + 0.3, 0.1, 0, 0, -0.9));
  b.add(ico(2.2, 1), '#6a8738', M(0, h + 1.2, 0, 0, 0, 0, 1.25, 0.62, 1.25), { flat: true, jitter: 0.18, displace: 0.2 });
  // drooping curtains of leaves around the crown
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + r() * 0.4, rr = 2.0 + r() * 0.5;
    const len = 1.5 + r() * 1.0;
    b.add(ico(0.75, 1), r() < 0.5 ? '#86a04a' : '#728f3e', M(Math.cos(a) * rr, h + 1.0 - len * 0.55, Math.sin(a) * rr, 0, a, 0, 0.75, len, 0.45), { flat: true, jitter: 0.16, displace: 0.15, ao: 0.3 });
  }
  return b.build();
}

export function treePoplar(seed) {
  const b = new GeoBuilder(seed), r = b.rnd;
  const h = 1.6 + r() * 0.6;
  b.add(cyl(0.16, 0.28, h + 2, 6), '#57452f', M(0, (h + 2) / 2, 0), { ao: 0.4 });
  b.add(sph(1.3, 8, 7), '#4c7230', M(0, h + 3.6, 0, 0, r() * 3, 0, 1, 3.0, 1), { flat: true, jitter: 0.2, displace: 0.18, ao: 0.4 });
  return b.build();
}

export function treeDead(seed, colour = '#6b5b4b') {
  const b = new GeoBuilder(seed), r = b.rnd;
  const h = 3.2 + r() * 1.5;
  b.add(cyl(0.14, 0.32, h, 6), colour, M(0, h / 2, 0, 0, 0, (r() - 0.5) * 0.15), { ao: 0.4, flat: true });
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2, len = 1 + r() * 1.4, y = h * (0.45 + r() * 0.5);
    b.add(cyl(0.04, 0.09, len, 4), colour, M(Math.cos(a) * len * 0.35, y + len * 0.3, Math.sin(a) * len * 0.35, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9), { flat: true });
  }
  return b.build();
}

export function bush(seed, leaf = '#45692b', leaf2 = '#5b7f33') {
  const b = new GeoBuilder(seed), r = b.rnd;
  const n = 3 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const s = 0.6 + r() * 0.5, a = r() * 6.28, d = r() * 0.6;
    b.add(ico(s, 1), r() < 0.5 ? leaf : leaf2, M(Math.cos(a) * d, s * 0.6, Math.sin(a) * d, r(), r(), r(), 1, 0.75, 1), { flat: true, jitter: 0.25, ao: 0.45, displace: 0.3 });
  }
  return b.build();
}

export function dryBush(seed) {
  const b = new GeoBuilder(seed), r = b.rnd;
  for (let i = 0; i < 7; i++) {
    const a = r() * 6.28, len = 0.6 + r() * 0.7;
    b.add(cyl(0.015, 0.03, len, 3), '#7a5a3a', M(Math.cos(a) * 0.15, len / 2, Math.sin(a) * 0.15, Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5));
  }
  for (let i = 0; i < 4; i++) {
    const a = r() * 6.28, d = r() * 0.4;
    b.add(ico(0.32 + r() * 0.2, 0), '#8a8a4a', M(Math.cos(a) * d, 0.5 + r() * 0.4, Math.sin(a) * d), { flat: true, jitter: 0.3, displace: 0.4 });
  }
  return b.build();
}

export function rock(seed, colour = '#7a776e', size = 1) {
  const b = new GeoBuilder(seed), r = b.rnd;
  b.add(ico(size, 1), colour, M(0, size * 0.25, 0, r(), r(), r(), 1 + r() * 0.4, 0.55 + r() * 0.3, 1 + r() * 0.3), { flat: true, jitter: 0.18, displace: 0.45, ao: 0.35 });
  return b.build();
}

export function reeds(seed, snowy = false) {
  const b = new GeoBuilder(seed), r = b.rnd;
  const n = 9 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, d = r() * 0.55, h = 1.3 + r() * 1.1;
    const lean = (r() - 0.5) * 0.25;
    b.add(cone(0.035, h, 3), snowy ? '#a7a68a' : (r() < 0.5 ? '#6f8c3a' : '#8a9a4a'), M(Math.cos(a) * d, h / 2, Math.sin(a) * d, lean, a, lean), { gradient: snowy ? ['#7a7a60', '#d9d8c8'] : ['#4a6a2a', '#a8b25a'] });
    if (r() < 0.35) b.add(cyl(0.05, 0.05, 0.28, 5), '#5a3a22', M(Math.cos(a) * d + lean * h * 0.4, h * 0.82, Math.sin(a) * d));
  }
  return b.build();
}

export function lilypad(seed) {
  const b = new GeoBuilder(seed), r = b.rnd;
  for (let i = 0; i < 3; i++) {
    const a = r() * 6.28, d = r() * 0.9, s = 0.35 + r() * 0.3;
    b.add(cyl(s, s, 0.03, 9), r() < 0.5 ? '#4f7a32' : '#3f6a2a', M(Math.cos(a) * d, 0.04, Math.sin(a) * d));
    if (r() < 0.25) b.add(sph(0.09, 6, 4), '#f2d0e0', M(Math.cos(a) * d, 0.1, Math.sin(a) * d));
  }
  return b.build();
}

export function haybale(seed) {
  const b = new GeoBuilder(seed);
  b.add(cyl(0.75, 0.75, 1.3, 12), '#c9a64a', M(0, 0.72, 0, 0, b.rnd() * 3, Math.PI / 2), { jitter: 0.12 });
  b.add(cyl(0.6, 0.6, 1.32, 10), '#b48f3a', M(0, 0.72, 0, 0, 0, Math.PI / 2));
  return b.build();
}

export function iceFloe(seed) {
  const b = new GeoBuilder(seed), r = b.rnd;
  b.add(ico(1.6 + r() * 1.4, 1), '#e8f1f5', M(0, 0, 0, 0, r() * 3, 0, 1, 0.16, 1), { flat: true, jitter: 0.08, displace: 0.3 });
  return b.build();
}

export function grassTuft(seed, base = '#3f5a24', tip = '#9bb65a') {
  const pos = [], colA = [], idx = [];
  const r = mulberry32(seed), cb = col(base), ct = col(tip);
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = r() * Math.PI * 2, d = r() * 0.18, h = 0.28 + r() * 0.32, w = 0.035 + r() * 0.02;
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d, lean = 0.12 + r() * 0.15;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const v = pos.length / 3;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean);
    colA.push(cb.r, cb.g, cb.b, cb.r, cb.g, cb.b, ct.r, ct.g, ct.b);
    idx.push(v, v + 1, v + 2, v + 1, v, v + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3));
  const n = new Float32Array(pos.length); for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- structures
// Each returns { geo, colliders:[{x,y,z,hx,hy,hz}], hp, height } in local space (front = +Z).
export function sandbags(seed, colour = '#b2a079') {
  const b = new GeoBuilder(seed), r = b.rnd;
  const rows = 3;
  for (let row = 0; row < rows; row++) {
    const n = 7 - (row === 2 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = (i + (row % 2 ? 0.5 : 0)) / 6.5 - 0.5;
      const x = t * 4.0, z = -x * x * 0.12;
      b.add(sph(0.36, 8, 5), colour, M(x, 0.17 + row * 0.3, z, 0, -x * 0.12 + (r() - 0.5) * 0.15, 0, 0.95, 0.48, 0.62), { jitter: 0.18, ao: 0.4 });
    }
  }
  return { geo: b.build(), colliders: [{ x: 0, y: 0.48, z: -0.2, hx: 2.2, hy: 0.5, hz: 0.45 }], hp: 70, height: 1.0 };
}

export function bunker(seed) {
  const b = new GeoBuilder(seed);
  b.add(box(4.4, 2.1, 4.4), '#8f8f86', M(0, 1.05, 0), { jitter: 0.06, ao: 0.35 });
  b.add(box(5.0, 0.4, 5.0), '#a3a39a', M(0, 2.25, 0), { jitter: 0.05 });
  b.add(box(3.0, 0.32, 0.1), '#1d1d1a', M(0, 1.45, 2.21));
  b.add(box(1.0, 1.4, 0.12), '#2a2a26', M(-1.5, 0.7, -2.21));
  for (let i = 0; i < 5; i++) b.add(sph(0.4, 6, 4), '#6d7d45', M(-2 + i, 2.5, 2.2, 0, 0, 0, 1, 0.5, 0.8), { jitter: 0.3 });
  return { geo: b.build(), colliders: [{ x: 0, y: 1.2, z: 0, hx: 2.3, hy: 1.25, hz: 2.3 }], hp: 220, height: 2.5 };
}

export function hut(seed) {
  const b = new GeoBuilder(seed);
  b.add(box(3.8, 2.4, 3.2), '#7a5838', M(0, 1.2, 0), { jitter: 0.08, ao: 0.4 });
  for (let i = 0; i < 6; i++) b.add(box(3.82, 0.04, 3.22), '#5e4329', M(0, 0.3 + i * 0.38, 0));
  b.add(box(2.4, 0.12, 3.9), '#8a3c2a', M(-0.95, 2.95, 0, 0, 0, 0.62), { jitter: 0.1 });
  b.add(box(2.4, 0.12, 3.9), '#8a3c2a', M(0.95, 2.95, 0, 0, 0, -0.62), { jitter: 0.1 });
  b.add(box(0.9, 1.6, 0.06), '#3a2a1c', M(0, 0.8, 1.62));
  b.add(box(0.7, 0.6, 0.06), '#c9d6d8', M(1.2, 1.5, 1.62));
  return { geo: b.build(), colliders: [{ x: 0, y: 1.6, z: 0, hx: 1.95, hy: 1.6, hz: 1.65 }], hp: 140, height: 3.6 };
}

export function tent(seed) {
  const b = new GeoBuilder(seed);
  const canvas = '#8b8a5a', dark = '#6e6d45';
  // A-frame canvas roof with two gable ends
  b.add(box(2.6, 0.06, 4.2), canvas, M(-0.82, 1.0, 0, 0, 0, 0.88), { jitter: 0.06, ao: 0.25 });
  b.add(box(2.6, 0.06, 4.2), canvas, M(0.82, 1.0, 0, 0, 0, -0.88), { jitter: 0.06, ao: 0.25 });
  for (const zz of [-2.08, 2.08]) b.add(cyl(1.55, 1.55, 0.05, 3), dark, M(0, 0.74, zz, Math.PI / 2, 0, Math.PI / 2, 1, 1, 1));
  b.add(box(0.9, 1.2, 0.02), '#2a2a1c', M(0, 0.6, 2.11));
  b.add(cyl(0.05, 0.05, 2.2, 5), '#5e4632', M(0, 1.1, 2.15));
  b.add(box(0.8, 0.8, 0.8), '#7a5a35', M(2.0, 0.4, 1.3, 0, 0.3, 0), { jitter: 0.1 });
  b.add(box(0.7, 0.6, 0.7), '#6b4f2e', M(1.9, 1.1, 1.2, 0, 0.8, 0), { jitter: 0.1 });
  b.add(cyl(0.3, 0.3, 0.9, 10), '#4b5a32', M(-2.0, 0.45, -1.0));
  b.add(box(0.6, 0.45, 0.6), '#7a5a35', M(-1.9, 0.22, 1.4, 0, 0.5, 0), { jitter: 0.1 });
  return { geo: b.build(), colliders: [{ x: 0, y: 0.9, z: 0, hx: 1.6, hy: 0.95, hz: 2.15 }], hp: 80, height: 1.9 };
}

export function watchTower(seed) {
  const b = new GeoBuilder(seed);
  for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) b.add(box(0.22, 4.2, 0.22), '#5e4632', M(x, 2.1, z), { ao: 0.3 });
  b.add(box(1.5, 0.08, 0.08), '#5e4632', M(0, 1.6, 1.2, 0, 0, 0.9));
  b.add(box(1.5, 0.08, 0.08), '#5e4632', M(0, 1.6, -1.2, 0, 0, -0.9));
  b.add(box(3.0, 0.2, 3.0), '#7a5a3c', M(0, 4.2, 0), { jitter: 0.08 });
  for (const s of [-1, 1]) { b.add(box(3.0, 0.9, 0.08), '#6b4e33', M(0, 4.75, s * 1.46)); b.add(box(0.08, 0.9, 3.0), '#6b4e33', M(s * 1.46, 4.75, 0)); }
  for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) b.add(box(0.12, 1.6, 0.12), '#5e4632', M(x, 5.6, z));
  b.add(cone(2.6, 1.2, 4), '#4f5a36', M(0, 7.0, 0, 0, Math.PI / 4, 0), { flat: true });
  return { geo: b.build(), colliders: [{ x: 0, y: 5.2, z: 0, hx: 1.55, hy: 1.1, hz: 1.55 }, { x: 0, y: 2, z: 0, hx: 1.3, hy: 2.0, hz: 1.3, soft: true }], hp: 120, height: 7.6 };
}

export function dummy(seed) {
  const b = new GeoBuilder(seed);
  b.add(cyl(0.06, 0.06, 1.0, 6), '#5e4632', M(0, 0.5, 0));
  b.add(cyl(0.32, 0.38, 1.0, 9), '#d1b25a', M(0, 1.25, 0), { jitter: 0.25 });
  b.add(sph(0.26, 9, 6), '#c9a956', M(0, 1.95, 0), { jitter: 0.2 });
  b.add(box(1.3, 0.07, 0.07), '#5e4632', M(0, 1.5, 0));
  b.add(cyl(0.24, 0.24, 0.03, 14), '#f1ece0', M(0, 1.3, 0.37, Math.PI / 2, 0, 0));
  b.add(cyl(0.16, 0.16, 0.035, 14), '#c0392b', M(0, 1.3, 0.375, Math.PI / 2, 0, 0));
  b.add(cyl(0.07, 0.07, 0.04, 12), '#f1ece0', M(0, 1.3, 0.38, Math.PI / 2, 0, 0));
  return { geo: b.build(), colliders: [{ x: 0, y: 1.25, z: 0, hx: 0.45, hy: 0.95, hz: 0.45 }], hp: 30, height: 2.2 };
}

export function cage(seed) {
  const b = new GeoBuilder(seed);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    b.add(box(0.08, 2.0, 0.08), '#6b5136', M(Math.cos(a) * 1.0, 1.0, Math.sin(a) * 1.0));
  }
  b.add(cyl(1.15, 1.15, 0.14, 12), '#5e4632', M(0, 0.07, 0));
  b.add(cyl(1.15, 1.15, 0.14, 12), '#5e4632', M(0, 2.0, 0));
  return { geo: b.build(), colliders: [{ x: 0, y: 1.0, z: 0, hx: 1.05, hy: 1.05, hz: 1.05 }], hp: Infinity, height: 2.1 };
}

export function windmill(seed) {
  const b = new GeoBuilder(seed);
  b.add(cyl(1.6, 2.6, 9, 10), '#e4ddcc', M(0, 4.5, 0), { jitter: 0.06, ao: 0.4 });
  b.add(cone(2.1, 2.2, 10), '#6b3b2a', M(0, 10.1, 0), { flat: true });
  b.add(box(0.9, 1.6, 0.1), '#3a2a1c', M(0, 0.8, 2.45, -0.1, 0, 0));
  b.add(box(0.6, 0.6, 0.1), '#3a4a5a', M(0, 5, 2.0, -0.1, 0, 0));
  return { geo: b.build(), colliders: [{ x: 0, y: 4.5, z: 0, hx: 2.2, hy: 4.6, hz: 2.2 }], hp: Infinity, height: 11 };
}
export function millSails(seed) {
  const b = new GeoBuilder(seed);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    b.add(box(0.22, 5.2, 0.06), '#5e4632', M(Math.sin(a) * 2.6, Math.cos(a) * 2.6, 0, 0, 0, -a));
    b.add(box(0.9, 4.2, 0.03), '#ece6d6', M(Math.sin(a) * 2.9 + Math.cos(a) * 0.5, Math.cos(a) * 2.9 - Math.sin(a) * 0.5, 0.03, 0, 0, -a), { jitter: 0.08 });
  }
  b.add(cyl(0.3, 0.3, 0.6, 8), '#4a3a2a', M(0, 0, -0.2, Math.PI / 2, 0, 0));
  return b.build();
}

export function radar(seed) {
  const b = new GeoBuilder(seed);
  b.add(box(2.2, 1.4, 2.2), '#8a9098', M(0, 0.7, 0), { jitter: 0.06, ao: 0.4 });
  b.add(cyl(0.15, 0.2, 2.6, 8), '#5d636b', M(0, 2.6, 0));
  const dish = new THREE.SphereGeometry(1.9, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.32);
  b.add(dish, '#dfe4e8', M(0, 3.9, 0.3, -1.1, 0, 0), { jitter: 0.04 });
  b.add(dish, '#b7bdc4', M(0, 3.88, 0.32, -1.1 + Math.PI, 0, 0));
  b.add(cyl(0.05, 0.05, 1.4, 5), '#3a3f45', M(0, 4.3, 1.0, -1.1 + Math.PI / 2, 0, 0));
  return { geo: b.build(), colliders: [{ x: 0, y: 1.6, z: 0, hx: 1.2, hy: 1.6, hz: 1.2 }, { x: 0, y: 4.0, z: 0.3, hx: 1.6, hy: 1.2, hz: 0.7 }], hp: 160, height: 5.2 };
}

export function fence(seed) {
  const b = new GeoBuilder(seed), r = b.rnd;
  for (let i = 0; i < 4; i++) b.add(box(0.12, 1.1, 0.12), '#6b5136', M(-1.8 + i * 1.2, 0.55, 0, 0, 0, (r() - 0.5) * 0.08));
  b.add(box(3.8, 0.1, 0.06), '#7a5d3e', M(0, 0.85, 0));
  b.add(box(3.8, 0.1, 0.06), '#7a5d3e', M(0, 0.45, 0));
  return { geo: b.build(), colliders: [{ x: 0, y: 0.55, z: 0, hx: 1.9, hy: 0.55, hz: 0.1 }], hp: 20, height: 1.1 };
}

export function barrels(seed) {
  const b = new GeoBuilder(seed);
  for (const [x, z, y] of [[-0.35, 0, 0.5], [0.35, 0.1, 0.5], [0, -0.55, 0.5]]) {
    b.add(cyl(0.32, 0.32, 1.0, 12), '#9a2e1f', M(x, y, z), { jitter: 0.08, ao: 0.3 });
    b.add(cyl(0.335, 0.335, 0.06, 12), '#3a3a3a', M(x, y + 0.3, z));
    b.add(cyl(0.335, 0.335, 0.06, 12), '#3a3a3a', M(x, y - 0.3, z));
    b.add(cyl(0.12, 0.12, 0.04, 8), '#e8c23a', M(x, y + 0.51, z));
  }
  return { geo: b.build(), colliders: [{ x: 0, y: 0.5, z: -0.15, hx: 0.75, hy: 0.5, hz: 0.75 }], hp: 18, height: 1.0, explosive: true };
}

export function stoneWall(seed, colour = '#8a857a') {
  const b = new GeoBuilder(seed), r = b.rnd;
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
    const w = 0.75 + r() * 0.2;
    b.add(box(w, 0.45, 0.6), colour, M(-2.2 + i * 0.86 + (row % 2) * 0.4, 0.23 + row * 0.45, 0, 0, (r() - 0.5) * 0.1, 0), { jitter: 0.25, flat: true });
  }
  return { geo: b.build(), colliders: [{ x: 0.1, y: 0.7, z: 0, hx: 2.7, hy: 0.7, hz: 0.35 }], hp: 160, height: 1.4 };
}

export function weirWall(seed) {
  const b = new GeoBuilder(seed);
  b.add(box(34, 3.2, 3.0), '#8d8c84', M(0, 0.6, 0), { jitter: 0.04, ao: 0.4 });
  for (let i = 0; i < 9; i++) b.add(box(0.5, 1.4, 3.2), '#74736c', M(-16 + i * 4, 2.4, 0));
  b.add(box(34, 0.25, 0.25), '#5a5a55', M(0, 3.4, 1.3));
  return { geo: b.build(), colliders: [{ x: 0, y: 0.6, z: 0, hx: 17, hy: 1.6, hz: 1.5 }], hp: Infinity, height: 3.2 };
}

export function flagPole() {
  const b = new GeoBuilder(3);
  b.add(cyl(0.05, 0.08, 6.5, 6), '#b8b8b0', M(0, 3.25, 0));
  b.add(sph(0.12, 8, 6), '#d9b43a', M(0, 6.55, 0));
  b.add(cyl(0.6, 0.8, 0.3, 10), '#7a776e', M(0, 0.15, 0));
  return { geo: b.build(), colliders: [], hp: Infinity, height: 6.6 };
}

// ---------------------------------------------------------------- items
export function healthCrate() {
  const b = new GeoBuilder(5);
  b.add(box(0.8, 0.7, 0.8), '#e7e3d6', M(0, 0.35, 0), { jitter: 0.04, ao: 0.25 });
  for (const [rx, rz, x, y, z] of [[0, 0, 0, 0.705, 0], [Math.PI / 2, 0, 0, 0.35, 0.405], [Math.PI / 2, 0, 0, 0.35, -0.405], [0, Math.PI / 2, 0.405, 0.35, 0], [0, Math.PI / 2, -0.405, 0.35, 0]]) {
    b.add(box(0.5, 0.02, 0.16), '#2e9a4a', M(x, y, z, rx, 0, rz));
    b.add(box(0.16, 0.02, 0.5), '#2e9a4a', M(x, y, z, rx, 0, rz));
  }
  return b.build();
}
export function weaponCrate() {
  const b = new GeoBuilder(6);
  b.add(box(1.0, 0.6, 0.7), '#5d6a38', M(0, 0.3, 0), { jitter: 0.05, ao: 0.3 });
  b.add(box(1.02, 0.1, 0.72), '#3f4a26', M(0, 0.48, 0));
  b.add(box(0.5, 0.2, 0.02), '#e2c044', M(0, 0.28, 0.36));
  b.add(box(0.5, 0.2, 0.02), '#e2c044', M(0, 0.28, -0.36));
  return b.build();
}
export function parachute() {
  const b = new GeoBuilder(7);
  for (let i = 0; i < 8; i++) {
    const g = new THREE.SphereGeometry(1.9, 3, 5, i / 8 * Math.PI * 2, Math.PI / 4, 0, Math.PI / 2);
    b.add(g, i % 2 ? '#e8e4da' : '#d9752e', M(0, 3.2, 0, 0, 0, 0, 1, 0.6, 1));
  }
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + 0.4;
    b.add(cyl(0.01, 0.01, 3.4, 3), '#ddd', M(Math.cos(a) * 0.9, 1.7, Math.sin(a) * 0.9, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5));
  }
  return b.build();
}
export function mineModel() {
  const b = new GeoBuilder(8);
  b.add(cyl(0.26, 0.3, 0.09, 12), '#3f4630', M(0, 0.045, 0), { ao: 0.3 });
  b.add(cyl(0.12, 0.14, 0.06, 10), '#2f3524', M(0, 0.11, 0));
  return b.build();
}
export function memorial(helmetColour) {
  const b = new GeoBuilder(9);
  b.add(box(0.07, 1.0, 0.07), '#6b5136', M(0, 0.5, 0));
  b.add(new THREE.SphereGeometry(0.3, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), helmetColour, M(0, 1.0, 0), { ao: 0.2 });
  b.add(cyl(0.36, 0.36, 0.03, 12), helmetColour, M(0, 1.0, 0));
  b.add(box(0.03, 0.5, 0.03), '#ddd', M(0.12, 1.35, 0));
  b.add(box(0.28, 0.18, 0.01), '#f4f2ec', M(0.27, 1.5, 0));
  return b.build();
}

// Weapons are modelled pointing down -Z with the grip at the origin.
export function weaponModel(id) {
  const b = new GeoBuilder(10);
  const olive = '#55603a', dark = '#2e3128', wood = '#7a5232', steel = '#5d6066';
  switch (id) {
    case 'bazooka':
      b.add(cyl(0.075, 0.075, 1.15, 10), olive, M(0, 0.1, -0.25, Math.PI / 2, 0, 0), { jitter: 0.05 });
      b.add(cyl(0.1, 0.075, 0.18, 10), dark, M(0, 0.1, -0.86, Math.PI / 2, 0, 0));
      b.add(cyl(0.075, 0.11, 0.16, 10), dark, M(0, 0.1, 0.36, Math.PI / 2, 0, 0));
      b.add(box(0.04, 0.14, 0.06), dark, M(0, -0.02, 0));
      b.add(box(0.03, 0.07, 0.03), '#e2c044', M(0, 0.2, -0.55));
      break;
    case 'cluster':
      b.add(cyl(0.085, 0.085, 1.05, 10), '#6a5a2a', M(0, 0.1, -0.2, Math.PI / 2, 0, 0));
      b.add(cyl(0.16, 0.16, 0.3, 12), '#e2c044', M(0, 0.1, -0.1, Math.PI / 2, 0, 0));
      b.add(cyl(0.12, 0.085, 0.16, 10), dark, M(0, 0.1, -0.78, Math.PI / 2, 0, 0));
      b.add(box(0.04, 0.14, 0.06), dark, M(0, -0.02, 0.1));
      break;
    case 'mortar':
      b.add(cyl(0.1, 0.1, 0.8, 12), '#4a5232', M(0, 0.12, -0.2, Math.PI / 2, 0, 0));
      b.add(cyl(0.13, 0.13, 0.08, 12), dark, M(0, 0.12, 0.22, Math.PI / 2, 0, 0));
      b.add(box(0.04, 0.14, 0.06), dark, M(0, -0.02, 0));
      break;
    case 'rifle':
      b.add(box(0.06, 0.1, 0.42), wood, M(0, 0, 0.12));
      b.add(cyl(0.018, 0.018, 0.7, 6), steel, M(0, 0.04, -0.42, Math.PI / 2, 0, 0));
      b.add(box(0.05, 0.08, 0.26), wood, M(0, 0.02, -0.25));
      break;
    case 'sniper':
      b.add(box(0.06, 0.1, 0.46), '#4a3a28', M(0, 0, 0.14));
      b.add(cyl(0.02, 0.02, 0.95, 6), dark, M(0, 0.04, -0.55, Math.PI / 2, 0, 0));
      b.add(cyl(0.035, 0.035, 0.32, 8), '#1d1f22', M(0, 0.13, -0.12, Math.PI / 2, 0, 0));
      b.add(box(0.05, 0.08, 0.3), '#4a3a28', M(0, 0.02, -0.3));
      break;
    case 'homing':
      b.add(cyl(0.09, 0.09, 0.9, 10), '#5a6a7a', M(0, 0.1, -0.2, Math.PI / 2, 0, 0));
      b.add(sph(0.08, 8, 6), '#f4f4f0', M(0, 0.1, -0.68, 0, 0, 0, 1, 1, 1.6));
      b.add(cone(0.03, 0.08, 6), '#e2a03a', M(0, 0.1, -0.84, -Math.PI / 2, 0, 0));
      b.add(box(0.04, 0.14, 0.06), dark, M(0, -0.02, 0));
      break;
    case 'grenade':
      b.add(sph(0.09, 10, 8), '#4d5a30', M(0, 0.06, -0.04), { jitter: 0.06 });
      b.add(cyl(0.03, 0.03, 0.06, 6), steel, M(0, 0.16, -0.04));
      b.add(box(0.02, 0.12, 0.03), steel, M(0.05, 0.1, -0.04, 0, 0, -0.3));
      break;
    case 'mine':
      b.add(cyl(0.22, 0.25, 0.08, 12), '#3f4630', M(0, 0.04, -0.12));
      b.add(cyl(0.1, 0.12, 0.05, 10), '#2f3524', M(0, 0.1, -0.12));
      break;
    case 'airstrike':
      b.add(box(0.12, 0.2, 0.08), '#3e4a2a', M(0, 0.06, -0.04));
      b.add(cyl(0.008, 0.008, 0.4, 4), '#222', M(0.04, 0.35, -0.04));
      b.add(box(0.08, 0.05, 0.02), '#e2c044', M(0, 0.1, -0.085));
      break;
    case 'medkit':
      b.add(box(0.28, 0.2, 0.12), '#e7e3d6', M(0, 0.06, -0.06));
      b.add(box(0.14, 0.04, 0.125), '#2e9a4a', M(0, 0.06, -0.06));
      b.add(box(0.04, 0.14, 0.125), '#2e9a4a', M(0, 0.06, -0.06));
      break;
    case 'airburst':
      b.add(cyl(0.1, 0.1, 0.8, 12), '#5a3a32', M(0, 0.12, -0.2, Math.PI / 2, 0, 0));
      b.add(cyl(0.105, 0.105, 0.08, 12), '#c8473a', M(0, 0.12, -0.42, Math.PI / 2, 0, 0));
      b.add(cyl(0.13, 0.13, 0.08, 12), dark, M(0, 0.12, 0.22, Math.PI / 2, 0, 0));
      b.add(box(0.04, 0.14, 0.06), dark, M(0, -0.02, 0));
      break;
    case 'shotgun':
      b.add(box(0.06, 0.1, 0.36), wood, M(0, 0, 0.13));
      for (const x of [-0.023, 0.023]) b.add(cyl(0.021, 0.021, 0.62, 8), steel, M(x, 0.045, -0.37, Math.PI / 2, 0, 0));
      b.add(box(0.075, 0.06, 0.2), wood, M(0, 0.015, -0.2));
      break;
    case 'medidart':
      b.add(box(0.045, 0.13, 0.06), '#e7e3d6', M(0, -0.02, 0.01, -0.25, 0, 0));
      b.add(cyl(0.028, 0.028, 0.3, 8), '#e7e3d6', M(0, 0.06, -0.1, Math.PI / 2, 0, 0));
      b.add(box(0.03, 0.01, 0.06), '#2e9a4a', M(0, 0.095, -0.1));
      b.add(box(0.01, 0.03, 0.06), '#2e9a4a', M(0, 0.095, -0.1));
      b.add(cone(0.014, 0.05, 6), '#c8473a', M(0, 0.06, -0.27, -Math.PI / 2, 0, 0));
      break;
    case 'tnt':
      for (const [x, z] of [[-0.032, 0], [0.032, 0], [0, 0.03]]) b.add(cyl(0.03, 0.03, 0.2, 8), '#b8352a', M(x, 0.1, -0.04 + z));
      b.add(cyl(0.062, 0.062, 0.03, 10, true), '#2a2a2a', M(0, 0.1, -0.03, 0, 0, 0, 1, 1, 0.9));
      b.add(cyl(0.004, 0.004, 0.07, 4), '#e2c044', M(0, 0.23, -0.03, 0.3, 0, 0));
      break;
    case 'camo':
      b.add(sph(0.11, 8, 6), '#4f6a2e', M(0, 0.08, -0.04, 0, 0, 0, 1.2, 0.7, 1), { flat: true, jitter: 0.25, displace: 0.3 });
      for (let i = 0; i < 6; i++) { const a = i * 1.05; b.add(cone(0.035, 0.1, 4), i % 2 ? '#6b8a3a' : '#3d5222', M(Math.cos(a) * 0.09, 0.12, -0.04 + Math.sin(a) * 0.08, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6), { flat: true }); }
      break;
    case 'sandbags':
      b.add(sph(0.13, 8, 6), '#b49a6a', M(0, 0.08, -0.04, 0, 0, 0, 1.3, 0.55, 0.85), { flat: true, jitter: 0.12 });
      b.add(cyl(0.012, 0.012, 0.08, 4), '#6b5a3a', M(0.1, 0.11, -0.04, 0, 0, 0.5));
      break;
    case 'jetpack':
      b.add(box(0.05, 0.14, 0.06), dark, M(0, -0.01, 0));
      b.add(box(0.07, 0.04, 0.1), '#5d6066', M(0, 0.08, -0.02));
      b.add(cyl(0.018, 0.018, 0.02, 8), '#c8473a', M(0, 0.105, -0.04));
      break;
    case 'paradrop':
      b.add(box(0.045, 0.13, 0.06), '#d8632a', M(0, -0.02, 0.01, -0.25, 0, 0));
      b.add(cyl(0.04, 0.034, 0.2, 10), '#d8632a', M(0, 0.06, -0.06, Math.PI / 2, 0, 0));
      b.add(cyl(0.03, 0.03, 0.02, 10), '#2a2a2a', M(0, 0.06, -0.17, Math.PI / 2, 0, 0));
      break;
    default: // slap: nothing in hand
      b.add(box(0.001, 0.001, 0.001), '#000', M());
  }
  return b.build();
}

export function projectileModel(type) {
  const b = new GeoBuilder(11);
  switch (type) {
    case 'rocket':
      b.add(cyl(0.07, 0.07, 0.5, 8), '#55603a', M(0, 0, 0, Math.PI / 2, 0, 0));
      b.add(cone(0.07, 0.2, 8), '#b0392b', M(0, 0, -0.35, -Math.PI / 2, 0, 0));
      for (let i = 0; i < 4; i++) b.add(box(0.01, 0.16, 0.14), '#3a3f2a', M(0, 0, 0.22, 0, 0, i * Math.PI / 2));
      break;
    case 'shell':
      b.add(sph(0.1, 8, 6), '#3d4130', M(0, 0, 0, 0, 0, 0, 1, 1, 1.9));
      break;
    case 'grenade':
      b.add(sph(0.1, 8, 6), '#4d5a30', M());
      b.add(cyl(0.03, 0.03, 0.07, 6), '#5d6066', M(0, 0.1, 0));
      break;
    case 'bomblet':
      b.add(sph(0.08, 8, 6), '#e2c044', M());
      b.add(cyl(0.081, 0.081, 0.04, 8), '#222', M());
      break;
    case 'bullet':
      b.add(sph(0.035, 6, 4), '#e2b44a', M(0, 0, 0, 0, 0, 0, 1, 1, 2.5));
      break;
    case 'tnt':
      for (const [x, z] of [[-0.04, 0], [0.04, 0], [0, 0.038]]) b.add(cyl(0.038, 0.038, 0.26, 8), '#b8352a', M(x, 0, z));
      b.add(cyl(0.08, 0.08, 0.04, 10, true), '#2a2a2a', M(0, 0, 0.01));
      b.add(cyl(0.005, 0.005, 0.09, 4), '#e2c044', M(0, 0.17, 0, 0.3, 0, 0));
      break;
    case 'bomb':
      b.add(cyl(0.13, 0.13, 0.55, 8), '#3a3d33', M(0, 0, 0, Math.PI / 2, 0, 0));
      b.add(sph(0.13, 8, 6), '#3a3d33', M(0, 0, -0.27));
      for (let i = 0; i < 4; i++) b.add(box(0.01, 0.22, 0.18), '#2a2c25', M(0, 0, 0.32, 0, 0, i * Math.PI / 2));
      break;
    case 'gull':
      b.add(sph(0.12, 8, 6), '#f4f4f0', M(0, 0, 0, 0, 0, 0, 0.8, 0.8, 2.0));
      b.add(sph(0.08, 8, 6), '#f4f4f0', M(0, 0.05, -0.24));
      b.add(cone(0.03, 0.1, 6), '#e2a03a', M(0, 0.04, -0.34, -Math.PI / 2, 0, 0));
      b.add(box(0.7, 0.02, 0.14), '#e6e6e0', M(0, 0.02, 0.02));
      b.add(box(0.12, 0.022, 0.08), '#2a2a2a', M(0.36, 0.02, 0.04));
      b.add(box(0.12, 0.022, 0.08), '#2a2a2a', M(-0.36, 0.02, 0.04));
      break;
  }
  return b.build();
}

export function planeModel() {
  const b = new GeoBuilder(12);
  b.add(cyl(0.55, 0.35, 6.0, 10), '#5b6a3a', M(0, 0, 0, Math.PI / 2, 0, 0), { jitter: 0.05 });
  b.add(sph(0.56, 10, 6), '#4a4a44', M(0, 0, -3.0));
  b.add(box(10, 0.12, 1.5), '#6b7a46', M(0, 0.1, -0.8), { jitter: 0.05 });
  b.add(box(3.4, 0.1, 0.9), '#6b7a46', M(0, 0.2, 2.7));
  b.add(box(0.1, 1.3, 1.0), '#6b7a46', M(0, 0.8, 2.8));
  b.add(box(0.2, 2.4, 0.08), '#2a2a2a', M(0, 0, -3.5));
  b.add(sph(0.35, 8, 6), '#9ab4c4', M(0, 0.5, -0.6, 0, 0, 0, 1, 0.7, 1.5));
  return b.build();
}

// A parachute canopy with rigging lines; the duck hangs at the origin.
export function parachuteModel(color = '#e9e2cc', stripe = '#c8473a') {
  const b = new GeoBuilder(21);
  b.add(new THREE.SphereGeometry(1.7, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), color, M(0, 4.2, 0, 0, 0, 0, 1, 0.55, 1), { ao: -0.3 });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    b.add(new THREE.SphereGeometry(1.705, 3, 6, a, 0.32, 0, Math.PI / 2.6), stripe, M(0, 4.2, 0, 0, 0, 0, 1, 0.55, 1));
  }
  for (let i = 0; i < 8; i++) {
    // cords run down to a harness at the shoulders, clear of the wearer's eyes
    const a = (i + 0.5) / 8 * Math.PI * 2, top = [Math.cos(a) * 1.45, 4.55, Math.sin(a) * 1.45], bot = [Math.cos(a) * 0.21, 1.3, Math.sin(a) * 0.11];
    const mid = new THREE.Vector3((top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2);
    const dir = new THREE.Vector3(top[0] - bot[0], top[1] - bot[1], top[2] - bot[2]);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    b.add(cyl(0.006, 0.006, len, 3), '#9a917c', new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  }
  return b.build();
}
