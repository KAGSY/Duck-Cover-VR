// The campaign map: a hand-drawn field map of the Pondlands, the country the Fusiliers are fighting to free.
// Paper, coastline, rivers and terrain are generated once, a few milliseconds per frame so VR never stutters.
// Each redraw then washes every region in the colour of whoever holds it and adds the front line, the line of
// advance, the flags and the names.
import { MISSIONS, FACTIONS } from './campaign.js';
import { FONT_DISPLAY, FONT_BODY } from './textures.js';

export const MAP_SIZE = 664;
const N = MAP_SIZE, G = N >> 1;
const SERIF = 'Georgia, "Times New Roman", "Noto Serif", serif';
const INK = '#4a3826';

// One region per mission plus headquarters. x, y: the site, as fractions of the map; w: relative size;
// label: name lines; ly: where the name sits below (+) or above (-) the site, in pixels.
export const REGIONS = [
  { id: 0, mission: null, name: 'Fusilier HQ', label: ['FUSILIER HQ'], x: 0.15, y: 0.805, w: 0.8, biome: 'marsh', ly: 31 },
  { id: 1, mission: 1, name: 'Boot Camp Pond', label: ['BOOT CAMP', 'POND'], x: 0.275, y: 0.775, w: 0.78, biome: 'marsh', ly: 29 },
  { id: 2, mission: 2, name: 'The Reedbeds', label: ['THE REEDBEDS'], x: 0.205, y: 0.625, w: 1, biome: 'marsh', ly: 29 },
  { id: 3, mission: 3, name: "Pollard's Mill", label: ["POLLARD'S MILL"], x: 0.37, y: 0.665, w: 1, biome: 'farm', ly: 29 },
  { id: 4, mission: 4, name: 'Heron Point', label: ['HERON POINT'], x: 0.11, y: 0.47, w: 0.95, biome: 'marsh', ly: 29 },
  { id: 5, mission: 5, name: 'Icefloe Beach', label: ['ICEFLOE', 'BEACH'], x: 0.16, y: 0.31, w: 1, biome: 'snow', ly: 29 },
  { id: 6, mission: 6, name: 'Kittiwake Hill', label: ['KITTIWAKE', 'HILL'], x: 0.345, y: 0.21, w: 1, biome: 'snow', ly: 29 },
  { id: 7, mission: 7, name: 'Skerry Pass', label: ['SKERRY PASS'], x: 0.495, y: 0.165, w: 1, biome: 'snow', ly: 29 },
  { id: 8, mission: 8, name: 'The Narrows', label: ['THE NARROWS'], x: 0.68, y: 0.25, w: 1, biome: 'snow', ly: 29 },
  { id: 9, mission: 9, name: 'Rustwater Canyons', label: ['RUSTWATER', 'CANYONS'], x: 0.825, y: 0.335, w: 1.05, biome: 'canyon', ly: 29 },
  { id: 10, mission: 10, name: 'Rustwater Ford', label: ['RUSTWATER', 'FORD'], x: 0.785, y: 0.55, w: 1, biome: 'canyon', ly: 29 },
  { id: 11, mission: 11, name: 'Red Mesa', label: ['RED MESA'], x: 0.665, y: 0.745, w: 1.05, biome: 'canyon', ly: 29 },
  { id: 12, mission: 12, name: 'The Grand Weir', label: ['THE GRAND', 'WEIR'], x: 0.465, y: 0.445, w: 1.2, biome: 'weir', ly: 29 },
];
export const regionForMission = (id) => REGIONS.find(r => r.mission === id) || REGIONS[0];

// Rivers run through these points (fractions of the map); w0/w1: width in pixels at the first and last point.
const RIVERS = [
  { name: 'Weirwater', w0: 3.6, w1: 4.6, label: 0.55, pts: [[0.53, 0.52], [0.505, 0.47], [0.515, 0.40], [0.565, 0.34], [0.62, 0.29], [0.632, 0.21], [0.615, 0.12], [0.60, 0.0]] },
  { name: 'Rustwater', w0: 1.4, w1: 3.8, label: 0.3, pts: [[0.875, 0.2], [0.865, 0.27], [0.86, 0.37], [0.835, 0.465], [0.79, 0.515], [0.735, 0.565], [0.66, 0.575]] },
  { name: 'Millbrook', w0: 1.2, w1: 3.2, label: 0.62, pts: [[0.445, 0.575], [0.425, 0.62], [0.4, 0.66], [0.355, 0.705], [0.31, 0.75], [0.285, 0.82], [0.265, 0.9], [0.255, 1.0]] },
];

const BIOME_TINT = { marsh: [190, 202, 146], farm: [228, 208, 142], snow: [240, 243, 244], canyon: [230, 170, 122], weir: [198, 210, 154] };
// Region washes: muted versions of each side's colours, laid on like watercolour.
export const OWNER_RGB = { mallard: [88, 140, 34], teal: [26, 108, 158], eider: [110, 142, 190], merganser: [204, 94, 40], muscovy: [132, 34, 70] };
export const OWNER_NAMES = { mallard: 'Mallard Fusiliers', teal: 'Teal Brigade', eider: 'Eider Arctic Corps', merganser: 'Merganser Raiders', muscovy: 'Imperial Guard' };

// ------------------------------------------------------------------ noise
function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}
function fbm(x, y, oct, seed) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f, seed + o * 31); n += a; a *= 0.5; f *= 2.07; }
  return s / n;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function segDist(u, v, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)));
  return [Math.hypot(u - ax - dx * t, v - ay - dy * t), t];
}

// Positive on land. A rounded island, ragged by noise, with land kept round every site, and three waters cut in.
function landField(u, v) {
  const du = (u - 0.5) / 0.432, dv = (v - 0.505) / 0.418;
  let L = 1 - Math.pow(Math.pow(Math.abs(du), 2.25) + Math.pow(Math.abs(dv), 2.25), 1 / 2.25);
  L += 0.2 * fbm(u * 3.2 + 2.3, v * 3.2 + 7.1, 4, 11) + 0.05 * fbm(u * 12 + 5, v * 12 + 1, 2, 23);
  for (const r of REGIONS) L += 0.45 * Math.exp(-((u - r.x) ** 2 + (v - r.y) ** 2) / 0.005);
  // the Great Pond, with a ragged shore
  const lk = (((u - 0.555) / 0.1) ** 2 + ((v - 0.575) / 0.072) ** 2) * (1 + 0.35 * fbm(u * 9 + 3, v * 9 + 8, 3, 91));
  L -= 1.5 * Math.exp(-lk * lk * 0.8);
  // Boot Camp Pond
  L -= 2.0 * Math.exp(-((u - 0.312) ** 2 + (v - 0.752) ** 2) / (0.021 * 0.021));
  // the Frozen Firth, an inlet narrowing as it runs inland
  const [fd, ft] = segDist(u, v, 0.245, 0.0, 0.262, 0.275);
  L -= 1.7 * Math.exp(-((fd / (0.05 * (1 - 0.55 * ft))) ** 2));
  return L;
}

