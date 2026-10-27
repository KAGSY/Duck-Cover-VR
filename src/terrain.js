// Heightmap terrain: generation per biome, baked sun shadows + AO into
// vertex data, deformable craters, and queries used by physics and AI.
import * as THREE from 'three';
import { makeNoise2D, fbm, ridged } from './rng.js';
import { clamp, lerp, smoothstep } from './ctx.js';

export const MAP_SIZE = 160;
export const GRID = 161;           // vertices per side (1 m cells)
export const CELL = MAP_SIZE / (GRID - 1);
export const HALF = MAP_SIZE / 2;
export const WATER = 0;
export const SWEPT_LIMIT = 86;     // beyond this a duck is carried off by the current
export const MIN_HEIGHT = -9;

const hex = (s) => new THREE.Color(s);

export const BIOMES = {
  marsh: {
    name: 'Reed marsh', grass: '#58762f', grass2: '#748f3c', dry: '#9a9653', beach: '#55493a', underwater: '#3e4a33',
    rock: '#6e6a5e', dirt: '#5a4630', dryAmount: 0.45, hills: '#4c6644',
  },
  farm: {
    name: 'Farmland', grass: '#6a9437', grass2: '#8aab45', dry: '#bca75b', beach: '#a99a70', underwater: '#5a5a40',
    rock: '#7a776c', dirt: '#6b5236', dryAmount: 0.7, hills: '#5c7a4a',
  },
  snow: {
    name: 'Frozen firth', grass: '#e6ecf1', grass2: '#d9e2ea', dry: '#c7d1db', beach: '#aab4bd', underwater: '#7b8a96',
    rock: '#585e66', dirt: '#6a5f56', dryAmount: 0.6, hills: '#c9d4de',
  },
  canyon: {
    name: 'Rustwater canyons', grass: '#b5743f', grass2: '#c78a4f', dry: '#d6a66c', beach: '#d4ad7a', underwater: '#7a5a40',
    rock: '#9a5634', dirt: '#7a4a2e', dryAmount: 0.8, hills: '#a8643c',
    strata: ['#a24f2c', '#c0703f', '#dca066', '#b4633a', '#e3b47c'],
  },
  weir: {
    name: 'River weir', grass: '#55793a', grass2: '#6c8d40', dry: '#8f985a', beach: '#8d8466', underwater: '#45503a',
    rock: '#6f6f6a', dirt: '#5e4a34', dryAmount: 0.4, hills: '#4a6448',
  },
};

function biomeHeight(biome, x, z, N, seedPhase) {
  let h;
  switch (biome) {
    case 'marsh': {
      const wx = x + 14 * N.a(x * 0.008, z * 0.008), wz = z + 14 * N.b(x * 0.008 + 3, z * 0.008);
      h = 1.3 + 2.0 * fbm(N.a, wx * 0.014, wz * 0.014, 4) + 0.5 * fbm(N.b, x * 0.06, z * 0.06, 2);
      const ch = Math.abs(fbm(N.c, wx * 0.0075, wz * 0.0075, 3));
      h -= smoothstep(0.10, 0.025, ch) * 3.2;
      h -= smoothstep(0.38, 0.62, fbm(N.d, x * 0.02, z * 0.02, 2)) * 2.6;
      break;
    }
    case 'farm': {
      h = 3.2 + 5.0 * fbm(N.a, x * 0.011, z * 0.011, 4) + 1.2 * fbm(N.b, x * 0.035, z * 0.035, 3);
      const zc = 24 * Math.sin(x * 0.026 + seedPhase) + 8 * N.c(x * 0.01, 0.5) - 6;
      const d = Math.abs(z - zc);
      h = lerp(h, -1.8, smoothstep(9.5, 3.5, d));
      break;
    }
    case 'snow': {
      h = -2 + 9 * fbm(N.a, x * 0.01, z * 0.01, 4) + 13 * ridged(N.b, x * 0.011, z * 0.011, 4);
      h -= smoothstep(0.32, 0.58, fbm(N.d, x * 0.016, z * 0.016, 2)) * 9;
      h += 0.35 * fbm(N.c, x * 0.09, z * 0.09, 2);
      break;
    }
    case 'canyon': {
      const base = 6 + 9 * fbm(N.a, x * 0.012, z * 0.012, 4);
      const step = 3.6, t = base / step, fl = Math.floor(t), fr = t - fl;
      h = (fl + smoothstep(0.72, 1.0, fr)) * step - 1.0;
      const g = Math.abs(fbm(N.c, x * 0.009 + 3, z * 0.009, 3));
      h = lerp(h, 0.45, smoothstep(0.1, 0.035, g));          // dry gorge floors
      h -= smoothstep(0.42, 0.62, fbm(N.d, x * 0.018, z * 0.018, 2)) * 4; // a few rust-red pools
      h += 0.35 * fbm(N.b, x * 0.08, z * 0.08, 2);
      break;
    }
    case 'weir':
    default: {
      const xc = 7 * Math.sin(z * 0.03 + seedPhase);
      const d = Math.abs(x - xc);
      h = 2.4 + 4.5 * fbm(N.a, x * 0.012, z * 0.012, 4) + smoothstep(10, 45, d) * 4;
      h = lerp(h, -2.6, smoothstep(15, 7.5, d));
      break;
    }
  }
  // Island coastline: superellipse falloff with a noisy edge.
  const se = Math.pow(Math.pow(Math.abs(x) / HALF, 4) + Math.pow(Math.abs(z) / HALF, 4), 0.25);
  const coast = se + 0.07 * N.d(x * 0.02 + 7, z * 0.02 - 3);
  h = lerp(h, -5.5, smoothstep(0.8, 0.985, coast));
  return h;
}

