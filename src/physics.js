// Collision queries shared by projectiles, duck movement and the AI planner.
import * as THREE from 'three';
import { WATER, HALF } from './terrain.js';

// Duck hit volume (humanoid, ~1.85 m with helmet): torso, head and legs as three spheres above the feet.
export const DUCK_BODY_Y = 1.02, DUCK_BODY_R = 0.42, DUCK_HEAD_Y = 1.66, DUCK_HEAD_R = 0.24, DUCK_LEG_Y = 0.42, DUCK_LEG_R = 0.3;
const DUCK_SPHERES = [[DUCK_BODY_Y, DUCK_BODY_R], [DUCK_HEAD_Y, DUCK_HEAD_R], [DUCK_LEG_Y, DUCK_LEG_R]];
// Distance from a point to a duck's core (a vertical segment through hips and chest), for blast damage.
export function duckBlastDist(d, x, y, z) {
  const cy = Math.min(Math.max(y, d.pos.y + 0.6), d.pos.y + 1.3);
  return Math.hypot(d.pos.x - x, cy - y, d.pos.z - z);
}

export class CollisionGrid {
  constructor(cell = 8) {
    this.cell = cell;
    this.n = Math.ceil((HALF * 2 + 40) / cell);
    this.off = HALF + 20;
    this.cells = new Array(this.n * this.n);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }
  key(x, z) {
    const i = Math.floor((x + this.off) / this.cell), j = Math.floor((z + this.off) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }
  insert(c) {
    const r = c.bound;
    const i0 = Math.max(0, Math.floor((c.x - r + this.off) / this.cell)), i1 = Math.min(this.n - 1, Math.floor((c.x + r + this.off) / this.cell));
    const j0 = Math.max(0, Math.floor((c.z - r + this.off) / this.cell)), j1 = Math.min(this.n - 1, Math.floor((c.z + r + this.off) / this.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * this.n + i].push(c);
  }
  remove(c) {
    for (const list of this.cells) { const k = list.indexOf(c); if (k >= 0) list.splice(k, 1); }
  }
  query(x, z) { const k = this.key(x, z); return k < 0 ? EMPTY : this.cells[k]; }
}
const EMPTY = [];

// OBB collider: centre, half extents, yaw. Tree collider: vertical cylinder + crown sphere.
export function makeBoxCollider(x, y, z, hx, hy, hz, yaw, ref, soft = false) {
  return { kind: 'box', x, y, z, hx, hy, hz, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), bound: Math.hypot(hx, hz), ref, alive: true, soft };
}
export function makeTreeCollider(x, y, z, r, h, crownY, crownR, ref) {
  return { kind: 'tree', x, y, z, r, h, crownY, crownR, bound: Math.max(r, crownR), ref, alive: true };
}

export class Hit {
  constructor() { this.reset(); }
  reset() { this.hit = false; this.t = 1; this.x = this.y = this.z = 0; this.nx = 0; this.ny = 1; this.nz = 0; this.kind = ''; this.ref = null; return this; }
}

// Segment p0->p1 vs axis-aligned box (in box local frame) — slab method.
function segAabb(ax, ay, az, dx, dy, dz, hx, hy, hz, out) {
  let tmin = 0, tmax = 1, nAxis = -1, nSign = 0;
  const o = [ax, ay, az], d = [dx, dy, dz], h = [hx, hy, hz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < -h[a] || o[a] > h[a]) return false; continue; }
    let t1 = (-h[a] - o[a]) / d[a], t2 = (h[a] - o[a]) / d[a], s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  out.t = tmin; out.axis = nAxis; out.sign = nSign;
  return true;
}
const _box = { t: 0, axis: -1, sign: 0 };

function segSphere(px, py, pz, dx, dy, dz, cx, cy, cz, r) {
  const mx = px - cx, my = py - cy, mz = pz - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c <= 0) return 0;
  if (b > 0 || a < 1e-12) return -1;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : -1;
}

