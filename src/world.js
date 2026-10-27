// Builds one battlefield: terrain, water, sky, scenery, buildings and spawn points.
import * as THREE from 'three';
import { Terrain, HALF, WATER, GRID } from './terrain.js';
import { LOOKS, createSky, createLights, createHills, createWater, updateShadowFollow } from './sky.js';
import { PropField, Structures, STRUCTURE_FOOTPRINT, swayUniforms } from './props.js';
import { CollisionWorld } from './physics.js';
import { makeFlagTexture } from './textures.js';
import { RNG } from './rng.js';
import { ctx } from './ctx.js';

const WATER_OK = new Set(['weir']);

export class World {
  // spec: { seed, biome, look, layout:{ teams:[{x,z,r,count}], structures:[...], zone, captive }, flagColors }
  constructor(spec, tex) {
    const q = ctx.quality;
    this.spec = spec;
    this.look = LOOKS[spec.look] || LOOKS.morning;
    this.group = new THREE.Group();
    this.group.name = 'world';
    const sunDir = new THREE.Vector3();
    {
      const el = this.look.sunElev * Math.PI / 180, az = this.look.sunAz * Math.PI / 180;
      sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    }
    const T = this.terrain = new Terrain({ seed: spec.seed, biome: spec.biome, sun: sunDir });
    const rng = new RNG(spec.seed * 5 + 1);
    const L = spec.layout || { teams: [] };
    // ---- team zones
    const pads = [];
    this.spawns = [];
    this.zones = [];
    for (const tz of L.teams) this.zones.push(T.findLand(tz.x, tz.z, 34, 1.2, 0.2));
    // ---- structures (placed before spawn points so ducks never start inside one)
    const structs = [];
    const flagTex = spec.flagColors ? makeFlagTexture(spec.flagColors[0], spec.flagColors[1]) : null;
    this.flagTex = flagTex;
    for (const s of L.structures || []) {
      let x = s.x, z = s.z;
      if (s.rel !== undefined && this.zones[s.rel]) { x += this.zones[s.rel].x; z += this.zones[s.rel].z; }
      if (s.at === 'zone' && L.zone) { x = L.zone.x + (s.x || 0); z = L.zone.z + (s.z || 0); }
      if (!WATER_OK.has(s.type) && !s.exact) { const p = T.findLand(x, z, 12, 1.0, 0.24); x = p.x; z = p.z; }
      const fp = STRUCTURE_FOOTPRINT[s.type] || 2;
      if (!WATER_OK.has(s.type)) pads.push({ x, z, r: fp, min: 1.0, soft: 1.6, max: s.maxH });
      structs.push({ ...s, x, z, flagTexture: flagTex });
    }
    // objective zone / captive
    if (L.zone) {
      const p = L.zone.hill ? this.highestNear(T, L.zone.x, L.zone.z, 26) : T.findLand(L.zone.x, L.zone.z, 20, 1.2, 0.25);
      this.zone = { x: p.x, z: p.z, r: L.zone.r || 6 };
      pads.push({ x: p.x, z: p.z, r: 3.5, min: 1.2, soft: 1.8 });
      structs.push({ type: 'flag', x: p.x, z: p.z, flagTexture: flagTex });
    }
    if (L.captive) {
      let x = L.captive.x, z = L.captive.z;
      if (L.captive.rel !== undefined) { x += this.zones[L.captive.rel].x; z += this.zones[L.captive.rel].z; }
      const p = T.findLand(x, z, 15, 1.2, 0.22);
      this.captive = { x: p.x, z: p.z };
      pads.push({ x: p.x, z: p.z, r: 2.2, min: 1.0 });
      structs.push({ type: 'cage', x: p.x, z: p.z, id: 'cage', label: 'Cage' });
    }
    const clearOfBuildings = (x, z) => structs.every(st => Math.hypot(st.x - x, st.z - z) > (STRUCTURE_FOOTPRINT[st.type] || 2) + 1.6);
    // ---- spawn points
    L.teams.forEach((tz, ti) => {
      const c = this.zones[ti];
      const pts = [];
      const n = tz.count || 4, r = tz.r || 6;
      for (let k = 0; k < n; k++) {
        let p = null;
        for (let a = 0; a < 24 && !p; a++) {
          const ang = (k / n) * Math.PI * 2 + rng.range(-0.4, 0.4) + a * 0.5;
          const rr = r * rng.range(0.45, 1.0) + Math.floor(a / 8) * 2.5;
          const cand = T.findLand(c.x + Math.cos(ang) * rr, c.z + Math.sin(ang) * rr, 8, 1.0, 0.25);
          if (pts.every(o => Math.hypot(o.x - cand.x, o.z - cand.z) > 3.2) && clearOfBuildings(cand.x, cand.z)) p = cand;
        }
        if (!p) p = { x: c.x + k * 3.4, z: c.z };
        pts.push(p);
        pads.push({ x: p.x, z: p.z, r: 1.7, min: 1.0, soft: 2.2 });
      }
      this.spawns.push(pts);
    });
    T.finalize(pads, false);
    // place structures on final ground
    for (const s of structs) if (s.y === undefined && !WATER_OK.has(s.type)) s.y = T.heightAt(s.x, s.z);
    for (const s of structs) if (s.type === 'weir') s.y = WATER - 1.0;
    this.collision = new CollisionWorld(T);
    this.structures = new Structures({ terrain: T, list: structs, seed: spec.seed, quality: q, collision: this.collision, group: this.group });
    // ---- vegetation (keeps clear of spawns, buildings and the objective)
    const avoid = [];
    for (const pts of this.spawns) for (const p of pts) avoid.push({ x: p.x, z: p.z, r: 3.2 });
    for (const s of structs) avoid.push({ x: s.x, z: s.z, r: (STRUCTURE_FOOTPRINT[s.type] || 2) + 1.5 });
    if (this.zone) avoid.push({ x: this.zone.x, z: this.zone.z, r: this.zone.r });
    this.props = new PropField({ terrain: T, biome: spec.biome, seed: spec.seed, quality: q, avoid, collision: this.collision, group: this.group });
    // ---- bake and build meshes
    T.bakeRegion(0, 0, GRID - 1, GRID - 1);
    const terrainMesh = T.buildMesh(tex.detail, q);
    terrainMesh.renderOrder = 2;
    this.group.add(terrainMesh);
    this.water = createWater(T, this.look, tex.noise, q, spec.biome);
    this.water.renderOrder = 3;
    this.group.add(this.water);
    this.sky = createSky(this.look, tex.cloud, q);
    this.group.add(this.sky);
    this.hills = createHills(spec.biome, T.B.hills, spec.seed);
    this.hills.renderOrder = 4;
    this.group.add(this.hills);
    this.lights = createLights(this.look, q);
    this.group.add(this.lights.group);
    if (this.zone) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(this.zone.r, this.zone.r, 3, 40, 1, true),
        new THREE.MeshBasicMaterial({ color: '#f2d24a', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
      ring.position.set(this.zone.x, T.heightAt(this.zone.x, this.zone.z) + 1.2, this.zone.z);
      ring.renderOrder = 35;
      this.group.add(ring);
      this.zoneRing = ring;
    }
    this.fog = new THREE.Fog(new THREE.Color(this.look.horizon), this.look.fog[0] * q.fogMul, this.look.fog[1] * q.fogMul);
    this.background = new THREE.Color(this.look.horizon);
  }

  highestNear(T, x, z, r) {
    let best = { x, z, h: -Infinity };
    for (let a = 0; a < 24; a++) for (let d = 0; d <= r; d += 3) {
      const px = x + Math.cos(a / 24 * Math.PI * 2) * d, pz = z + Math.sin(a / 24 * Math.PI * 2) * d;
      if (!T.inBounds(px, pz, 12)) continue;
      const h = T.heightAt(px, pz);
      if (h > best.h && T.slopeAt(px, pz) < 0.3) best = { x: px, z: pz, h };
    }
    return best;
  }

  attach(scene) {
    scene.add(this.group);
    scene.fog = this.fog;
    scene.background = this.background;
  }

  update(dt, t, viewPos) {
    this.water.material.uniforms.uTime.value = t;
    this.sky.material.uniforms.uTime.value = t;
    swayUniforms.uTime.value = t;
    this.structures.update(dt, t);
    if (this.zoneRing) this.zoneRing.material.opacity = 0.12 + Math.sin(t * 2) * 0.05;
    if (viewPos) updateShadowFollow(this.lights, viewPos);
  }

  dispose(scene) {
    scene.remove(this.group);
    this.terrain.dispose();
    this.props.dispose();
    this.structures.dispose();
    this.water.geometry.dispose(); this.water.material.dispose();
    this.sky.geometry.dispose(); this.sky.material.dispose();
    this.hills.geometry.dispose(); this.hills.material.dispose();
    this.flagTex?.dispose();
    if (this.zoneRing) { this.zoneRing.geometry.dispose(); this.zoneRing.material.dispose(); }
    this.lights.sun.shadow?.map?.dispose();
  }
}
