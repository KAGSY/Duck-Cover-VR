// Scattered vegetation (instanced) and destructible structures (merged mesh).
import * as THREE from 'three';
import { RNG } from './rng.js';
import { HALF, WATER } from './terrain.js';
import * as MD from './models.js';
import { makeBoxCollider, makeTreeCollider } from './physics.js';
import { ctx, emit } from './ctx.js';

export const swayUniforms = { uTime: { value: 0 } };

export function makePropMaterial(quality, { sway = 0, flatColor = false } = {}) {
  const mat = quality.duckMat === 'standard' && !flatColor
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  if (sway > 0 && quality.propSway) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = swayUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
	#ifdef USE_INSTANCING
	vec3 ip = instanceMatrix[3].xyz;
	#else
	vec3 ip = vec3(0.0);
	#endif
	float swayAmt = max(position.y - 0.4, 0.0) * ${sway.toFixed(3)};
	transformed.x += sin(uTime * 1.3 + ip.x * 0.31 + ip.z * 0.17) * swayAmt;
	transformed.z += cos(uTime * 1.1 + ip.z * 0.29 + ip.x * 0.11) * swayAmt * 0.8;`);
    };
    mat.customProgramCacheKey = () => 'sway' + sway.toFixed(3);
  }
  return mat;
}

// Vegetation recipes per biome. kind: tree (collides) | bush | rock (collides) | water | shore | ground
function recipes(biome) {
  const R = [];
  const add = (name, make, count, opt) => R.push({ name, make, count, ...opt });
  switch (biome) {
    case 'marsh':
      add('willow', (s) => MD.treeWillow(s), 22, { kind: 'tree', trunk: 0.45, crownY: 3.6, crownR: 2.6, height: 3.0, variants: 3, sway: 0.03, minH: 0.6 });
      add('oak', (s) => MD.treeOak(s, '#4c7329', '#61883a'), 9, { kind: 'tree', trunk: 0.4, crownY: 4.8, crownR: 2.6, height: 3.4, variants: 3, sway: 0.02, minH: 1.0 });
      add('bush', (s) => MD.bush(s), 45, { kind: 'bush', variants: 3, sway: 0.03, minH: 0.4 });
      add('reeds', (s) => MD.reeds(s), 170, { kind: 'shore', variants: 4, sway: 0.08 });
      add('lily', (s) => MD.lilypad(s), 70, { kind: 'water', variants: 3 });
      add('rock', (s) => MD.rock(s, '#6f6c62', 0.9), 16, { kind: 'rock', trunk: 0.8, height: 0.9, variants: 3 });
      add('dead', (s) => MD.treeDead(s), 6, { kind: 'tree', trunk: 0.3, crownY: 0, crownR: 0, height: 4, variants: 2, minH: 0.5 });
      break;
    case 'farm':
      add('oak', (s) => MD.treeOak(s), 34, { kind: 'tree', trunk: 0.4, crownY: 4.8, crownR: 2.6, height: 3.4, variants: 4, sway: 0.02, minH: 0.8 });
      add('poplar', (s) => MD.treePoplar(s), 18, { kind: 'tree', trunk: 0.3, crownY: 5.4, crownR: 1.4, height: 3.6, variants: 3, sway: 0.02, minH: 0.8 });
      add('bush', (s) => MD.bush(s, '#4f7a2e', '#6a8f3a'), 40, { kind: 'bush', variants: 3, sway: 0.03, minH: 0.5 });
      add('hay', (s) => MD.haybale(s), 14, { kind: 'rock', trunk: 0.75, height: 1.4, variants: 2, minH: 1.0, maxSlope: 0.08 });
      add('reeds', (s) => MD.reeds(s), 50, { kind: 'shore', variants: 3, sway: 0.08 });
      add('rock', (s) => MD.rock(s, '#7a776c', 0.8), 12, { kind: 'rock', trunk: 0.7, height: 0.8, variants: 3 });
      break;
    case 'snow':
      add('pine', (s) => MD.treePine(s, true), 72, { kind: 'tree', trunk: 0.35, crownY: 3.8, crownR: 2.0, height: 2.6, variants: 4, sway: 0.015, minH: 0.6 });
      add('rock', (s) => MD.rock(s, '#5b6068', 1.1), 40, { kind: 'rock', trunk: 0.9, height: 1.1, variants: 4 });
      add('dead', (s) => MD.treeDead(s, '#7d7570'), 8, { kind: 'tree', trunk: 0.3, crownY: 0, crownR: 0, height: 4, variants: 2, minH: 0.6 });
      add('floe', (s) => MD.iceFloe(s), 28, { kind: 'water', variants: 3, deep: true });
      add('reeds', (s) => MD.reeds(s, true), 40, { kind: 'shore', variants: 2, sway: 0.06 });
      break;
    case 'canyon':
      add('dead', (s) => MD.treeDead(s, '#8a7a66'), 22, { kind: 'tree', trunk: 0.3, crownY: 0, crownR: 0, height: 4, variants: 3, minH: 0.6 });
      add('dry', (s) => MD.dryBush(s), 80, { kind: 'bush', variants: 4, sway: 0.04, minH: 0.3 });
      add('rock', (s) => MD.rock(s, '#9a5a3a', 1.0), 45, { kind: 'rock', trunk: 0.85, height: 1.0, variants: 4 });
      add('boulder', (s) => MD.rock(s, '#a8673f', 2.0), 14, { kind: 'rock', trunk: 1.7, height: 2.0, variants: 2 });
      break;
    case 'weir':
    default:
      add('poplar', (s) => MD.treePoplar(s), 24, { kind: 'tree', trunk: 0.3, crownY: 5.4, crownR: 1.4, height: 3.6, variants: 3, sway: 0.02, minH: 0.8 });
      add('oak', (s) => MD.treeOak(s), 24, { kind: 'tree', trunk: 0.4, crownY: 4.8, crownR: 2.6, height: 3.4, variants: 3, sway: 0.02, minH: 0.8 });
      add('willow', (s) => MD.treeWillow(s), 10, { kind: 'tree', trunk: 0.45, crownY: 3.6, crownR: 2.6, height: 3.0, variants: 2, sway: 0.03, minH: 0.5 });
      add('bush', (s) => MD.bush(s), 40, { kind: 'bush', variants: 3, sway: 0.03, minH: 0.4 });
      add('reeds', (s) => MD.reeds(s), 100, { kind: 'shore', variants: 3, sway: 0.08 });
      add('lily', (s) => MD.lilypad(s), 30, { kind: 'water', variants: 2 });
      add('rock', (s) => MD.rock(s, '#706f69', 0.9), 16, { kind: 'rock', trunk: 0.8, height: 0.9, variants: 3 });
      break;
  }
  return R;
}

export class PropField {
  constructor({ terrain, biome, seed, quality, avoid, collision, group }) {
    this.terrain = terrain; this.collision = collision; this.group = group;
    this.instances = []; // {mesh, index, x, y, z, s, yaw, collider, alive, recipe}
    this.meshes = [];
    const rng = new RNG(seed * 7 + 3);
    const T = terrain;
    const occupied = new Map();
    const occKey = (x, z) => `${Math.floor(x / 3)},${Math.floor(z / 3)}`;
    const avoidHit = (x, z, pad) => avoid.some(a => Math.hypot(x - a.x, z - a.z) < a.r + pad);
    for (const rec of recipes(biome)) {
      let count = rec.count;
      if (rec.kind === 'tree' || rec.kind === 'bush') count = Math.round(count * quality.trees);
      if (rec.kind === 'rock') count = Math.round(count * quality.rocks);
      if (count <= 0) continue;
      // choose placements
      const places = [];
      let tries = 0;
      while (places.length < count && tries < count * 40) {
        tries++;
        const x = rng.range(-HALF + 3, HALF - 3), z = rng.range(-HALF + 3, HALF - 3);
        const h = T.heightAt(x, z);
        const slope = T.slopeAt(x, z);
        if (rec.kind === 'water') {
          if (h > WATER - (rec.deep ? 1.2 : 0.35) || h < WATER - 3.5) continue;
        } else if (rec.kind === 'shore') {
          if (h < WATER - 0.5 || h > 0.9 || slope > 0.35) continue;
        } else {
          if (h < (rec.minH ?? 0.5) || slope > (rec.maxSlope ?? 0.33)) continue;
        }
        const pad = rec.kind === 'tree' ? 3.5 : rec.kind === 'rock' ? 2.0 : 1.2;
        if (avoidHit(x, z, pad)) continue;
        if (rec.kind === 'tree' || rec.kind === 'rock') {
          const k = occKey(x, z);
          if (occupied.has(k)) continue;
          occupied.set(k, true);
        }
        places.push({ x, z, y: rec.kind === 'water' ? WATER : h - 0.05, s: rng.range(0.8, 1.2), yaw: rng.range(0, Math.PI * 2) });
      }
      if (!places.length) continue;
      const variants = rec.variants || 1;
      const mat = makePropMaterial(quality, { sway: rec.sway || 0 });
      for (let v = 0; v < variants; v++) {
        const mine = places.filter((_, i) => i % variants === v);
        if (!mine.length) continue;
        const geo = rec.make(seed * 13 + v * 101 + rec.name.length);
        const mesh = new THREE.InstancedMesh(geo, mat, mine.length);
        mesh.name = rec.name + v;
        mesh.castShadow = !!quality.shadows && rec.kind !== 'water';
        mesh.receiveShadow = !!quality.shadows;
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
        const tint = new THREE.Color();
        mine.forEach((pl, i) => {
          q.setFromAxisAngle(_up, pl.yaw);
          m.compose(p.set(pl.x, pl.y, pl.z), q, sc.setScalar(pl.s));
          mesh.setMatrixAt(i, m);
          const t = 0.88 + rng.next() * 0.24;
          mesh.setColorAt(i, tint.setRGB(t, t * (0.96 + rng.next() * 0.08), t));
          const inst = { mesh, index: i, x: pl.x, y: pl.y, z: pl.z, s: pl.s, yaw: pl.yaw, alive: true, recipe: rec, collider: null };
          if (rec.kind === 'tree' || rec.kind === 'rock') {
            const r = (rec.trunk || 0.4) * pl.s;
            inst.collider = collision.add(makeTreeCollider(pl.x, pl.y, pl.z, r, (rec.height || 3) * pl.s,
              pl.y + (rec.crownY || 0) * pl.s, (rec.crownR || 0) * pl.s * 0.85, inst));
            if (rec.kind === 'tree' && rec.crownR) T.addShade(pl.x, pl.z, rec.crownR * pl.s * 1.25, 0.32);
            else T.addShade(pl.x, pl.z, r * 1.8, 0.25);
          } else if (rec.kind === 'bush') {
            T.addShade(pl.x, pl.z, 1.3 * pl.s, 0.25);
          }
          this.instances.push(inst);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
        this.meshes.push(mesh);
      }
    }
    if (quality.grass > 0) this.addGrass(rng, quality, avoid, biome);
  }

  addGrass(rng, quality, avoid, biome) {
    const T = this.terrain;
    const count = Math.round(5000 * quality.grass);
    const tones = { marsh: ['#3c5622', '#97ad54'], farm: ['#46662a', '#a6bd5c'], snow: ['#8d9a8a', '#e7ecef'], canyon: ['#7a5a32', '#c9a466'], weir: ['#3f5c25', '#9cb658'] }[biome] || ['#3f5a24', '#9bb65a'];
    const geo = MD.grassTuft(5, tones[0], tones[1]);
    const mat = makePropMaterial(quality, { sway: 0.25, flatColor: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let n = 0, tries = 0;
    this.grassPos = [];
    while (n < count && tries < count * 6) {
      tries++;
      const x = rng.range(-HALF + 2, HALF - 2), z = rng.range(-HALF + 2, HALF - 2);
      const h = T.heightAt(x, z);
      if (h < 0.5 || T.slopeAt(x, z) > 0.3) continue;
      if (avoid.some(a => Math.hypot(x - a.x, z - a.z) < a.r * 0.6)) continue;
      q.setFromAxisAngle(_up, rng.range(0, 6.28));
      const s = rng.range(0.8, 1.5);
      m.compose(p.set(x, h - 0.02, z), q, sc.set(s, s * rng.range(0.8, 1.3), s));
      mesh.setMatrixAt(n, m);
      this.grassPos.push(x, z);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = 'grass';
    this.grass = mesh;
    this.group.add(mesh);
  }

  // Flatten grass in a crater.
  clearGrass(x, z, r) {
    if (!this.grass) return;
    const m = new THREE.Matrix4();
    let changed = false;
    for (let i = 0; i < this.grass.count; i++) {
      const gx = this.grassPos[i * 2], gz = this.grassPos[i * 2 + 1];
      if (Math.abs(gx - x) < r && Math.abs(gz - z) < r && Math.hypot(gx - x, gz - z) < r) {
        this.grass.getMatrixAt(i, m);
        if (m.elements[0] === 0) continue;
        m.makeScale(0, 0, 0); this.grass.setMatrixAt(i, m); changed = true;
      }
    }
    if (changed) this.grass.instanceMatrix.needsUpdate = true;
  }

  // Remove trees/bushes/rocks caught in a blast. Returns removed instances.
  blast(x, z, r) {
    const removed = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const inst of this.instances) {
      if (!inst.alive) continue;
      if (inst.recipe.kind === 'water') continue;
      const d = Math.hypot(inst.x - x, inst.z - z);
      const reach = inst.recipe.kind === 'rock' ? r * 0.45 : inst.recipe.kind === 'tree' ? r * 0.7 : r * 0.9;
      if (d < reach) {
        inst.alive = false;
        inst.mesh.setMatrixAt(inst.index, zero);
        inst.mesh.instanceMatrix.needsUpdate = true;
        if (inst.collider) this.collision.remove(inst.collider);
        removed.push(inst);
      }
    }
    this.clearGrass(x, z, r * 0.8);
    return removed;
  }

  // Re-seat props after the ground changes (they would otherwise float).
  reseat(x, z, r) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const inst of this.instances) {
      if (!inst.alive || inst.recipe.kind === 'water') continue;
      if (Math.abs(inst.x - x) > r || Math.abs(inst.z - z) > r) continue;
      const h = this.terrain.heightAt(inst.x, inst.z) - 0.05;
      if (Math.abs(h - inst.y) < 0.05) continue;
      inst.y = h;
      q.setFromAxisAngle(_up, inst.yaw);
      m.compose(p.set(inst.x, inst.y, inst.z), q, sc.setScalar(inst.s));
      inst.mesh.setMatrixAt(inst.index, m);
      inst.mesh.instanceMatrix.needsUpdate = true;
      if (inst.collider) { inst.collider.y = h; }
    }
  }

  dispose() {
    for (const m of this.meshes) { m.geometry.dispose(); m.material.dispose(); m.dispose?.(); }
    if (this.grass) { this.grass.geometry.dispose(); this.grass.material.dispose(); }
  }
}
const _up = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- structures
const BUILDERS = {
  sandbags: MD.sandbags, bunker: MD.bunker, hut: MD.hut, tent: MD.tent, tower: MD.watchTower,
  dummy: MD.dummy, cage: MD.cage, mill: MD.windmill, radar: MD.radar, fence: MD.fence,
  barrels: MD.barrels, wall: MD.stoneWall, weir: MD.weirWall, flag: MD.flagPole,
};
export const STRUCTURE_FOOTPRINT = {
  sandbags: 2.6, bunker: 3.6, hut: 3.0, tent: 2.8, tower: 2.4, dummy: 1.0, cage: 1.6, mill: 3.2,
  radar: 2.2, fence: 2.2, barrels: 1.2, wall: 3.0, weir: 18, flag: 1.2,
};

export class Structures {
  constructor({ terrain, list, seed, quality, collision, group }) {
    this.terrain = terrain; this.collision = collision; this.group = group; this.quality = quality;
    this.items = [];
    this.material = makePropMaterial(quality);
    this.seed = seed;
    list.forEach((s, i) => this.create(s, i));
    this.mesh = null;
    this.rebuild();
  }

  create(s, i) {
    const { terrain, collision, group, quality } = this, seed = this.seed;
    const make = BUILDERS[s.type];
    if (!make) return;
    const model = make(seed * 31 + i * 7);
    const y = s.y ?? terrain.heightAt(s.x, s.z);
    const rot = s.rot || 0;
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), new THREE.Quaternion().setFromAxisAngle(_up, rot), new THREE.Vector3(1, 1, 1));
    const item = {
      id: s.id || `${s.type}${i}`, type: s.type, x: s.x, y, z: s.z, rot, geo: model.geo, matrix,
      hp: s.hp ?? model.hp, maxHp: s.hp ?? model.hp, alive: true, height: model.height,
      objective: s.objective || null, team: s.team ?? null, explosive: !!model.explosive, colliders: [], label: s.label || null,
    };
    const c = Math.cos(rot), sn = Math.sin(rot);
    for (const col of model.colliders) {
      const wx = s.x + col.x * c + col.z * sn, wz = s.z - col.x * sn + col.z * c;
      item.colliders.push(collision.add(makeBoxCollider(wx, y + col.y, wz, col.hx, col.hy, col.hz, rot, item, !!col.soft)));
    }
    if (!s.built && s.type !== 'flag' && s.type !== 'dummy' && s.type !== 'fence') terrain.addShade(s.x, s.z, (STRUCTURE_FOOTPRINT[s.type] || 2) * 1.25, 0.35);
    this.items.push(item);
    if (s.type === 'mill') {
      const sails = new THREE.Mesh(MD.millSails(seed), this.material);
      sails.position.set(s.x + Math.sin(rot) * 2.35, y + 8.2, s.z + Math.cos(rot) * 2.35);
      sails.rotation.y = rot;
      sails.castShadow = !!quality.shadows;
      group.add(sails);
      item.sails = sails;
    }
    if (s.type === 'flag') {
      item.cloth = makeFlagCloth(s.flagTexture);
      item.cloth.position.set(s.x, y + 5.6, s.z);
      group.add(item.cloth);
    }
    return this.items[this.items.length - 1];
  }

  // Add a structure during battle (an engineer's sandbag wall).
  addStructure(s) {
    const item = this.create({ ...s, built: true, id: s.id || `built${this.items.length}` }, this.items.length);
    this.rebuild();
    return item;
  }

  rebuild() {
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); }
    const parts = this.items.filter(i => i.alive);
    if (!parts.length) { this.mesh = null; return; }
    const geo = mergeTransformed(parts.map(p => [p.geo, p.matrix]));
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'structures';
    this.mesh.castShadow = !!this.quality.shadows;
    this.mesh.receiveShadow = !!this.quality.shadows;
    this.group.add(this.mesh);
  }

  damage(item, amount) {
    if (!item.alive || item.hp === Infinity) return false;
    item.hp -= amount;
    if (item.hp <= 0) { this.destroy(item); return true; }
    return false;
  }

  destroy(item) {
    if (!item.alive) return;
    item.alive = false; item.hp = 0;
    for (const c of item.colliders) this.collision.remove(c);
    if (item.cloth) item.cloth.visible = false;
    this.terrain.scorchAt(item.x, item.z, (STRUCTURE_FOOTPRINT[item.type] || 2) * 1.3, 0.55);
    this.rebuild();
    emit('structureDestroyed', item);
  }

  update(dt, t) {
    for (const it of this.items) {
      if (it.sails && it.alive) it.sails.rotateZ(dt * 0.6);
      if (it.cloth && it.cloth.material.uniforms) it.cloth.material.uniforms.uTime.value = t;
    }
  }

  dispose() {
    if (this.mesh) { this.mesh.geometry.dispose(); }
    for (const it of this.items) { it.geo.dispose(); it.sails?.geometry.dispose(); it.cloth?.geometry.dispose(); }
    this.material.dispose();
  }
}

export function mergeTransformed(list) {
  let vcount = 0, icount = 0;
  for (const [g] of list) { vcount += g.attributes.position.count; icount += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vcount * 3), nrm = new Float32Array(vcount * 3), colr = new Float32Array(vcount * 3);
  const idx = vcount > 65535 ? new Uint32Array(icount) : new Uint16Array(icount);
  const nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const [g, mat] of list) {
    nm.getNormalMatrix(mat);
    const e = mat.elements, ne = nm.elements;
    const pa = g.attributes.position.array, na = g.attributes.normal.array, ca = g.attributes.color.array;
    const cnt = g.attributes.position.count;
    for (let i = 0; i < cnt; i++) {
      const k = i * 3, o = (vo + i) * 3;
      const x = pa[k], y = pa[k + 1], z = pa[k + 2];
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = na[k], ny = na[k + 1], nz = na[k + 2];
      let tx = ne[0] * nx + ne[3] * ny + ne[6] * nz, ty = ne[1] * nx + ne[4] * ny + ne[7] * nz, tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      const l = Math.hypot(tx, ty, tz) || 1;
      nrm[o] = tx / l; nrm[o + 1] = ty / l; nrm[o + 2] = tz / l;
      colr[o] = ca[k]; colr[o + 1] = ca[k + 1]; colr[o + 2] = ca[k + 2];
    }
    const p = g.attributes.position;
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo; io += a.length; }
    else { for (let i = 0; i < p.count; i++) idx[io + i] = vo + i; io += p.count; }
    vo += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

function makeFlagCloth(texture) {
  const geo = new THREE.PlaneGeometry(1.6, 1.0, 8, 4);
  geo.translate(0.8, 0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, map: { value: null } }]),
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime; varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec3 p = position;
        float k = p.x / 1.6;
        p.z += sin(uTime * 5.0 - p.x * 3.0) * 0.18 * k;
        p.y += sin(uTime * 3.7 - p.x * 2.0) * 0.05 * k;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D map; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = texture2D(map, vUv);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.map.value = texture;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'flagcloth';
  return mesh;
}