export class Terrain {
  constructor({ seed, biome, sun, pads = null }) {
    this.seed = seed;
    this.biome = biome;
    this.B = BIOMES[biome] || BIOMES.marsh;
    this.sun = sun.clone().normalize(); // direction toward the sun
    const n = GRID * GRID;
    this.H = new Float32Array(n);
    this.dig = new Float32Array(n);
    this.scorch = new Float32Array(n);
    this.shade = new Float32Array(n);
    this.nA = new Float32Array(n);
    this.nB = new Float32Array(n);
    this.nrm = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.sunVis = new Float32Array(n);
    this.pal = {};
    for (const k of ['grass', 'grass2', 'dry', 'beach', 'underwater', 'rock', 'dirt']) this.pal[k] = hex(this.B[k]);
    if (this.B.strata) this.pal.strata = this.B.strata.map(hex);
    this.generateRaw();
    if (pads) this.finalize(pads);
  }

  // Raw heights only. Call finalize(pads) once spawn points and buildings are chosen.
  generateRaw() {
    const N = { a: makeNoise2D(this.seed), b: makeNoise2D(this.seed + 101), c: makeNoise2D(this.seed + 202), d: makeNoise2D(this.seed + 303) };
    const phase = (this.seed % 1000) * 0.0137;
    const H = this.H;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * GRID + i;
        H[k] = biomeHeight(this.biome, x, z, N, phase);
        this.nA[k] = 0.5 + 0.5 * fbm(N.b, x * 0.045 + 11, z * 0.045 - 7, 3);
        this.nB[k] = 0.5 + 0.5 * fbm(N.c, x * 0.11 - 5, z * 0.11 + 2, 2);
      }
    }
    // soften 1 m stair-steps and noise spikes
    this.smooth(this.biome === 'canyon' ? 0.35 : this.biome === 'snow' ? 0.8 : 0.5);
  }

  smooth(w) {
    const H = this.H, N = GRID, tmp = new Float32Array(H.length);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let sum = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        sum += H[jj * N + ii]; c++;
      }
      tmp[j * N + i] = H[j * N + i] * (1 - w) + (sum / c) * w;
    }
    H.set(tmp);
  }

  finalize(pads = [], bake = true) {
    for (const p of pads) this.applyPad(p);
    const H = this.H;
    this.maxH = -Infinity;
    for (let k = 0; k < H.length; k++) if (H[k] > this.maxH) this.maxH = H[k];
    if (bake) this.bakeRegion(0, 0, GRID - 1, GRID - 1);
  }

  // Nearest dry, gentle spot to (x,z) within maxR. Returns {x,z} (falls back to the input).
  findLand(x, z, maxR = 40, minH = 1.0, maxSlope = 0.22) {
    for (let r = 0; r <= maxR; r += 2) {
      const steps = Math.max(1, Math.round(r * 1.5));
      for (let s = 0; s < steps; s++) {
        const a = s / steps * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!this.inBounds(px, pz, 8)) continue;
        if (this.heightAt(px, pz) >= minH && this.slopeAt(px, pz) <= maxSlope) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  applyPad(p) {
    const r = p.r, outer = r * (p.soft || 1.8);
    let target = p.h;
    if (target === undefined) target = Math.max(this.heightAt(p.x, p.z), p.min ?? 1.2);
    if (p.max !== undefined) target = Math.min(target, p.max);
    const i0 = Math.max(0, Math.floor((p.x - outer + HALF) / CELL)), i1 = Math.min(GRID - 1, Math.ceil((p.x + outer + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((p.z - outer + HALF) / CELL)), j1 = Math.min(GRID - 1, Math.ceil((p.z + outer + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const d = Math.hypot(x - p.x, z - p.z);
      const w = smoothstep(outer, r, d);
      if (w > 0) { const k = j * GRID + i; this.H[k] = lerp(this.H[k], target, w); }
    }
    return target;
  }

  // ---------- queries ----------
  heightAt(x, z) {
    let gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
    if (gx < 0) gx = 0; else if (gx > GRID - 1.0001) gx = GRID - 1.0001;
    if (gz < 0) gz = 0; else if (gz > GRID - 1.0001) gz = GRID - 1.0001;
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
    const k = j * GRID + i, H = this.H;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + GRID], h11 = H[k + GRID + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.6;
    out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e));
    return out.normalize();
  }

  // Fast bilinear sample in grid units (used by baking).
  sampleGrid(gx, gz) {
    if (gx < 0) gx = 0; else if (gx > GRID - 1.0001) gx = GRID - 1.0001;
    if (gz < 0) gz = 0; else if (gz > GRID - 1.0001) gz = GRID - 1.0001;
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, k = j * GRID + i, H = this.H;
    const a = H[k] + (H[k + 1] - H[k]) * fx;
    const b = H[k + GRID] + (H[k + GRID + 1] - H[k + GRID]) * fx;
    return a + (b - a) * fz;
  }

  slopeAt(x, z) { return 1 - this.normalAt(x, z, _n).y; }
  isWater(x, z) { return this.heightAt(x, z) < WATER - 0.25; }
  inBounds(x, z, margin = 0) { return Math.abs(x) < HALF - margin && Math.abs(z) < HALF - margin; }

  // March a ray against the heightfield. Returns hit distance or -1.
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 300) {
    let t = 0, prevT = 0;
    if (oy <= this.heightAt(ox, oz)) return 0;
    while (t < maxDist) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      const h = this.heightAt(x, z);
      if (y <= h) {
        let a = prevT, b = t;
        for (let it = 0; it < 10; it++) {
          const m = (a + b) * 0.5;
          if (oy + dy * m <= this.heightAt(ox + dx * m, oz + dz * m)) b = m; else a = m;
        }
        return b;
      }
      prevT = t;
      t += Math.max(0.2, Math.min((y - h) * 0.55, 3));
    }
    return -1;
  }

  // ---------- baking ----------
  albedoInto(k, out) {
    const P = this.pal, h = this.H[k], ny = this.nrm[k * 3 + 1];
    const slope = 1 - ny;
    const a = this.nA[k], b = this.nB[k];
    let r, g, bl;
    // vegetation base
    const t1 = smoothstep(0.3, 0.7, a);
    r = lerp(P.grass.r, P.grass2.r, t1); g = lerp(P.grass.g, P.grass2.g, t1); bl = lerp(P.grass.b, P.grass2.b, t1);
    const t2 = smoothstep(0.55, 0.85, b) * this.B.dryAmount;
    r = lerp(r, P.dry.r, t2); g = lerp(g, P.dry.g, t2); bl = lerp(bl, P.dry.b, t2);
    // shoreline
    const beach = 1 - smoothstep(0.25, 1.3, h + (b - 0.5) * 0.6);
    r = lerp(r, P.beach.r, beach); g = lerp(g, P.beach.g, beach); bl = lerp(bl, P.beach.b, beach);
    if (h < -0.2) { const u = smoothstep(-0.2, -2.0, h); r = lerp(r, P.underwater.r, u); g = lerp(g, P.underwater.g, u); bl = lerp(bl, P.underwater.b, u); }
    // rock on steep ground (canyon uses strata bands)
    const rk = smoothstep(0.3, 0.52, slope + (b - 0.5) * 0.16);
    if (rk > 0) {
      let rc = P.rock;
      if (P.strata) {
        const band = (h * 0.55 + a * 1.5);
        const idx = ((Math.floor(band) % P.strata.length) + P.strata.length) % P.strata.length;
        rc = P.strata[idx];
      }
      r = lerp(r, rc.r, rk); g = lerp(g, rc.g, rk); bl = lerp(bl, rc.b, rk);
    }
    // exposed dirt in craters, scorching, baked blob shade
    const d = Math.min(1, this.dig[k]) * 0.9;
    r = lerp(r, P.dirt.r, d); g = lerp(g, P.dirt.g, d); bl = lerp(bl, P.dirt.b, d);
    const s = (1 - 0.75 * Math.min(1, this.scorch[k])) * (1 - this.shade[k]);
    out[0] = r * s; out[1] = g * s; out[2] = bl * s;
  }

  bakeRegion(i0, j0, i1, j1) {
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(GRID - 1, i1); j1 = Math.min(GRID - 1, j1);
    const H = this.H, N = GRID;
    // normals
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      const hl = H[j * N + Math.max(i - 1, 0)], hr = H[j * N + Math.min(i + 1, N - 1)];
      const hd = H[Math.max(j - 1, 0) * N + i], hu = H[Math.min(j + 1, N - 1) * N + i];
      let nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
      const l = Math.hypot(nx, ny, nz);
      this.nrm[k * 3] = nx / l; this.nrm[k * 3 + 1] = ny / l; this.nrm[k * 3 + 2] = nz / l;
    }
    // AO + sun visibility + colour
    const sun = this.sun;
    const sh = Math.hypot(sun.x, sun.z) || 1;
    const sdx = sun.x / sh, sdz = sun.z / sh, tanE = sun.y / sh;
    const dirs = AO_DIRS, steps = AO_STEPS;
    const tmp = [0, 0, 0];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i, h0 = H[k];
      // horizon AO
      let occ = 0;
      for (let d = 0; d < dirs.length; d += 2) {
        let maxS = 0;
        for (let s = 0; s < steps.length; s++) {
          const dist = steps[s];
          const hh = this.sampleGrid(i + dirs[d] * dist / CELL, j + dirs[d + 1] * dist / CELL);
          const sl = (hh - h0) / dist;
          if (sl > maxS) maxS = sl;
        }
        occ += Math.atan(maxS) / (Math.PI / 2);
      }
      const ao = 1 - clamp(occ / (dirs.length / 2), 0, 1) * 0.85;
      // sun shadow march
      let vis = 1;
      if (h0 < this.maxH + 0.5) {
        for (let s = 1.5; s < 70; s += 1.5) {
          const rayH = h0 + 0.25 + s * tanE;
          if (rayH > this.maxH) break;
          const th = this.sampleGrid(i + sdx * s / CELL, j + sdz * s / CELL);
          const v = clamp((rayH - th) / (0.06 * s + 0.25), 0, 1);
          if (v < vis) { vis = v; if (vis <= 0) break; }
        }
      }
      this.sunVis[k] = 0.06 + 0.94 * vis;
      this.albedoInto(k, tmp);
      this.col[k * 3] = tmp[0] * ao; this.col[k * 3 + 1] = tmp[1] * ao; this.col[k * 3 + 2] = tmp[2] * ao;
    }
  }

  // ---------- mesh ----------
  buildMesh(detailTex, quality) {
    const n = GRID * GRID;
    const pos = new Float32Array(n * 3);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i;
      pos[k * 3] = -HALF + i * CELL; pos[k * 3 + 1] = this.H[k]; pos[k * 3 + 2] = -HALF + j * CELL;
    }
    const idx = new Uint32Array((GRID - 1) * (GRID - 1) * 6);
    let p = 0;
    for (let j = 0; j < GRID - 1; j++) for (let i = 0; i < GRID - 1; i++) {
      const a = j * GRID + i, b = (j + 1) * GRID + i, c = j * GRID + i + 1, d = (j + 1) * GRID + i + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = b; idx[p++] = d; idx[p++] = c;
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.visAttr = new THREE.BufferAttribute(this.sunVis, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setAttribute('sunVis', this.visAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-HALF, MIN_HEIGHT, -HALF), new THREE.Vector3(HALF, 40, HALF));
    const mat = makeTerrainMaterial(detailTex);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    mesh.receiveShadow = !!quality.shadows;
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.depthTex = this.makeDepthTexture();
    return mesh;
  }

  makeDepthTexture() {
    const data = new Uint8Array(GRID * GRID);
    this.depthData = data;
    this.updateDepth(0, 0, GRID - 1, GRID - 1);
    const tex = new THREE.DataTexture(data, GRID, GRID, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  updateDepth(i0, j0, i1, j1) {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * GRID + i;
      this.depthData[k] = clamp((WATER - this.H[k]) / 6, 0, 1) * 255;
    }
  }

  // Push changed rows to the GPU.
  uploadRows(j0, j1, i0 = 0, i1 = GRID - 1) {
    if (!this.posAttr) return;
    const pos = this.posAttr.array;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * GRID + i; pos[k * 3 + 1] = this.H[k];
    }
    const start = j0 * GRID, count = (j1 - j0 + 1) * GRID;
    for (const [attr, size] of [[this.posAttr, 3], [this.nrmAttr, 3], [this.colAttr, 3], [this.visAttr, 1]]) {
      attr.addUpdateRange(start * size, count * size);
      attr.needsUpdate = true;
    }
    if (this.depthTex) this.depthTex.needsUpdate = true;
  }

  // Blast a crater. Returns {i0,j0,i1,j1}.
  crater(cx, cz, radius, depth) {
    const outer = radius * 1.4;
    const i0 = Math.max(0, Math.floor((cx - outer + HALF) / CELL)), i1 = Math.min(GRID - 1, Math.ceil((cx + outer + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - outer + HALF) / CELL)), j1 = Math.min(GRID - 1, Math.ceil((cz + outer + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * GRID + i;
      const d = Math.hypot(x - cx, z - cz) / radius;
      if (d < 1) {
        const f = (1 - d * d); this.H[k] = Math.max(MIN_HEIGHT, this.H[k] - depth * f * f);
        this.dig[k] = Math.max(this.dig[k], (1 - d) * 1.2);
        this.scorch[k] = Math.max(this.scorch[k], (1 - d * 0.85) * 0.85);
      } else if (d < 1.4) {
        const t = (d - 1) / 0.4;
        this.H[k] += depth * 0.16 * Math.sin(t * Math.PI) ;
        this.scorch[k] = Math.max(this.scorch[k], (1 - t) * 0.35);
      }
    }
    const m = 6;
    this.bakeRegion(i0 - m, j0 - m, i1 + m, j1 + m);
    this.updateDepth(Math.max(0, i0 - 1), Math.max(0, j0 - 1), Math.min(GRID - 1, i1 + 1), Math.min(GRID - 1, j1 + 1));
    this.uploadRows(Math.max(0, j0 - m), Math.min(GRID - 1, j1 + m));
    this.minimapDirty = true;
    return { i0, j0, i1, j1 };
  }

  scorchAt(cx, cz, radius, amount = 0.6) {
    const i0 = Math.max(0, Math.floor((cx - radius + HALF) / CELL)), i1 = Math.min(GRID - 1, Math.ceil((cx + radius + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - radius + HALF) / CELL)), j1 = Math.min(GRID - 1, Math.ceil((cz + radius + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * GRID + i;
      const d = Math.hypot(x - cx, z - cz) / radius;
      if (d < 1) this.scorch[k] = Math.max(this.scorch[k], (1 - d) * amount);
    }
    this.bakeRegion(i0, j0, i1, j1);
    this.uploadRows(j0, j1);
  }

  // Darken ground (baked) under trees and buildings. Call before buildMesh or follow with rebake.
  addShade(cx, cz, radius, strength, rebake = false) {
    const i0 = Math.max(0, Math.floor((cx - radius + HALF) / CELL)), i1 = Math.min(GRID - 1, Math.ceil((cx + radius + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - radius + HALF) / CELL)), j1 = Math.min(GRID - 1, Math.ceil((cz + radius + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * GRID + i;
      const d = Math.hypot(x - cx, z - cz) / radius;
      if (d < 1) this.shade[k] = Math.max(this.shade[k], strength * Math.pow(1 - d, 1.2));
    }
    if (rebake) { this.bakeRegion(i0, j0, i1, j1); this.uploadRows(j0, j1); }
  }
  clearShade(cx, cz, radius) {
    const i0 = Math.max(0, Math.floor((cx - radius + HALF) / CELL)), i1 = Math.min(GRID - 1, Math.ceil((cx + radius + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - radius + HALF) / CELL)), j1 = Math.min(GRID - 1, Math.ceil((cz + radius + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.shade[j * GRID + i] = 0;
    this.bakeRegion(i0, j0, i1, j1); this.uploadRows(j0, j1);
  }

  rebakeAll() {
    this.bakeRegion(0, 0, GRID - 1, GRID - 1);
    if (this.posAttr) this.uploadRows(0, GRID - 1);
  }

  // Colour at a point (for debris tinting).
  colorAt(x, z, out = new THREE.Color()) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, GRID - 1), j = clamp(Math.round((z + HALF) / CELL), 0, GRID - 1);
    const k = j * GRID + i;
    return out.setRGB(this.col[k * 3], this.col[k * 3 + 1], this.col[k * 3 + 2]);
  }

  // North-up minimap image (canvas).
  drawMinimap(size = 192) {
    if (!this.mini) { this.mini = document.createElement('canvas'); this.mini.width = this.mini.height = size; }
    const c = this.mini, g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const toS = (v) => Math.round(Math.pow(clamp(v, 0, 1), 1 / 2.2) * 255);
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const x = -HALF + (px + 0.5) / size * MAP_SIZE, z = -HALF + (py + 0.5) / size * MAP_SIZE;
      const i = clamp(Math.round((x + HALF) / CELL), 0, GRID - 1), j = clamp(Math.round((z + HALF) / CELL), 0, GRID - 1);
      const k = j * GRID + i, o = (py * size + px) * 4;
      const h = this.H[k];
      if (h < WATER) {
        const d = clamp(-h / 5, 0, 1);
        img.data[o] = lerp(70, 28, d); img.data[o + 1] = lerp(118, 62, d); img.data[o + 2] = lerp(130, 92, d);
      } else {
        const nx = this.nrm[k * 3], ny = this.nrm[k * 3 + 1], nz = this.nrm[k * 3 + 2];
        const shadeL = clamp(0.55 + (-nx * 0.6 - nz * 0.6 + ny * 0.5) * 0.7, 0.35, 1.25);
        img.data[o] = toS(this.col[k * 3] * shadeL * 1.25);
        img.data[o + 1] = toS(this.col[k * 3 + 1] * shadeL * 1.25);
        img.data[o + 2] = toS(this.col[k * 3 + 2] * shadeL * 1.25);
      }
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.minimapDirty = false;
    return c;
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.mesh?.material.dispose();
    this.depthTex?.dispose();
  }
}

const _n = new THREE.Vector3();
const AO_DIRS = (() => { const a = []; for (let d = 0; d < 8; d++) { const t = d / 8 * Math.PI * 2; a.push(Math.cos(t), Math.sin(t)); } return a; })();
const AO_STEPS = [1.5, 3, 5.5, 9, 14];

export function makeTerrainMaterial(detailTex) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tDetail = { value: detailTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sunVis;\nvarying float vSunVis;\nvarying vec3 vTPos;\nvarying float vNy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSunVis = sunVis;\n\tvTPos = position;\n\tvNy = normal.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tDetail;\nvarying float vSunVis;\nvarying vec3 vTPos;\nvarying float vNy;')
      .replace('#include <color_fragment>', `#include <color_fragment>
	float dFine = texture2D( tDetail, vTPos.xz * 0.31 ).r;
	float dMacro = texture2D( tDetail, vTPos.xz * 0.027 ).g;
	float dRock = texture2D( tDetail, vec2( vTPos.x + vTPos.z, vTPos.y * 1.4 ) * 0.18 ).b;
	float steep = 1.0 - smoothstep( 0.62, 0.86, vNy );
	float det = mix( dFine, dRock, steep );
	diffuseColor.rgb *= ( 0.36 + 1.05 * det ) * ( 0.82 + 0.36 * dMacro );`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= vSunVis;'));
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
  return mat;
}