function segCylinderY(px, py, pz, dx, dy, dz, cx, cz, r, y0, y1) {
  const mx = px - cx, mz = pz - cz;
  const a = dx * dx + dz * dz, b = mx * dx + mz * dz, c = mx * mx + mz * mz - r * r;
  let t;
  if (c <= 0) t = 0;
  else {
    if (a < 1e-12 || b > 0) return -1;
    const disc = b * b - a * c;
    if (disc < 0) return -1;
    t = (-b - Math.sqrt(disc)) / a;
    if (t < 0 || t > 1) return -1;
  }
  const y = py + dy * t;
  return y >= y0 && y <= y1 ? t : -1;
}

export class CollisionWorld {
  constructor(terrain) {
    this.terrain = terrain;
    this.grid = new CollisionGrid(8);
    this.ducks = [];
  }
  add(c) { this.grid.insert(c); return c; }
  remove(c) { c.alive = false; this.grid.remove(c); }

  // opts: { ignoreDuck, ducks (bool, default true), water (bool, default true), colliders (default true) }
  segment(x0, y0, z0, x1, y1, z1, out, opts = {}) {
    out.reset();
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    let best = 2;
    // terrain
    const T = this.terrain;
    const h1 = T.heightAt(x1, z1);
    if (y1 <= h1) {
      let a = 0, b = 1;
      const h0 = T.heightAt(x0, z0);
      if (y0 <= h0) b = 0;
      else for (let i = 0; i < 9; i++) { const m = (a + b) * 0.5; if (y0 + dy * m <= T.heightAt(x0 + dx * m, z0 + dz * m)) b = m; else a = m; }
      best = b; out.kind = 'terrain'; out.ref = null;
      const n = T.normalAt(x0 + dx * b, z0 + dz * b, _n);
      out.nx = n.x; out.ny = n.y; out.nz = n.z;
    }
    // water surface
    if (opts.water !== false && y0 > WATER && y1 <= WATER) {
      const t = (y0 - WATER) / (y0 - y1);
      if (t < best && T.heightAt(x0 + dx * t, z0 + dz * t) < WATER - 0.05) {
        best = t; out.kind = 'water'; out.ref = null; out.nx = 0; out.ny = 1; out.nz = 0;
      }
    }
    // static colliders
    if (opts.colliders !== false) {
      const l0 = this.grid.query(x0, z0), l1 = this.grid.query(x1, z1);
      for (let pass = 0; pass < 2; pass++) {
        const list = pass === 0 ? l0 : l1;
        if (pass === 1 && l1 === l0) break;
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          if (!c.alive) continue;
          if (c.kind === 'box') {
            if (c.soft && opts.soft === false) continue;
            const rx = x0 - c.x, rz = z0 - c.z;
            const lx = rx * c.cos - rz * c.sin, lz = rx * c.sin + rz * c.cos;
            const ldx = dx * c.cos - dz * c.sin, ldz = dx * c.sin + dz * c.cos;
            if (segAabb(lx, y0 - c.y, lz, ldx, dy, ldz, c.hx, c.hy, c.hz, _box) && _box.t < best) {
              best = _box.t; out.kind = 'box'; out.ref = c;
              let nlx = 0, nly = 0, nlz = 0;
              if (_box.axis === 0) nlx = _box.sign; else if (_box.axis === 1) nly = _box.sign; else nlz = _box.sign;
              if (_box.axis < 0) nly = 1;
              out.nx = nlx * c.cos + nlz * c.sin; out.ny = nly; out.nz = -nlx * c.sin + nlz * c.cos;
            }
          } else if (c.kind === 'tree') {
            let t = segCylinderY(x0, y0, z0, dx, dy, dz, c.x, c.z, c.r, c.y - 0.5, c.y + c.h);
            if (t >= 0 && t < best) { best = t; out.kind = 'tree'; out.ref = c; out.nx = (x0 + dx * t - c.x) / c.r; out.ny = 0; out.nz = (z0 + dz * t - c.z) / c.r; }
            if (c.crownR > 0) {
              t = segSphere(x0, y0, z0, dx, dy, dz, c.x, c.crownY, c.z, c.crownR);
              if (t >= 0 && t < best) { best = t; out.kind = 'tree'; out.ref = c; out.nx = 0; out.ny = 1; out.nz = 0; }
            }
          }
        }
      }
    }
    // ducks
    if (opts.ducks !== false) {
      for (const d of this.ducks) {
        if (!d.alive || d === opts.ignoreDuck) continue;
        let t = -1;
        for (let k = 0; k < 3; k++) {
          const s = segSphere(x0, y0, z0, dx, dy, dz, d.pos.x, d.pos.y + DUCK_SPHERES[k][0], d.pos.z, DUCK_SPHERES[k][1]);
          if (s >= 0 && (t < 0 || s < t)) t = s;
        }
        if (t >= 0 && t < best) { best = t; out.kind = 'duck'; out.ref = d; out.nx = -dx; out.ny = -dy; out.nz = -dz; }
      }
    }
    if (best <= 1) {
      out.hit = true; out.t = best;
      out.x = x0 + dx * best; out.y = y0 + dy * best; out.z = z0 + dz * best;
      if (out.kind === 'duck') { const l = Math.hypot(out.nx, out.ny, out.nz) || 1; out.nx /= l; out.ny /= l; out.nz /= l; }
    }
    return out;
  }

  // Line of sight between two points, ignoring ducks unless asked.
  clearLine(ax, ay, az, bx, by, bz, ignoreDuck = null, withDucks = false) {
    const dist = Math.hypot(bx - ax, by - ay, bz - az);
    const steps = Math.max(1, Math.ceil(dist / 6));
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      this.segment(ax + (bx - ax) * t0, ay + (by - ay) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1, az + (bz - az) * t1, _hit,
        { ignoreDuck, ducks: withDucks, water: false });
      if (_hit.hit) return false;
    }
    return true;
  }

  // Push a walking circle (x,z,r) out of solid colliders. Returns adjusted {x,z}.
  resolveCircle(x, z, r, footY, out) {
    out.x = x; out.z = z; out.blocked = false;
    const list = this.grid.query(x, z);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (!c.alive) continue;
      if (c.kind === 'tree') {
        const dx = out.x - c.x, dz = out.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m && footY < c.y + c.h) {
          const s = d > 1e-4 ? (m - d) / d : 0;
          out.x += dx * s; out.z += dz * s; out.blocked = true;
        }
      } else if (c.kind === 'box') {
        if (c.soft) continue;
        if (footY > c.y + c.hy - 0.05 || footY + 1.4 < c.y - c.hy) continue;
        const rx = out.x - c.x, rz = out.z - c.z;
        const lx = rx * c.cos - rz * c.sin, lz = rx * c.sin + rz * c.cos;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
        if (d < r) {
          let nx, nz, push;
          if (d > 1e-4) { nx = ex / d; nz = ez / d; push = r - d; }
          else { // centre inside: push out along the shallowest axis
            const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
            if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; }
          }
          const lnx = lx + nx * push, lnz = lz + nz * push;
          out.x = c.x + lnx * c.cos + lnz * c.sin; out.z = c.z - lnx * c.sin + lnz * c.cos; out.blocked = true;
        }
      }
    }
    return out;
  }

  // Is a standing spot inside something solid?
  pointInSolid(x, y, z, r = 0.35) {
    const list = this.grid.query(x, z);
    for (const c of list) {
      if (!c.alive) continue;
      if (c.kind === 'tree') { if (Math.hypot(x - c.x, z - c.z) < c.r + r && y < c.y + c.h) return true; }
      else if (c.kind === 'box' && !c.soft) {
        const rx = x - c.x, rz = z - c.z;
        const lx = rx * c.cos - rz * c.sin, lz = rx * c.sin + rz * c.cos;
        if (Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r && y < c.y + c.hy && y + 1.4 > c.y - c.hy) return true;
      }
    }
    return false;
  }

  // Top of any box collider under a point (so ducks can stand on bunker roofs etc.)
  supportHeight(x, z, footY) {
    let h = this.terrain.heightAt(x, z);
    const list = this.grid.query(x, z);
    for (const c of list) {
      if (!c.alive || c.kind !== 'box' || c.soft) continue;
      const rx = x - c.x, rz = z - c.z;
      const lx = rx * c.cos - rz * c.sin, lz = rx * c.sin + rz * c.cos;
      if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) {
        const top = c.y + c.hy;
        if (top <= footY + 0.35 && top > h) h = top;
      }
    }
    return h;
  }
}
const _n = new THREE.Vector3();
const _hit = new Hit();