// ------------------------------------------------------------------ the map
class CampaignMap {
  constructor() {
    this.ready = false; this.gen = null;
    this.ownerKey = null; this.ownerCanvas = null;
  }
  // Generate a slice at a time: call every frame with a budget in milliseconds until it returns true.
  work(ms = 4) {
    if (this.ready) return true;
    if (!this.gen) this.gen = this.build();
    const t0 = performance.now();
    do { if (this.gen.next().done) { this.ready = true; this.gen = null; return true; } } while (performance.now() - t0 < ms);
    return false;
  }
  ensure() { if (!this.ready) this.work(1e9); }

  // the region under a map pixel, or -1 for water
  regionAt(x, y) {
    if (!this.ready) return -1;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= N || y >= N) return -1;
    return this.rid[y * N + x];
  }
  box(id) { return this.boxes[id]; }
  site(id) { const r = REGIONS[id]; return { x: r.x * N, y: r.y * N }; }

  *build() {
    this.stage = 'coarse';
    // 1. coarse fields on a half-resolution grid: land, a warp for the borders, paper stains
    const Lg = new Float32Array(G * G), WXg = new Float32Array(G * G), WYg = new Float32Array(G * G), Bg = new Float32Array(G * G);
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const u = (i + 0.5) / G, v = (j + 0.5) / G, k = j * G + i;
        Lg[k] = landField(u, v);
        WXg[k] = fbm(u * 5 + 13.7, v * 5 + 3.3, 3, 41);
        WYg[k] = fbm(u * 5 + 7.9, v * 5 + 19.1, 3, 59);
        Bg[k] = fbm(u * 5 + 1.1, v * 5 + 9.4, 3, 77);
      }
      if (j & 1) yield;
    }
    const samp = (A, x, y) => {
      let gx = x * 0.5 - 0.25, gy = y * 0.5 - 0.25;
      let i0 = Math.floor(gx), j0 = Math.floor(gy);
      if (i0 < 0) { i0 = 0; gx = 0; } else if (i0 > G - 2) { i0 = G - 2; gx = G - 1; }
      if (j0 < 0) { j0 = 0; gy = 0; } else if (j0 > G - 2) { j0 = G - 2; gy = G - 1; }
      const fx = gx - i0, fy = gy - j0, k = j0 * G + i0;
      return (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fy) + (A[k + G] * (1 - fx) + A[k + G + 1] * fx) * fy;
    };
    this.stage = 'regions';
    // 2. full resolution: land and regions (warped, weighted nearest site)
    const NN = N * N;
    const Lf = new Float32Array(NN), blot = new Float32Array(NN), rid = new Int8Array(NN);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const k = y * N + x, L = samp(Lg, x, y);
        Lf[k] = L; blot[k] = samp(Bg, x, y);
        if (L <= 0) { rid[k] = -1; continue; }
        const u = (x + 0.5) / N + 0.032 * samp(WXg, x, y), v = (y + 0.5) / N + 0.032 * samp(WYg, x, y);
        let best = 0, bd = 1e9;
        for (let r = 0; r < REGIONS.length; r++) {
          const R = REGIONS[r], d = ((u - R.x) ** 2 + (v - R.y) ** 2) / (R.w * R.w);
          if (d < bd) { bd = d; best = r; }
        }
        rid[k] = best;
      }
      if ((y & 3) === 3) yield;
    }
    this.stage = 'flood';
    // 3. every region in one piece: flood each from its site; stranded pieces join a neighbour
    const seen = new Uint8Array(NN), queue = new Int32Array(NN);
    let qh = 0, qt = 0;
    for (const R of REGIONS) {
      const k = Math.round(R.y * N) * N + Math.round(R.x * N);
      if (Lf[k] > 0) { rid[k] = R.id; seen[k] = 1; queue[qt++] = k; }
    }
    const nb = (k, fn) => { const x = k % N; if (x > 0) fn(k - 1); if (x < N - 1) fn(k + 1); if (k >= N) fn(k - N); if (k < NN - N) fn(k + N); };
    while (qh < qt) { const k = queue[qh++], r = rid[k]; nb(k, (n) => { if (!seen[n] && rid[n] === r) { seen[n] = 1; queue[qt++] = n; } }); if ((qh & 16383) === 0) yield; }
    yield;
    qh = 0;
    while (qh < qt) { const k = queue[qh++], r = rid[k]; nb(k, (n) => { if (!seen[n] && rid[n] >= 0) { seen[n] = 1; rid[n] = r; queue[qt++] = n; } }); if ((qh & 16383) === 0) yield; }
    yield;
    this.stage = 'distances';
    // 4. distances: water to land, land to water, and to the nearest border (with who is across it)
    // two-pass chamfer distance (a generator, so it can be spread over frames)
    const chamfer = function* (D, ok = null, carry = null) {
      const S = 1.4142;
      const relax = (k, n, w) => { if (ok && !ok(k, n)) return; const d = D[n] + w; if (d < D[k]) { D[k] = d; if (carry) carry[k] = carry[n]; } };
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const k = y * N + x; if (D[k] === 0) continue;
          if (x > 0) relax(k, k - 1, 1);
          if (y > 0) { relax(k, k - N, 1); if (x > 0) relax(k, k - N - 1, S); if (x < N - 1) relax(k, k - N + 1, S); }
        }
        if ((y & 3) === 3) yield;
      }
      for (let y = N - 1; y >= 0; y--) {
        for (let x = N - 1; x >= 0; x--) {
          const k = y * N + x; if (D[k] === 0) continue;
          if (x < N - 1) relax(k, k + 1, 1);
          if (y < N - 1) { relax(k, k + N, 1); if (x < N - 1) relax(k, k + N + 1, S); if (x > 0) relax(k, k + N - 1, S); }
        }
        if ((y & 3) === 0) yield;
      }
    };
    const dWater = new Float32Array(NN), dLand = new Float32Array(NN);
    for (let k = 0; k < NN; k++) { const land = Lf[k] > 0; dWater[k] = land ? 0 : 1e6; dLand[k] = land ? 1e6 : 0; if ((k & 65535) === 65535) yield; }
    yield* chamfer(dWater);
    yield* chamfer(dLand);
    const bd = new Float32Array(NN).fill(1e6), bo = new Int8Array(NN).fill(-1);
    // border pixels (a neighbour in another region) seed the distance to the nearest border
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const k = y * N + x, r = rid[k]; if (r < 0) continue;
        const o = x > 0 && rid[k - 1] >= 0 && rid[k - 1] !== r ? rid[k - 1] : x < N - 1 && rid[k + 1] >= 0 && rid[k + 1] !== r ? rid[k + 1]
          : y > 0 && rid[k - N] >= 0 && rid[k - N] !== r ? rid[k - N] : y < N - 1 && rid[k + N] >= 0 && rid[k + N] !== r ? rid[k + N] : -1;
        if (o >= 0) { bd[k] = 0; bo[k] = o; }
      }
      if ((y & 31) === 31) yield;
    }
    yield;
    yield* chamfer(bd, (k, n) => rid[k] >= 0 && rid[k] === rid[n], bo);
    yield;
    for (let k = 0; k < NN; k++) if (bd[k] === 0 && bo[k] >= 0) bd[k] = 0.5;
    yield;
    this.rid = rid; this.Lf = Lf; this.bd = bd; this.bo = bo; this.blot = blot;
    this.stage = 'boxes';
    // bounding boxes, for hit areas and highlights
    const boxes = REGIONS.map(() => ({ x0: N, y0: N, x1: -1, y1: -1 }));
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const r = rid[y * N + x]; if (r < 0) continue;
        const b = boxes[r]; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      }
      if ((y & 63) === 63) yield;
    }
    this.boxes = boxes.map(b => ({ x: b.x0, y: b.y0, w: Math.max(1, b.x1 - b.x0 + 1), h: Math.max(1, b.y1 - b.y0 + 1) }));
    // each region's middle (for the CAPTURED stamp)
    const cs = REGIONS.map(() => ({ x: 0, y: 0, n: 0 }));
    for (let y = 0; y < N; y += 2) for (let x = 0; x < N; x += 2) { const r = rid[y * N + x]; if (r >= 0) { cs[r].x += x; cs[r].y += y; cs[r].n++; } }
    this.centres = cs.map((c, i) => c.n ? { x: c.x / c.n, y: c.y / c.n } : this.site(i));
    yield;
    this.stage = 'paper';
    // 5. the paper: stains, aged edges, sea wash with ripple lines along the coast, land tint, borders, coast ink
    const base = document.createElement('canvas'); base.width = N; base.height = N;
    const g = base.getContext('2d');
    const img = g.createImageData(N, N), D = img.data;
    const band = (d, c, w) => Math.max(0, 1 - Math.abs(d - c) / w);
    const tints = REGIONS.map(r => BIOME_TINT[r.biome]);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const k = y * N + x, i4 = k * 4, b = blot[k];
        const grain = (hash(x, y, 5) - 0.5) * 10;
        let r = 235 + b * 14 + grain, gg = 222 + b * 13 + grain, bb = 186 + b * 10 + grain;
        const land = Lf[k] > 0;
        if (!land) {
          const dw = dWater[k];
          const m = 0.44 + Math.min(0.12, dw / 260);
          r += (118 - r) * m; gg += (154 - gg) * m; bb += (158 - bb) * m;
          const rip = band(dw, 4.2, 0.8) * 0.55 + band(dw, 9.5, 0.75) * 0.34 + band(dw, 16, 0.7) * 0.2;
          r += (58 - r) * rip; gg += (88 - gg) * rip; bb += (98 - bb) * rip;
        } else {
          const t = tints[rid[k]] || BIOME_TINT.weir;
          r += (t[0] - r) * 0.24; gg += (t[1] - gg) * 0.24; bb += (t[2] - bb) * 0.24;
          const dl = dLand[k];
          if (dl < 6) { const f = 1 - (1 - dl / 6) * 0.07; r *= f; gg *= f; bb *= f; }
          // borders between regions: dashed ink
          if (bd[k] < 0.9 && (((x >> 2) + (y >> 2)) & 1)) { r += (96 - r) * 0.55; gg += (76 - gg) * 0.55; bb += (54 - bb) * 0.55; }
        }
        // coastline ink, anti-aliased from the land field
        const xm = x > 0 ? k - 1 : k, xp = x < N - 1 ? k + 1 : k, ym = y > 0 ? k - N : k, yp = y < N - 1 ? k + N : k;
        const gl = Math.hypot((Lf[xp] - Lf[xm]) * 0.5, (Lf[yp] - Lf[ym]) * 0.5) + 1e-6;
        const ink = Math.max(0, Math.min(1, 1.35 - Math.abs(Lf[k]) / gl));
        if (ink > 0) { const a = ink * 0.9; r += (66 - r) * a; gg += (50 - gg) * a; bb += (36 - bb) * a; }
        // aged, darker edges and the creases where the map was folded
        const e = Math.min(x, y, N - 1 - x, N - 1 - y);
        if (e < 64) { const a = (1 - e / 64) ** 2; r -= a * 40; gg -= a * 50; bb -= a * 60; }
        if (x === N >> 1 || y === N >> 1) { r += 9; gg += 9; bb += 9; } else if (x === (N >> 1) + 1 || y === (N >> 1) + 1) { r -= 11; gg -= 11; bb -= 11; }
        D[i4] = r; D[i4 + 1] = gg; D[i4 + 2] = bb; D[i4 + 3] = 255;
      }
      if ((y & 7) === 7) yield;
    }
    this.stage = 'put';
    g.putImageData(img, 0, 0);
    yield;
    this.stage = 'rivers';
    // 6. ink work: rivers, terrain, landmarks, sea, and the map furniture
    const R = rng(1234);
    const riverPts = this.drawRivers(g, Lf);
    yield;
    this.stage = 'symbols';
    const keepClear = this.clearZones();
    const nearRiver = (x, y, d) => riverPts.some(p => Math.abs(p[0] - x) < d && Math.abs(p[1] - y) < d && Math.hypot(p[0] - x, p[1] - y) < d);
    const clear = (x, y) => !keepClear.some(z => x > z.x && x < z.x + z.w && y > z.y && y < z.y + z.h);
    this.drawLandmarks(g, riverPts);
    const spacing = { marsh: 21, farm: 25, snow: 25, canyon: 31, weir: 30 };
    for (const reg of REGIONS) {
      const b = this.boxes[reg.id], s = spacing[reg.biome], sx = reg.x * N, sy = reg.y * N;
      for (let y = b.y + s / 2; y < b.y + b.h; y += s) for (let x = b.x + s / 2; x < b.x + b.w; x += s) {
        const px = x + (R() - 0.5) * s * 0.8, py = y + (R() - 0.5) * s * 0.8, k = Math.floor(py) * N + Math.floor(px);
        if (k < 0 || k >= NN || rid[k] !== reg.id || dLand[k] < 8 || bd[k] < 5) continue;
        if (Math.hypot(px - sx, py - sy) < 30 || nearRiver(px, py, 10) || !clear(px, py)) continue;
        this.symbol(g, reg.biome, px, py, R);
      }
      yield;
    }
    this.stage = 'sea';
    yield* this.drawSea(g, dWater, Lf, R);
    yield;
    this.stage = 'furniture';
    yield* this.drawFurniture(g);
    this.base = base;
    this.Lf = null; // only the region map and border distances are needed from here on
    yield;
    this.stage = 'highlights';
    // 7. highlight overlays, one per region, for hover and selection
    this.hi = [];
    for (let id = 0; id < REGIONS.length; id++) {
      const b = this.boxes[id];
      const c = document.createElement('canvas'); c.width = b.w; c.height = b.h;
      const cg = c.getContext('2d'), im = cg.createImageData(b.w, b.h), d = im.data;
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const k = (b.y + y) * N + (b.x + x); if (rid[k] !== id) continue;
        const i4 = (y * b.w + x) * 4;
        if (bd[k] < 2.2) { d[i4] = 255; d[i4 + 1] = 210; d[i4 + 2] = 60; d[i4 + 3] = 245; }
        else { d[i4] = 255; d[i4 + 1] = 246; d[i4 + 2] = 214; d[i4 + 3] = 54; }
      }
      cg.putImageData(im, 0, 0);
      this.hi.push(c);
      yield;
    }
  }

  // Areas the scattered terrain keeps clear of: map furniture and each region's name.
  clearZones() {
    const z = [
      { x: 0, y: 0, w: 232, h: 76 }, { x: N - 108, y: 0, w: 108, h: 108 },
      { x: N - 212, y: N - 124, w: 212, h: 124 }, { x: 0, y: N - 46, w: 170, h: 46 },
    ];
    for (const r of REGIONS) {
      const w = Math.max(...r.label.map(l => l.length)) * 9 + 14, h = r.label.length * 14 + 8;
      z.push({ x: r.x * N - w / 2, y: r.y * N + r.ly - 14, w, h });
    }
    return z;
  }

  drawRivers(g, Lf) {
    const all = [];
    RIVERS.forEach((rv, ri) => {
      // Catmull-Rom through the points, sampled every couple of pixels, with a gentle meander
      const P = rv.pts.map(([u, v]) => [u * N, v * N]), out = [];
      for (let i = 0; i < P.length - 1; i++) {
        const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
        const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), steps = Math.max(2, Math.ceil(len / 2));
        for (let s = 0; s < steps; s++) {
          const t = s / steps, t2 = t * t, t3 = t2 * t;
          const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
          out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
        }
      }
      out.push(P[P.length - 1]);
      let acc = 0;
      for (let i = 0; i < out.length; i++) {
        const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        if (i) acc += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
        const m = vnoise(acc * 0.07, ri * 10, 7) * 2.6;
        out[i] = [out[i][0] - dy / l * m, out[i][1] + dx / l * m, i / (out.length - 1)];
      }
      const onLand = (p) => { const x = Math.round(p[0]), y = Math.round(p[1]); return x >= 0 && y >= 0 && x < N && y < N && Lf[y * N + x] > -0.02; };
      g.lineCap = 'round'; g.lineJoin = 'round';
      // stroke runs of equal width as single paths: the bank first, then the water
      for (const pass of [0, 1]) {
        g.strokeStyle = pass ? '#86a8ad' : 'rgba(58,84,94,0.85)';
        let run = null, runW = -1;
        const flush = () => { if (run && run.length > 1) { g.lineWidth = pass ? runW : runW + 2.2; g.beginPath(); g.moveTo(run[0][0], run[0][1]); for (let k = 1; k < run.length; k++) g.lineTo(run[k][0], run[k][1]); g.stroke(); } run = null; };
        for (let i = 1; i < out.length; i++) {
          const a = out[i - 1], b = out[i];
          if (!onLand(a) || !onLand(b)) { flush(); continue; }
          const w = Math.round((rv.w0 + (rv.w1 - rv.w0) * b[2]) * 2) / 2;
          if (!run || w !== runW) { flush(); run = [a]; runW = w; }
          run.push(b);
        }
        flush();
      }
      // its name, set along the stream
      const i = Math.floor(out.length * rv.label), a = out[Math.max(0, i - 6)], b = out[Math.min(out.length - 1, i + 6)];
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      g.save(); g.translate(out[i][0], out[i][1]); g.rotate(ang); g.translate(0, -9);
      g.font = `italic 11px ${SERIF}`; g.textAlign = 'center'; g.fillStyle = 'rgba(48,72,82,0.95)';
      spaced(g, rv.name, 0, 0, 1.2);
      g.restore();
      for (const p of out) all.push(p);
    });
    return all;
  }

  symbol(g, biome, x, y, R) {
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 1.1; g.strokeStyle = 'rgba(74,56,38,0.72)';
    if (biome === 'marsh') {
      if (R() < 0.18) { // a pool
        g.fillStyle = 'rgba(110,150,154,0.55)'; g.beginPath(); g.ellipse(x, y, 5 + R() * 3, 2.2 + R(), 0, 0, Math.PI * 2); g.fill(); g.stroke();
      } else { // reeds
        g.strokeStyle = 'rgba(70,82,40,0.8)';
        g.beginPath();
        for (let k = -1; k <= 1; k++) { g.moveTo(x + k * 1.5, y); g.quadraticCurveTo(x + k * 2.2, y - 4, x + k * 3.4 + (R() - 0.5), y - 6.5 - R() * 3); }
        g.moveTo(x - 4.5, y + 1.2); g.lineTo(x + 4.5, y + 1.2);
        g.stroke();
      }
    } else if (biome === 'farm') {
      if (R() < 0.22) { // a hedgerow tree
        g.fillStyle = 'rgba(92,112,58,0.75)'; g.beginPath(); g.arc(x, y - 4, 3.4, 0, Math.PI * 2); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(x, y - 0.6); g.lineTo(x, y + 2); g.stroke();
      } else { // a field with crop rows
        const w = 13 + R() * 6, h = 8 + R() * 3;
        g.translate(x, y); g.rotate((R() - 0.5) * 0.8);
        g.fillStyle = R() < 0.5 ? 'rgba(206,182,96,0.45)' : 'rgba(150,170,86,0.4)';
        g.fillRect(-w / 2, -h / 2, w, h); g.strokeRect(-w / 2, -h / 2, w, h);
        g.lineWidth = 0.8; g.beginPath();
        for (let k = 1; k < 4; k++) { const yy = -h / 2 + k * h / 4; g.moveTo(-w / 2 + 1, yy); g.lineTo(w / 2 - 1, yy); }
        g.stroke();
      }
    } else if (biome === 'snow') {
      if (R() < 0.25) { // pines
        g.fillStyle = 'rgba(52,78,62,0.8)';
        for (let k = 0; k < 2; k++) { const px = x + k * 5 - 2; g.beginPath(); g.moveTo(px, y - 9); g.lineTo(px + 3.4, y); g.lineTo(px - 3.4, y); g.closePath(); g.fill(); }
      } else { // a mountain with a snow cap and a shaded face
        const w = 13 + R() * 8, h = 10 + R() * 8, px = x + (R() - 0.5) * 3;
        g.fillStyle = 'rgba(70,82,104,0.25)';
        g.beginPath(); g.moveTo(px, y - h); g.lineTo(x + w / 2, y); g.lineTo(px + 1, y); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.95)';
        g.beginPath(); g.moveTo(px, y - h); g.lineTo(px + w * 0.17, y - h * 0.66); g.lineTo(px + w * 0.03, y - h * 0.72); g.lineTo(px - w * 0.12, y - h * 0.6); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(60,62,72,0.8)';
        g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(px, y - h); g.lineTo(x + w / 2, y); g.stroke();
      }
    } else if (biome === 'canyon') {
      if (R() < 0.3) { // a crack in the rock
        g.strokeStyle = 'rgba(120,52,24,0.65)';
        g.beginPath(); let cx = x - 7, cy = y; g.moveTo(cx, cy);
        for (let k = 0; k < 4; k++) { cx += 3.5 + R() * 1.5; cy += (R() - 0.5) * 5; g.lineTo(cx, cy); }
        g.stroke();
      } else { // a mesa
        const w = 14 + R() * 8, h = 6 + R() * 4, top = w * (0.5 + R() * 0.2);
        g.fillStyle = 'rgba(176,86,40,0.32)'; g.strokeStyle = 'rgba(112,50,24,0.8)';
        g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x - top / 2, y - h); g.lineTo(x + top / 2, y - h); g.lineTo(x + w / 2, y); g.closePath(); g.fill(); g.stroke();
        g.lineWidth = 0.8; g.beginPath();
        for (let k = 1; k < 4; k++) { const xx = x - top / 2 + top * k / 4; g.moveTo(xx, y - h + 1); g.lineTo(xx + (k - 2) * 0.8, y - h * (0.3 + R() * 0.3)); }
        g.stroke();
      }
    } else { // central meadows: tufts and the odd tree
      if (R() < 0.3) {
        g.fillStyle = 'rgba(88,112,56,0.72)'; g.beginPath(); g.arc(x, y - 4, 3.6, 0, Math.PI * 2); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(x, y - 0.4); g.lineTo(x, y + 2.2); g.stroke();
      } else {
        g.strokeStyle = 'rgba(78,96,44,0.7)'; g.beginPath();
        g.moveTo(x - 3, y - 3); g.lineTo(x - 1, y); g.lineTo(x + 1, y - 4); g.moveTo(x + 2, y - 2.5); g.lineTo(x + 3.2, y);
        g.stroke();
      }
    }
    g.restore();
  }

  // Each region's landmark, drawn beside its site.
  drawLandmarks(g, riverPts) {
    const at = (id, dx, dy) => [REGIONS[id].x * N + dx, REGIONS[id].y * N + dy];
    const nearestRiver = (x, y) => riverPts.reduce((b, p) => { const d = Math.hypot(p[0] - x, p[1] - y); return d < b.d ? { d, p } : b; }, { d: 1e9, p: null }).p;
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(66,50,34,0.9)'; g.lineWidth = 1.2;
    // Pollard's Mill: a windmill
    { const [x, y] = at(3, 25, -14);
      g.fillStyle = 'rgba(236,224,190,1)'; g.beginPath(); g.moveTo(x - 4, y + 8); g.lineTo(x - 2.5, y - 4); g.lineTo(x + 2.5, y - 4); g.lineTo(x + 4, y + 8); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; g.moveTo(x, y - 4); g.lineTo(x + Math.cos(a) * 9, y - 4 + Math.sin(a) * 9); } g.stroke(); }
    // Heron Point: a lighthouse
    { const [x, y] = at(4, -6, -24);
      g.fillStyle = '#f2ead2'; g.beginPath(); g.moveTo(x - 3.2, y + 9); g.lineTo(x - 2, y - 5); g.lineTo(x + 2, y - 5); g.lineTo(x + 3.2, y + 9); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#b4332a'; g.fillRect(x - 2.6, y + 1, 5.2, 2.4);
      g.fillStyle = '#f2c230'; g.beginPath(); g.arc(x, y - 7, 2.4, 0, Math.PI * 2); g.fill(); g.stroke(); }
    // Kittiwake Hill: the radar dish
    { const [x, y] = at(6, 24, -12);
      g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x, y - 1); g.stroke();
      g.fillStyle = '#e8e2d0'; g.beginPath(); g.ellipse(x, y - 3, 6, 3, -0.6, 0, Math.PI * 2); g.fill(); g.stroke(); }
    // Skerry Pass: the road winding through the peaks
    { const [x, y] = at(7, -30, -2);
      g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x - 18, y + 10); g.quadraticCurveTo(x - 4, y - 8, x + 4, y + 2); g.quadraticCurveTo(x + 10, y + 9, x + 16, y - 2); g.stroke(); g.setLineDash([]); }
    // The Narrows: a fort astride the river
    { const [x, y] = at(8, -26, 4);
      g.fillStyle = '#d9d2bf'; g.fillRect(x - 8, y - 6, 16, 10); g.strokeRect(x - 8, y - 6, 16, 10);
      g.beginPath(); for (let k = 0; k < 4; k++) { g.rect(x - 8 + k * 4.6, y - 9, 2.4, 3); } g.fill(); g.stroke(); }
    // Rustwater Ford: a track across the water
    { const [sx, sy] = at(10, 0, 0), p = nearestRiver(sx - 18, sy + 2);
      if (p) { g.setLineDash([3, 2.5]); g.beginPath(); g.moveTo(p[0] - 10, p[1] - 8); g.lineTo(p[0] + 10, p[1] + 8); g.stroke(); g.setLineDash([]); } }
    // Red Mesa: the great mesa
    { const [x, y] = at(11, 28, -4);
      g.fillStyle = 'rgba(178,76,36,0.55)'; g.strokeStyle = 'rgba(100,40,20,0.9)';
      g.beginPath(); g.moveTo(x - 16, y + 6); g.lineTo(x - 9, y - 7); g.lineTo(x + 9, y - 7); g.lineTo(x + 16, y + 6); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); for (let k = -2; k <= 2; k++) { g.moveTo(x + k * 3.6, y - 6); g.lineTo(x + k * 4.2, y + 1); } g.stroke(); }
    // The Grand Weir: the weir across the river and the Grand Duke's palace
    { const [sx, sy] = at(12, 0, 0), p = nearestRiver(sx + 16, sy + 4);
      g.strokeStyle = 'rgba(66,50,34,0.95)';
      if (p) { g.lineWidth = 2.4; g.beginPath(); g.moveTo(p[0] - 7, p[1] - 1); g.lineTo(p[0] + 7, p[1] + 1); g.stroke(); g.lineWidth = 1.2; }
      const x = sx - 30, y = sy - 10;
      g.fillStyle = '#e6dcc0'; g.fillRect(x - 10, y - 4, 20, 10); g.strokeRect(x - 10, y - 4, 20, 10);
      g.fillStyle = '#8a2a44';
      for (const ox of [-10, 10]) { g.beginPath(); g.moveTo(x + ox - 3, y - 4); g.lineTo(x + ox, y - 11); g.lineTo(x + ox + 3, y - 4); g.closePath(); g.fill(); g.stroke(); }
      g.beginPath(); g.moveTo(x - 4, y - 4); g.lineTo(x, y - 14); g.lineTo(x + 4, y - 4); g.closePath(); g.fill(); g.stroke(); }
    g.restore();
  }

  *drawSea(g, dWater, Lf, R) {
    const furniture = this.clearZones().slice(0, 4);
    const free = (x, y, d) => { const k = Math.floor(y) * N + Math.floor(x); return x > 14 && y > 14 && x < N - 14 && y < N - 14 && Lf[k] <= 0 && dWater[k] > d && !furniture.some(z => x > z.x - 6 && x < z.x + z.w + 6 && y > z.y - 6 && y < z.y + z.h + 6); };
    g.save(); g.lineCap = 'round';
    yield;
    // wave marks out at sea
    g.strokeStyle = 'rgba(52,80,90,0.5)'; g.lineWidth = 1;
    let placed = 0;
    for (let t = 0; t < 900 && placed < 46; t++) {
      const x = 20 + R() * (N - 40), y = 20 + R() * (N - 40);
      if (!free(x, y, 22)) continue;
      g.beginPath(); g.moveTo(x - 6, y); g.quadraticCurveTo(x - 3, y - 3, x, y); g.quadraticCurveTo(x + 3, y - 3, x + 6, y); g.stroke();
      placed++;
    }
    yield;
    // ice in the north
    g.fillStyle = 'rgba(250,252,252,0.95)'; g.strokeStyle = 'rgba(70,96,110,0.8)';
    placed = 0;
    for (let t = 0; t < 1200 && placed < 22; t++) {
      const x = 20 + R() * (N - 40), y = 14 + R() * N * 0.3;
      const k = Math.floor(y) * N + Math.floor(x);
      if (Lf[k] > 0 || dWater[k] < 3 || dWater[k] > 26 || !free(x, y, 3)) continue;
      const r = 2.5 + R() * 4;
      g.beginPath();
      for (let s = 0; s < 6; s++) { const a = s / 6 * Math.PI * 2 + R() * 0.5, rr = r * (0.6 + R() * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7); }
      g.closePath(); g.fill(); g.stroke();
      placed++;
    }
    // a Fusilier supply ship off the south-west coast, and a raider sloop in the east
    for (const [u, v, col] of [[0.06, 0.93, '#e2c044'], [0.965, 0.66, '#e8a23a']]) {
      const x = u * N, y = v * N;
      if (!free(x, y, 6)) continue;
      g.strokeStyle = 'rgba(66,50,34,0.95)'; g.lineWidth = 1.1;
      g.fillStyle = '#7a5a3a'; g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.lineTo(x + 6, y + 4); g.lineTo(x - 6, y + 4); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#f4ecd6'; g.beginPath(); g.moveTo(x - 1, y - 1); g.lineTo(x - 1, y - 14); g.lineTo(x + 7, y - 2); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = col; g.fillRect(x - 1, y - 18, 5, 3);
    }
    g.restore();
    yield;
    // water names
    g.save();
    g.fillStyle = 'rgba(40,66,76,0.9)'; g.textAlign = 'center';
    for (const [text, u, v, rot, size, sp] of [
      ['NORTHERN SEA', 0.6, 0.05, 0, 15, 3], ['The Great Pond', 0.555, 0.58, 0, 13, 1.4], ['FROZEN FIRTH', 0.252, 0.195, Math.PI / 2 - 0.05, 11, 1.8],
      ['WESTERN APPROACHES', 0.035, 0.6, -Math.PI / 2, 13, 2.4], ['GULL SOUND', 0.968, 0.45, Math.PI / 2, 13, 2.4],
    ]) {
      g.save(); g.translate(N * u, N * v); g.rotate(rot); g.font = `italic ${size}px ${SERIF}`;
      spaced(g, text, 0, rot ? 4 : 0, sp);
      g.restore();
      yield;
    }
    g.restore();
  }

  *drawFurniture(g) {
    g.save();
    // title cartouche, top left
    { const x = 12, y = 12, w = 214, h = 58;
      g.fillStyle = 'rgba(244,234,206,0.97)'; g.strokeStyle = INK; g.lineWidth = 2;
      g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h); g.lineWidth = 0.8; g.strokeRect(x + 4, y + 4, w - 8, h - 8);
      g.fillStyle = INK; g.textAlign = 'center';
      g.font = `700 21px ${FONT_DISPLAY}`; spaced(g, 'THE PONDLANDS', x + w / 2, y + 31, 0.8);
      g.font = `italic 11px ${SERIF}`; spaced(g, 'Field map · 1st Mallard Fusiliers', x + w / 2, y + 48, 0.3); }
    // compass rose, top right
    { const cx = N - 54, cy = 58, r = 32;
      g.strokeStyle = INK; g.lineWidth = 1; g.fillStyle = 'rgba(244,234,206,0.6)';
      g.beginPath(); g.arc(cx, cy, r * 0.62, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.arc(cx, cy, r * 0.56, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4 - Math.PI / 2, long = k % 2 === 0, L = long ? r : r * 0.55, wdt = long ? 6 : 4;
        const tx = cx + Math.cos(a) * L, ty = cy + Math.sin(a) * L;
        const lx = cx + Math.cos(a - Math.PI / 2) * wdt, ly = cy + Math.sin(a - Math.PI / 2) * wdt;
        const rx = cx + Math.cos(a + Math.PI / 2) * wdt, ry = cy + Math.sin(a + Math.PI / 2) * wdt;
        g.fillStyle = INK; g.beginPath(); g.moveTo(cx, cy); g.lineTo(lx, ly); g.lineTo(tx, ty); g.closePath(); g.fill();
        g.fillStyle = '#f4ead0'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(rx, ry); g.lineTo(tx, ty); g.closePath(); g.fill(); g.stroke();
      }
      g.fillStyle = INK; g.font = `700 14px ${FONT_DISPLAY}`; g.textAlign = 'center'; g.fillText('N', cx, cy - r - 5); }
    yield;
    // key, bottom right
    { const w = 204, h = 112, x = N - w - 12, y = N - h - 12;
      g.fillStyle = 'rgba(244,234,206,0.95)'; g.strokeStyle = INK; g.lineWidth = 1.6;
      g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
      g.fillStyle = INK; g.textAlign = 'left'; g.font = `700 13px ${FONT_DISPLAY}`; spaced(g, 'KEY', x + 10, y + 18, 2);
      const items = [['mallard', 'Fusiliers'], ['teal', 'Teal Brigade'], ['eider', 'Eider Corps'], ['merganser', 'Raiders'], ['muscovy', 'Imperial Guard'], [null, 'Unclaimed']];
      g.font = `11.5px ${FONT_BODY}`;
      items.forEach(([o, label], i) => {
        const ix = x + 10 + (i % 2) * 96, iy = y + 26 + Math.floor(i / 2) * 18;
        const c = o ? OWNER_RGB[o] : [236, 226, 196];
        g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${o ? 0.55 : 1})`; g.fillRect(ix, iy, 16, 11);
        g.strokeStyle = INK; g.lineWidth = 0.8; g.strokeRect(ix, iy, 16, 11);
        g.fillStyle = INK; g.fillText(label, ix + 21, iy + 10);
      });
      const ly = y + 88;
      g.strokeStyle = '#a82a1e'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 10, ly + 6); g.lineTo(x + 26, ly + 6); g.stroke();
      g.fillStyle = INK; g.fillText('Front line', x + 31, ly + 10);
      g.strokeStyle = '#c0301f'; g.lineWidth = 2.6; g.setLineDash([5, 3]); g.beginPath(); g.moveTo(x + 102, ly + 6); g.lineTo(x + 118, ly + 6); g.stroke(); g.setLineDash([]);
      g.fillText('Advance', x + 123, ly + 10); }
    yield;
    // scale bar, bottom left
    { const x = 18, y = N - 26;
      for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? '#f4ead0' : INK; g.fillRect(x + k * 26, y, 26, 5); }
      g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(x, y, 104, 5);
      g.fillStyle = INK; g.font = `11px ${FONT_BODY}`; g.textAlign = 'center';
      ['0', '5', '10', '15', '20'].forEach((t, k) => g.fillText(t, x + k * 26, y - 3));
      g.textAlign = 'left'; g.fillText('miles', x + 112, y + 6); }
    // neat line round the edge
    g.strokeStyle = INK; g.lineWidth = 3; g.strokeRect(1.5, 1.5, N - 3, N - 3);
    g.lineWidth = 1; g.strokeRect(6.5, 6.5, N - 13, N - 13);
    g.restore();
  }

  // Washes for who holds what. Rebuilt only when ownership changes.
  ownerLayer(owners) {
    const key = owners.join(',');
    if (key === this.ownerKey) return this.ownerCanvas;
    if (!this.ownerCanvas) { this.ownerCanvas = document.createElement('canvas'); this.ownerCanvas.width = N; this.ownerCanvas.height = N; }
    const g = this.ownerCanvas.getContext('2d'), img = g.createImageData(N, N), D = img.data;
    const { rid, bd, bo, blot } = this;
    const mine = owners.map(o => o === 'mallard');
    for (let k = 0, n = N * N; k < n; k++) {
      const r = rid[k]; if (r < 0) continue;
      const i4 = k * 4;
      const near = bd[k], other = bo[k];
      // the front line: where Fusilier ground meets anyone else's
      if (near < 1.6 && other >= 0 && mine[r] !== mine[other]) { D[i4] = 168; D[i4 + 1] = 40; D[i4 + 2] = 28; D[i4 + 3] = 240; continue; }
      const o = owners[r]; if (!o) continue;
      const c = OWNER_RGB[o];
      const a = 0.27 + 0.34 * Math.max(0, 1 - near / 6) + blot[k] * 0.06;
      D[i4] = c[0]; D[i4 + 1] = c[1]; D[i4 + 2] = c[2]; D[i4 + 3] = Math.max(0, Math.min(255, a * 255));
    }
    g.putImageData(img, 0, 0);
    this.ownerKey = key;
    return this.ownerCanvas;
  }

  // Draw the whole map at (ox, oy). view: { owners, states, flawless, hover, sel, captured, finished }
  draw(g, ox, oy, view) {
    this.ensure();
    const { owners, states, flawless = [], hover = -1, sel = -1, captured = null, finished = false } = view;
    g.save();
    g.drawImage(this.base, ox, oy);
    g.drawImage(this.ownerLayer(owners), ox, oy);
    if (hover >= 0 && hover !== sel) { const b = this.boxes[hover]; g.globalAlpha = 0.65; g.drawImage(this.hi[hover], ox + b.x, oy + b.y); g.globalAlpha = 1; }
    if (sel >= 0) { const b = this.boxes[sel]; g.drawImage(this.hi[sel], ox + b.x, oy + b.y); }
    g.translate(ox, oy);
    this.drawRoute(g, states);
    this.drawNames(g, states, hover, sel);
    this.drawSites(g, owners, states, flawless, hover, sel);
    if (captured != null && !finished) this.stamp(g, captured);
    if (finished) {
      g.save(); g.translate(N / 2, N * 0.55); g.rotate(-0.22);
      g.globalAlpha = 0.82; g.strokeStyle = '#a82a1e'; g.fillStyle = '#a82a1e'; g.lineWidth = 4;
      g.strokeRect(-190, -40, 380, 80); g.lineWidth = 1.5; g.strokeRect(-182, -32, 364, 64);
      g.font = `700 52px ${FONT_DISPLAY}`; g.textAlign = 'center'; spaced(g, 'LIBERATED', 0, 18, 6);
      g.restore();
    }
    g.restore();
  }

  drawRoute(g, states) {
    g.save(); g.lineCap = 'round';
    let prev = this.site(0);
    for (let id = 1; id < REGIONS.length; id++) {
      const s = this.site(id), st = states[id];
      const dx = s.x - prev.x, dy = s.y - prev.y, len = Math.hypot(dx, dy);
      // a gentle bow, always to the same hand, like a pencilled line of march
      const cx = (prev.x + s.x) / 2 - dy * 0.14, cy = (prev.y + s.y) / 2 + dx * 0.14;
      // stop short of both markers
      const t0 = Math.min(0.45, 17 / len), t1 = Math.max(0.55, 1 - 19 / len);
      const q = (t) => [(1 - t) * (1 - t) * prev.x + 2 * (1 - t) * t * cx + t * t * s.x, (1 - t) * (1 - t) * prev.y + 2 * (1 - t) * t * cy + t * t * s.y];
      if (st === 'won') { g.strokeStyle = 'rgba(122,36,24,0.9)'; g.lineWidth = 2.4; g.setLineDash([]); }
      else if (st === 'next') { g.strokeStyle = '#c0301f'; g.lineWidth = 3; g.setLineDash([7, 5]); }
      else { g.strokeStyle = 'rgba(74,56,38,0.45)'; g.lineWidth = 1.6; g.setLineDash([2, 5]); }
      g.beginPath();
      for (let k = 0; k <= 24; k++) { const p = q(t0 + (t1 - t0) * k / 24); if (k) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }
      g.stroke();
      if (st !== 'locked') { // arrowhead
        const a = q(t1 - 0.04), b = q(t1), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        g.setLineDash([]); g.fillStyle = g.strokeStyle;
        g.beginPath(); g.moveTo(b[0] + Math.cos(ang) * 4, b[1] + Math.sin(ang) * 4);
        g.lineTo(b[0] + Math.cos(ang + 2.5) * 8, b[1] + Math.sin(ang + 2.5) * 8); g.lineTo(b[0] + Math.cos(ang - 2.5) * 8, b[1] + Math.sin(ang - 2.5) * 8);
        g.closePath(); g.fill();
      }
      prev = s;
    }
    g.restore();
  }

  drawNames(g, states, hover, sel) {
    g.save(); g.textAlign = 'center'; g.lineJoin = 'round';
    for (const r of REGIONS) {
      const x = r.x * N, y = r.y * N + r.ly, lit = r.id === hover || r.id === sel;
      g.font = `700 ${lit ? 13 : 12}px ${FONT_DISPLAY}`;
      r.label.forEach((line, i) => {
        const yy = y + i * 13;
        g.strokeStyle = 'rgba(244,234,206,0.9)'; g.lineWidth = 3.5; spaced(g, line, x, yy, 1.2, true);
        g.fillStyle = lit ? '#1e140a' : states[r.id] === 'locked' ? 'rgba(60,45,30,0.8)' : INK; spaced(g, line, x, yy, 1.2);
      });
    }
    g.restore();
  }

  drawSites(g, owners, states, flawless, hover, sel) {
    g.save(); g.textAlign = 'center';
    for (const r of REGIONS) {
      const { x, y } = this.site(r.id), st = states[r.id], lit = r.id === hover || r.id === sel;
      if (r.id === 0) { // headquarters: a tent under the Fusilier colours
        g.fillStyle = '#7a8a46'; g.strokeStyle = INK; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x - 13, y + 8); g.lineTo(x, y - 9); g.lineTo(x + 13, y + 8); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#3f4a22'; g.beginPath(); g.moveTo(x - 3, y + 8); g.lineTo(x, y + 1); g.lineTo(x + 3, y + 8); g.closePath(); g.fill();
        flag(g, x + 4, y - 9, FACTIONS.mallard.flag, 1.1);
        if (lit) { g.strokeStyle = '#f2c230'; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 19, 0, Math.PI * 2); g.stroke(); }
        continue;
      }
      const m = MISSIONS[r.mission - 1];
      if (st === 'next') { // the objective: a red target ring
        g.strokeStyle = 'rgba(192,48,31,0.95)'; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 23, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 2; g.beginPath();
        for (const [a, b] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { g.moveTo(x + a * 15, y + b * 15); g.lineTo(x + a * 27, y + b * 27); }
        g.stroke();
      }
      // the flag of whoever holds it
      const holder = owners[r.id];
      if (holder) flag(g, x + 7, y - 13, FACTIONS[holder].flag, 1);
      if (m.enemies?.some(e => e.commander) && st !== 'won') crown(g, x + 15, y - 30);
      // numbered badge
      g.fillStyle = st === 'won' ? '#4d7a2c' : st === 'next' ? '#f2c230' : '#9a8b70';
      g.strokeStyle = lit ? '#fff3c0' : '#2c2014'; g.lineWidth = lit ? 3 : 2;
      g.beginPath(); g.arc(x, y, lit ? 14 : 12.5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = st === 'next' ? '#2a1f10' : '#fbf4de';
      g.font = `700 ${m.id >= 10 ? 13 : 15}px ${FONT_DISPLAY}`; g.fillText(String(m.id), x, y + 5);
      if (flawless.includes(r.id)) star(g, x + 12, y + 11, 6.5, '#f2c230'); // every duck came home
    }
    g.restore();
  }

  // A rubber stamp beside the region just taken, placed where it hides the fewest names and markers.
  stamp(g, missionId) {
    const r = regionForMission(missionId), sx = r.x * N, sy = r.y * N, c = this.centres[r.id];
    const busy = this.clearZones().slice(4).concat(REGIONS.map(q => ({ x: q.x * N - 22, y: q.y * N - 34, w: 44, h: 50 })));
    const cands = [[c.x, c.y], [sx, sy - 50], [sx + 78, sy - 8], [sx - 78, sy - 8], [sx + 70, sy + 34], [sx - 70, sy + 34], [sx, sy + 70]];
    let best = cands[0], bestS = 1e9;
    for (const [x, y] of cands) {
      if (x < 70 || x > N - 70 || y < 24 || y > N - 24) continue;
      let s2 = 0;
      for (const z of busy) { const ox = Math.max(0, Math.min(x + 60, z.x + z.w) - Math.max(x - 60, z.x)), oy = Math.max(0, Math.min(y + 17, z.y + z.h) - Math.max(y - 17, z.y)); s2 += ox * oy; }
      if (s2 < bestS - 1) { bestS = s2; best = [x, y]; }
    }
    g.save(); g.translate(best[0], best[1]); g.rotate(-0.18);
    g.globalAlpha = 0.86; g.strokeStyle = '#a82a1e'; g.fillStyle = '#a82a1e';
    g.lineWidth = 2.6; g.strokeRect(-58, -15, 116, 30); g.lineWidth = 1; g.strokeRect(-54, -11, 108, 22);
    g.font = `700 17px ${FONT_DISPLAY}`; g.textAlign = 'center'; spaced(g, 'CAPTURED', 0, 6, 2.5);
    g.restore();
  }
}
// letter-spaced text (canvas letterSpacing where the browser has it, else drawn letter by letter)
function spaced(g, str, x, y, sp, stroke = false) {
  if ('letterSpacing' in g) {
    g.letterSpacing = `${sp}px`;
    if (stroke) g.strokeText(str, x + sp / 2, y); else g.fillText(str, x + sp / 2, y);
    g.letterSpacing = '0px';
    return;
  }
  const w = g.measureText(str).width + sp * (str.length - 1);
  const align = g.textAlign;
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  g.textAlign = 'left';
  for (const ch of str) { if (stroke) g.strokeText(ch, cx, y); else g.fillText(ch, cx, y); cx += g.measureText(ch).width + sp; }
  g.textAlign = align;
}
function flag(g, x, y, colors, s) {
  g.save(); g.strokeStyle = '#2c2014'; g.lineWidth = 1.4 * s;
  g.beginPath(); g.moveTo(x, y + 14 * s); g.lineTo(x, y - 6 * s); g.stroke();
  g.fillStyle = colors[0]; g.fillRect(x, y - 6 * s, 13 * s, 9 * s);
  g.fillStyle = colors[1]; g.fillRect(x, y - 2.5 * s, 13 * s, 2.2 * s);
  g.lineWidth = 0.9 * s; g.strokeRect(x, y - 6 * s, 13 * s, 9 * s);
  g.restore();
}
function crown(g, x, y) {
  g.save(); g.fillStyle = '#e2c044'; g.strokeStyle = '#2c2014'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x - 6, y + 4); g.lineTo(x - 6, y - 2); g.lineTo(x - 3, y + 1); g.lineTo(x, y - 4); g.lineTo(x + 3, y + 1); g.lineTo(x + 6, y - 2); g.lineTo(x + 6, y + 4); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
export function star(g, x, y, r, fill) {
  g.save(); g.fillStyle = fill; g.strokeStyle = '#2c2014'; g.lineWidth = 1;
  g.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// Who holds each region, how each mission stands ('hq', 'won', 'next' or 'locked') and where every duck came home.
export function regionStates(camp) {
  const owners = [], states = [], flawless = [];
  for (const r of REGIONS) {
    if (r.mission == null) { owners.push('mallard'); states.push('hq'); continue; }
    const m = MISSIONS[r.mission - 1], won = !!camp?.completed?.[m.id];
    owners.push(won ? 'mallard' : (m.enemy || null));
    states.push(won ? 'won' : m.id <= (camp?.unlocked || 1) ? 'next' : 'locked');
    if (camp?.flawless?.[m.id]) flawless.push(r.id);
  }
  return { owners, states, flawless };
}

export const campaignMap = new CampaignMap();
