// Battle rules: turns, movement budget, weapons, explosions, crates, mines, objectives.
import * as THREE from 'three';
import { ctx, emit, clamp, lerp } from './ctx.js';
import { WEAPONS, weaponList, WEAPON_ORDER } from './weapons.js';
import { WATER, SWEPT_LIMIT, HALF } from './terrain.js';
import { Hit, duckBlastDist } from './physics.js';
import { Duck, TagLayer, SPECIES, MUZZLE } from './duck.js';
import { perksFor } from './classes.js';
import * as MD from './models.js';
import { RNG } from './rng.js';
import { Ribbon } from './fx.js';

export const GRAVITY = 9.81;
export const WALK_SPEED = 3.0;      // m/s on foot; turns are limited by time, not distance
export const DT = 1 / 120;          // physics step
export const SWIM_Y = WATER - 1.0;  // feet height while paddling (chest-deep)
const SWIM_COST = WALK_SPEED / 1.6; // paddling (1.6 m/s) takes longer than walking

// Shared projectile integrator: used by real shots, the aim guide and the AI planner.
// returns 0 = flying, 1 = impact (hit filled), 2 = fuse expired, 3 = lost
export function stepProjectile(p, dt, W, wind, hit) {
  const def = p.def;
  if (p.resting) {
    const h = W.supportHeight(p.x, p.z, p.y + 0.2);
    if (p.y > h + 0.25) p.resting = false; else { p.y = h + 0.1; }
  }
  if (p.floating) {
    p.y = WATER + 0.03; p.vx *= 1 - 1.5 * dt; p.vz *= 1 - 1.5 * dt;
    p.x += p.vx * dt; p.z += p.vz * dt;
    if (W.terrain.heightAt(p.x, p.z) > WATER - 0.1) { p.floating = false; p.resting = true; }
  } else if (!p.resting) {
    const wf = def.wind || 0;
    p.vx += wind.x * wf * dt; p.vz += wind.z * wf * dt;
    p.vy -= GRAVITY * (def.gravity ?? 1) * dt;
    if (p.kind === 'gull' && p.target && p.age > 0.45) {
      let dx = p.target.x - p.x, dy = p.target.y - p.y, dz = p.target.z - p.z;
      const d = Math.hypot(dx, dy, dz) || 1; dx /= d; dy /= d; dz /= d;
      const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
      const k = Math.min(1, dt * 3.4);
      let ux = p.vx / sp + (dx - p.vx / sp) * k, uy = p.vy / sp + (dy - p.vy / sp) * k, uz = p.vz / sp + (dz - p.vz / sp) * k;
      const ul = Math.hypot(ux, uy, uz) || 1, s = def.speed[0];
      p.vx = ux / ul * s; p.vy = uy / ul * s; p.vz = uz / ul * s;
    }
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
    // airburst shells go off a few metres above the ground on the way down
    if (def.airburst && p.vy < 0 && p.age > 0.5 && ny - Math.max(W.terrain.heightAt(nx, nz), WATER) < def.airburst) {
      hit.reset(); p.x = nx; p.y = ny; p.z = nz; p.age += dt; return 1;
    }
    W.segment(p.x, p.y, p.z, nx, ny, nz, hit, { ignoreDuck: p.age < 0.3 ? p.owner : null, ducks: p.hitDucks !== false });
    if (hit.hit) {
      if (p.kind === 'grenade') {
        if (hit.kind === 'water') {
          p.floating = true; p.x = hit.x; p.z = hit.z; p.y = WATER; p.vy = 0; p.vx *= 0.3; p.vz *= 0.3; p.splash = true;
        } else {
          const r = def.bounce || 0.4;
          let nnx = hit.nx, nny = hit.ny, nnz = hit.nz;
          if (hit.kind === 'duck') { nnx = -p.vx; nny = 0.2; nnz = -p.vz; const l = Math.hypot(nnx, nny, nnz) || 1; nnx /= l; nny /= l; nnz /= l; }
          const vn = p.vx * nnx + p.vy * nny + p.vz * nnz;
          if (vn < 0) {
            p.vx = (p.vx - 2 * vn * nnx) * r; p.vy = (p.vy - 2 * vn * nny) * r; p.vz = (p.vz - 2 * vn * nnz) * r;
          }
          p.x = hit.x + nnx * 0.06; p.y = hit.y + nny * 0.06; p.z = hit.z + nnz * 0.06;
          p.bounces++; p.bounced = Math.abs(vn);
          if (Math.hypot(p.vx, p.vy, p.vz) < 0.9 && nny > 0.55) { p.resting = true; p.vx = p.vy = p.vz = 0; }
        }
      } else {
        p.x = hit.x; p.y = hit.y; p.z = hit.z;
        p.age += dt;
        return 1;
      }
    } else { p.x = nx; p.y = ny; p.z = nz; }
  }
  p.age += dt;
  if (p.fuse && p.age >= p.fuse) return 2;
  if (def.life && p.age > def.life) return 3; // short-range pellets fizzle out
  if (p.y < -30 || Math.abs(p.x) > 420 || Math.abs(p.z) > 420 || p.age > 22) return 3;
  return 0;
}

export function makeProjState(kind, def, owner, ox, oy, oz, vx, vy, vz, extra = {}) {
  return { kind, def, owner, x: ox, y: oy, z: oz, vx, vy, vz, age: 0, fuse: def.fuse || 0, bounces: 0, resting: false, floating: false, target: null, ...extra };
}

// Muzzle position for an AI shot from a duck's yaw/pitch: weapons pivot on the right shoulder (see duck.js).
export function muzzleFor(pos, yaw, pitch, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
  const rx = -Math.cos(yaw), rz = Math.sin(yaw), r = MUZZLE.right, f = MUZZLE.fwd;
  return out.set(pos.x + rx * r + dx * f, pos.y + MUZZLE.up + dy * f, pos.z + rz * r + dz * f);
}
export function dirFrom(yaw, pitch, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
}

const CRATE_WEAPONS = [['grenade', 3], ['bazooka', 3], ['mortar', 2], ['cluster', 1], ['mine', 2], ['airstrike', 1], ['sniper', 2], ['homing', 1], ['medkit', 2]];

export class Battle {
  // teams: [{ name, faction, control:'human'|'ai', difficulty, isPlayer, look:{...}, tagColor, ducks:[info], spawns:[{x,z}] }]
  constructor({ world, mission, teams, settings }) {
    this.world = world;
    this.W = world.collision;
    this.terrain = world.terrain;
    this.mission = mission;
    this.settings = settings;
    this.group = new THREE.Group();
    this.group.name = 'battle';
    world.group.add(this.group);
    this.rng = new RNG((mission.seed || 1) * 3 + 11);
    this.ducks = [];
    this.W.ducks = this.ducks;
    this.projectiles = [];
    this.mines = [];
    this.crates = [];
    this.timed = [];
    this.hit = new Hit();
    this.acc = 0;
    this.turnTeam = -1; this.turnCount = 0; this.playerTurns = 0;
    this.phase = 'intro'; this.phaseTime = 0;
    this.timer = 0; this.turnTime = 0; this.moved = 0; this.fired = false;
    this.wind = new THREE.Vector3(); this.windStrength = 0;
    this.active = null; this.result = null; this.ai = null;
    this.tags = new TagLayer(16);
    this.group.add(this.tags.mesh);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.geo = {};
    this.tracer = new Ribbon(2, 0.035, '#fff2b0', { opacity: 0.9, additive: true });
    this.group.add(this.tracer.mesh);
    this.tracerT = 0;
    this.teams = teams.map((t, i) => ({ ...t, index: i, ducks: [], lastDuck: null, captureCount: 0 }));
    for (const team of this.teams) {
      team.ducks = team.ducksInfo.map((info, k) => {
        const look = { ...team.look, rank: info.rank, spec: info.spec, commander: !!info.commander };
        const d = new Duck({ info, team, look, quality: ctx.quality });
        d.rank = info.rank || 1; d.branch = info.spec || 'none';
        d.perks = perksFor(d.rank, d.branch);
        d.camo = false; d.camoTurns = 0;
        const sp = team.spawns[k % team.spawns.length];
        d.pos.set(sp.x, this.W.supportHeight(sp.x, sp.z, this.terrain.heightAt(sp.x, sp.z) + 0.3), sp.z);
        d.yaw = sp.yaw ?? Math.atan2(-sp.x, -sp.z);
        d.ammo = { ...info.ammo };
        d.weapon = weaponList(d.ammo)[0] || 'slap';
        d.commander = !!info.commander;
        this.group.add(d.mesh);
        this.ducks.push(d);
        this.tags.assign(d);
        return d;
      });
    }
    for (let i = 0; i < (mission.crates ?? 3); i++) this.dropCrate(null, true);
    if (mission.windMax === undefined) mission.windMax = 6;
    this.rollWind(true);
  }

  getGeo(key, make) { return this.geo[key] || (this.geo[key] = make()); }
  get team() { return this.teams[this.turnTeam]; }
  isHumanTurn() { return this.team && this.team.control === 'human' && this.phase !== 'over'; }
  canAct() { return this.phase === 'act' && !this.fired && this.active && this.active.alive; }
  canSwitch() { return this.canAct() && this.moved < 0.6; }
  teamAlive(t) { return t.ducks.some(d => d.alive); }
  playerTeam() { return this.teams.find(t => t.isPlayer) || this.teams[0]; }
  enemiesOf(team) { return this.ducks.filter(d => d.alive && d.team !== team); }
  // Every turn runs on the clock: move as far as you like and fire once before it runs out.
  turnTimeFor(team) {
    if (team.control === 'ai') return 45;
    const s = this.settings.turnTime;
    return s > 0 ? s : 90;
  }

  start() { this.phase = 'intro'; this.phaseTime = 0; }

  rollWind(initial = false) {
    const max = this.mission.windMax ?? 6;
    if (max <= 0) { this.wind.set(0, 0, 0); this.windStrength = 0; return; }
    const prev = initial ? this.rng.range(0, 6.28) : Math.atan2(this.wind.z, this.wind.x);
    const ang = initial ? prev : prev + this.rng.range(-1.2, 1.2);
    const s = Math.round(this.rng.range(0, max));
    this.windStrength = s;
    this.wind.set(Math.cos(ang) * s * 0.55, 0, Math.sin(ang) * s * 0.55);
    emit('wind', { strength: s, x: this.wind.x, z: this.wind.z });
  }

  // ------------------------------------------------------------------ turns
  beginTurn() {
    if (this.checkEnd()) return;
    const n = this.teams.length;
    let t = this.turnTeam;
    for (let k = 1; k <= n; k++) {
      const c = (this.turnTeam + k + n) % n;
      if (this.teamAlive(this.teams[c]) && this.teams[c].control !== 'none') { t = c; break; }
    }
    this.turnTeam = t;
    this.turnCount++;
    const team = this.teams[t];
    if (team.isPlayer) this.playerTurns++;
    if (this.mission.objective?.type === 'survive' && team.isPlayer && this.playerTurns > this.mission.objective.turns) {
      this.finish('victory', 'You held out until reinforcements arrived.');
      return;
    }
    if (this.mission.turnLimit && team.isPlayer && this.playerTurns > this.mission.turnLimit) {
      this.finish('defeat', 'You ran out of time.');
      return;
    }
    if (this.turnCount > 1) this.rollWind();
    if (this.turnCount > 2 && this.rng.chance(0.28)) this.dropCrate();
    this.fired = false; this.moved = 0;
    this.phase = 'act'; this.phaseTime = 0;
    this.timer = this.turnTime = this.turnTimeFor(team);
    for (const d of team.ducks) {
      if (!d.alive) continue;
      if (d.camoTurns > 0 && --d.camoTurns === 0) this.setCamo(d, false);
      const r = d.perks?.regen || 0;
      if (r && d.hp < d.maxHp) {
        d.hp = Math.min(d.maxHp, d.hp + r);
        this.tags.draw(d);
        ctx.fx?.sparkle(d.pos.x, d.pos.y + 1.0, d.pos.z, [0.45, 1, 0.5], 6);
      }
    }
    const alive = team.ducks.filter(d => d.alive);
    let next = alive[0];
    if (team.lastDuck) {
      const i = team.ducks.indexOf(team.lastDuck);
      for (let k = 1; k <= team.ducks.length; k++) {
        const c = team.ducks[(i + k) % team.ducks.length];
        if (c.alive) { next = c; break; }
      }
    }
    this.setActive(next);
    emit('turnStart', { team, duck: next, battle: this });
    if (team.control === 'ai') this.ai = this.makeAI?.(this, team) || null;
  }

  setActive(d) {
    if (this.active && this.active !== d) { this.active.anim.aiming = 0; this.active.showWeapon(null); }
    this.active = d;
    if (!(d.ammo[d.weapon] > 0)) d.weapon = weaponList(d.ammo)[0] || 'slap';
    this.turnStartPos = d.pos.clone();
    this.refreshWeapon();
    emit('activeDuck', { duck: d, battle: this });
  }

  refreshWeapon() {
    const d = this.active; if (!d) return;
    const w = d.weapon;
    d.showWeapon(w === 'slap' ? null : this.getGeo('w_' + w, () => MD.weaponModel(WEAPONS[w].model)), w);
  }

  // ------------------------------------------------------------------ career abilities (free actions)
  setCamo(d, on) {
    d.camo = !!on; d.camoTurns = on ? 2 : 0;
    d.setCamo?.(on);
  }

  useAbility(d, w, def, spec) {
    let ok = false;
    switch (def.kind) {
      case 'camo':
        if (!d.camo) { this.setCamo(d, true); ok = true; emit('toast', { text: `${d.name} is camouflaged`, kind: 'info' }); }
        break;
      case 'build':
        ok = this.buildSandbags(d);
        if (!ok) emit('toast', { text: 'No room to build sandbags here', kind: 'info' });
        break;
      case 'jetpack': ok = this.jetpack(d, spec.target, def); break;
      case 'paradrop': ok = this.paradrop(d, spec.target); break;
    }
    if (!ok) { ctx.audio?.play('deny'); return false; }
    if (d.ammo[w] !== Infinity) d.ammo[w]--;
    ctx.audio?.play(def.sound, d.pos);
    if (!(d.ammo[w] > 0)) {
      const list = weaponList(d.ammo);
      d.weapon = list.find(x => !WEAPONS[x].free) || list[0] || 'slap';
      this.refreshWeapon();
      emit('weaponChange', { duck: d, weapon: d.weapon });
    }
    emit('ability', { duck: d, weapon: w, battle: this });
    return true;
  }

  buildSandbags(d) {
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    const x = d.pos.x + fx * 2.0, z = d.pos.z + fz * 2.0;
    const y = this.terrain.heightAt(x, z);
    if (y < WATER - 0.2 || this.terrain.slopeAt(x, z) > 0.5 || Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) return false;
    if (this.W.pointInSolid(x, y + 0.5, z, 1.2)) return false;
    for (const o of this.ducks) if (o.alive && Math.hypot(o.pos.x - x, o.pos.z - z) < 1.4) return false;
    this.world.structures.addStructure({ type: 'sandbags', x, z, rot: d.yaw, hp: 60 });
    ctx.fx?.dust(x, y + 0.3, z, this.groundColor(x, z), 10);
    return true;
  }

  jetpack(d, target, def) {
    if (!target || d.state === 'air' || d.state === 'swim') return false;
    let dx = target.x - d.pos.x, dz = target.z - d.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 1.5) return false;
    const R = def.range || 24;
    if (dist > R) { dx *= R / dist; dz *= R / dist; dist = R; }
    const tx = clamp(d.pos.x + dx, -HALF + 2, HALF - 2), tz = clamp(d.pos.z + dz, -HALF + 2, HALF - 2);
    const ty = this.W.supportHeight(tx, tz, Math.max(target.y, d.pos.y) + 4);
    const T = 1.1 + dist * 0.035, dy = ty - d.pos.y;
    const vy = (dy + 0.5 * GRAVITY * T * T) / T + 0.8;               // a little extra lift to clear low walls
    const tf = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * GRAVITY * dy))) / GRAVITY; // so the real flight is longer
    // airborne ducks lose 12% of their horizontal speed per second: aim long to make up for it
    const reach = (1 - Math.exp(-0.12 * tf)) / 0.12;
    d.vel.set((tx - d.pos.x) / reach, vy, (tz - d.pos.z) / reach);
    d.state = 'air'; d.jumping = true; d.safeLanding = true; d.jetT = 0.7; d.pos.y += 0.05;
    this.moved += dist;
    return true;
  }

  paradrop(d, target) {
    if (!target) return false;
    const tx = clamp(target.x, -HALF + 3, HALF - 3), tz = clamp(target.z, -HALF + 3, HALF - 3);
    const ground = this.W.supportHeight(tx, tz, 80);
    if (ground < WATER - 0.4) { emit('toast', { text: 'Pick dry land to drop onto', kind: 'info' }); return false; }
    this.moved += Math.hypot(tx - d.pos.x, tz - d.pos.z);
    d.pos.set(tx, ground + 17, tz);
    d.vel.set(0, -1, 0);
    d.state = 'air'; d.jumping = true; d.chute = true; d.safeLanding = true;
    this.showChute(d, true);
    emit('paradrop', { duck: d, battle: this });
    return true;
  }

  showChute(d, on) {
    if (on && !this.chute) {
      // the canopy is mostly seen from underneath, so it is drawn on both sides
      this.chuteMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      this.chute = new THREE.Mesh(this.getGeo('chute', () => MD.parachuteModel()), this.chuteMat); this.group.add(this.chute);
    }
    if (this.chute) { if (on) this.chute.userData.duck = d; else if (this.chute.userData.duck === d) this.chute.userData.duck = null; }
  }

  switchDuck(dir = 1) {
    if (!this.canSwitch()) return false;
    const team = this.team, list = team.ducks.filter(d => d.alive);
    if (list.length < 2) return false;
    const i = list.indexOf(this.active);
    const next = list[(i + dir + list.length) % list.length];
    this.moved = 0;
    this.setActive(next);
    return true;
  }

  chooseDuck(d) {
    if (!this.canSwitch() || !d.alive || d.team !== this.team) return false;
    this.moved = 0;
    this.setActive(d);
    return true;
  }

  cycleWeapon(dir = 1) {
    const d = this.active; if (!d) return;
    const list = weaponList(d.ammo);
    if (!list.length) return;
    const i = list.indexOf(d.weapon);
    d.weapon = list[(i + dir + list.length) % list.length];
    this.refreshWeapon();
    emit('weaponChange', { duck: d, weapon: d.weapon });
  }
  setWeapon(w) {
    const d = this.active; if (!d || !(d.ammo[w] > 0)) return false;
    d.weapon = w; this.refreshWeapon(); emit('weaponChange', { duck: d, weapon: w }); return true;
  }

  skipTurn() { if (this.phase === 'act') this.endTurn('skip'); }

  endTurn(reason = 'done') {
    if (this.phase === 'over' || this.phase === 'between') return;
    const team = this.team;
    if (this.active) { this.active.anim.aiming = 0; this.active.showWeapon(null); if (this.active.state === 'walk') this.active.state = 'idle'; }
    team.lastDuck = this.active;
    for (const m of this.mines) if (!m.armed) m.armed = true;
    // capture objective is scored at the end of each player turn
    const obj = this.mission.objective;
    if (obj?.type === 'capture' && team.isPlayer && this.world.zone) {
      const z = this.world.zone;
      const mine = team.ducks.some(d => d.alive && Math.hypot(d.pos.x - z.x, d.pos.z - z.z) < z.r);
      const theirs = this.ducks.some(d => d.alive && d.team !== team && Math.hypot(d.pos.x - z.x, d.pos.z - z.z) < z.r);
      if (mine && !theirs) { team.captureCount++; emit('toast', { text: `Hilltop held: ${team.captureCount} of ${obj.turns}`, kind: 'good' }); }
      else if (team.captureCount > 0) { team.captureCount = 0; emit('toast', { text: 'You lost the hilltop', kind: 'bad' }); }
    }
    this.ai = null;
    this.phase = 'between'; this.phaseTime = 0;
    emit('turnEnd', { team, reason, battle: this });
    this.checkEnd();
  }

  // ------------------------------------------------------------------ movement
  // Walk the active duck by (dx,dz) metres. No distance budget: the turn timer is the limit. Returns metres moved.
  walk(d, dx, dz) {
    if (!this.canAct() || d !== this.active || d.state === 'air') return 0;
    const want = Math.hypot(dx, dz);
    if (want < 1e-5) return 0;
    const swimming = d.state === 'swim';
    let nx = d.pos.x + dx, nz = d.pos.z + dz;
    const lim = HALF - 1.5;
    nx = clamp(nx, -lim, lim); nz = clamp(nz, -lim, lim);
    const h1 = this.W.supportHeight(nx, nz, Math.max(d.pos.y, WATER - 0.45) + 0.4);
    const run = Math.hypot(nx - d.pos.x, nz - d.pos.z);
    if (h1 > WATER - 0.45) {
      const base = swimming ? WATER - 0.3 : d.pos.y;
      const terrH = this.terrain.heightAt(nx, nz);
      if (h1 - terrH > 0.02) { if (h1 - base > 0.42) return 0; }          // stepping onto a structure
      else if (h1 > base + 0.001 && this.terrain.slopeAt(nx, nz) > 0.42 && h1 - base > run * 0.8) return 0; // too steep
      if (swimming && h1 > WATER + 0.6) return 0;                          // bank too high to climb out
    }
    this.W.resolveCircle(nx, nz, 0.38, d.pos.y, _res);
    nx = _res.x; nz = _res.z;
    const moved = Math.hypot(nx - d.pos.x, nz - d.pos.z);
    if (moved < 1e-5) return 0;
    this.moved += moved;
    d.pos.x = nx; d.pos.z = nz;
    if (!swimming) { d.state = 'walk'; d.walkTimer = 0.15; }
    return moved;
  }

  // Validate a teleport hop. Returns {ok, cost, time, y, reason}: a hop uses up the seconds walking there would take.
  checkHop(d, x, z) {
    const r = { ok: false, cost: 0, y: 0, reason: '' };
    if (Math.abs(x) > HALF - 1.5 || Math.abs(z) > HALF - 1.5) { r.reason = 'Out of bounds'; return r; }
    const dist = Math.hypot(x - d.pos.x, z - d.pos.z);
    // walk the line to estimate cost (paddling costs more)
    const steps = Math.max(1, Math.ceil(dist));
    let cost = 0, prevH = d.pos.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, px = d.pos.x + (x - d.pos.x) * t, pz = d.pos.z + (z - d.pos.z) * t;
      const h = this.terrain.heightAt(px, pz);
      cost += (dist / steps) * (h < WATER - 0.45 ? SWIM_COST : 1);
      prevH = h;
    }
    const y = this.W.supportHeight(x, z, d.pos.y + 2.5);
    r.y = y < WATER - 0.45 ? SWIM_Y : y;
    r.cost = cost; r.time = cost / (WALK_SPEED * (d.perks?.speedMul || 1));
    if (this.isHumanTurn() && this.timer !== Infinity && r.time > this.timer - 0.5) { r.reason = 'Not enough time'; return r; }
    if (y > d.pos.y + 1.6 + dist * 0.6) { r.reason = 'Too high'; return r; }
    if (this.terrain.slopeAt(x, z) > 0.55 && y > WATER - 0.45) { r.reason = 'Too steep'; return r; }
    if (this.W.pointInSolid(x, y + 0.1, z, 0.35)) { r.reason = 'Blocked'; return r; }
    r.ok = true;
    return r;
  }

  hop(d, x, z) {
    if (!this.canAct() || d !== this.active) return false;
    const c = this.checkHop(d, x, z);
    if (!c.ok) return false;
    if (this.timer !== Infinity) this.timer = Math.max(0.5, this.timer - c.time);
    this.moved += Math.hypot(x - d.pos.x, z - d.pos.z);
    d.pos.set(x, c.y, z);
    d.state = c.y <= SWIM_Y + 0.01 ? 'swim' : 'idle';
    d.vel.set(0, 0, 0);
    emit('hop', { duck: d });
    return true;
  }

  jump(d) {
    if (!this.canAct() || d !== this.active || d.state === 'air' || d.state === 'swim') return false;
    const f = new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw));
    d.vel.set(f.x * 2.2, 4.6, f.z * 2.2);
    d.state = 'air'; d.pos.y += 0.05; d.jumping = true;
    return true;
  }

  // ------------------------------------------------------------------ firing
  // spec: { weapon, origin, dir, power (0..1), velocity?, target?, targetDuck? }
  fire(spec) {
    if (!this.canAct()) return false;
    const d = this.active, w = spec.weapon || d.weapon, def = WEAPONS[w];
    if (!def || !(d.ammo[w] > 0)) { ctx.audio?.play('deny'); return false; }
    if (def.free) return this.useAbility(d, w, def, spec);
    if (d.ammo[w] !== Infinity) d.ammo[w]--;
    if (d.camo) this.setCamo(d, false);
    this.fired = true;
    this.phase = 'fired'; this.settleTime = 0;
    d.stats.shots++;
    // body language for onlookers: throw, slap, or the kick of a launcher
    if (def.kind === 'grenade') d.anim.throwT = 0.45;
    else if (def.kind === 'melee') d.anim.slapT = 0.4;
    else if (!['heal', 'mine', 'airstrike', 'bullet'].includes(def.kind)) d.anim.recoil = 1;
    const o = spec.origin.clone();
    const sup = this.terrain.heightAt(o.x, o.z);
    if (o.y < sup + 0.15) o.y = sup + 0.15;
    const dir = spec.dir.clone().normalize();
    const snd = def.sound;
    switch (def.kind) {
      case 'rocket': case 'shell': case 'cluster': case 'grenade': case 'homing': {
        let v;
        if (spec.velocity) { v = spec.velocity.clone(); const sp = v.length(); if (sp > def.speed[1]) v.multiplyScalar(def.speed[1] / sp); }
        else v = dir.clone().multiplyScalar(lerp(def.speed[0], def.speed[1], clamp(spec.power ?? 0.6, 0, 1)));
        const kind = def.kind === 'rocket' ? 'rocket' : def.kind === 'homing' ? 'gull' : def.kind === 'grenade' ? 'grenade' : 'shell';
        const p = this.launch(kind, def, d, o, v, { cluster: def.kind === 'cluster' });
        if (def.kind === 'homing') p.target = spec.target ? { x: spec.target.x, y: spec.target.y + 0.6, z: spec.target.z } : { x: o.x + dir.x * 40, y: o.y + dir.y * 40, z: o.z + dir.z * 40 };
        ctx.fx?.muzzle(o.x, o.y, o.z, dir.x, dir.y, dir.z, def.kind !== 'grenade');
        ctx.audio?.play(snd, o);
        break;
      }
      case 'bullet': {
        if (def.burst) {
          for (let i = 0; i < (def.shots || 1); i++) {
            const sp = def.spread || 0.05;
            const dd = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp)).normalize();
            this.launch('bullet', def, d, o, dd.multiplyScalar(def.speed[0]));
          }
          ctx.fx?.muzzle(o.x, o.y, o.z, dir.x, dir.y, dir.z, true);
          ctx.audio?.play('shot', o, { pitch: 0.7 });
          d.anim.recoil = 1;
          break;
        }
        for (let i = 0; i < (def.shots || 1); i++) {
          this.later(i * 0.14, () => {
            const sp = def.spread || 0.012;
            const dd = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp)).normalize();
            const v = dd.multiplyScalar(def.speed[0]);
            this.launch('bullet', def, d, o, v);
            d.anim.recoil = 0.6;
            ctx.fx?.muzzle(o.x, o.y, o.z, dir.x, dir.y, dir.z, false);
            ctx.audio?.play('shot', o);
          });
        }
        break;
      }
      case 'hitscan': this.fireHitscan(d, o, dir, def); ctx.audio?.play(snd, o); break;
      case 'melee': this.doSlap(d, dir, def); break;
      case 'mine': this.placeMine(d, spec.target); ctx.audio?.play('place', d.pos); break;
      case 'airstrike': this.callAirstrike(d, spec.target || new THREE.Vector3(o.x + dir.x * 30, 0, o.z + dir.z * 30), dir, def); ctx.audio?.play('radio', o); break;
      case 'heal': this.doHeal(d, spec.targetDuck, def); break;
    }
    emit('fired', { duck: d, weapon: w, battle: this });
    return true;
  }

  launch(kind, def, owner, o, v, extra = {}) {
    const p = makeProjState(kind, def, owner, o.x, o.y, o.z, v.x, v.y, v.z, extra);
    const geoKey = kind === 'bomblet' ? 'bomblet' : kind === 'gull' ? 'gull' : (def.proj || kind);
    p.mesh = new THREE.Mesh(this.getGeo('p_' + geoKey, () => MD.projectileModel(geoKey)), this.mat);
    p.mesh.position.set(o.x, o.y, o.z);
    this.group.add(p.mesh);
    if (kind === 'rocket' || kind === 'gull') p.sound = ctx.audio?.loop('rocket', o);
    if (kind === 'grenade') p.sound = ctx.audio?.loop('fuse', o);
    p.alive = true; p.trailT = 0;
    this.projectiles.push(p);
    return p;
  }

  fireHitscan(d, o, dir, def) {
    let x = o.x, y = o.y, z = o.z, remaining = def.range;
    const H = this.hit;
    let hit = null;
    while (remaining > 0) {
      const seg = Math.min(8, remaining);
      this.W.segment(x, y, z, x + dir.x * seg, y + dir.y * seg, z + dir.z * seg, H, { ignoreDuck: d });
      if (H.hit) { hit = { kind: H.kind, ref: H.ref, x: H.x, y: H.y, z: H.z }; break; }
      x += dir.x * seg; y += dir.y * seg; z += dir.z * seg; remaining -= seg;
    }
    const end = hit ? hit : { x, y, z };
    this.tracer.set([o.x, o.y, o.z, end.x, end.y, end.z], 2, ctx.camera.getWorldPosition(_v));
    this.tracerT = 0.18;
    ctx.fx?.muzzle(o.x, o.y, o.z, dir.x, dir.y, dir.z, false);
    if (!hit) return;
    if (hit.kind === 'duck') {
      const t = hit.ref;
      if (def.healDart) {
        if (t.team === d.team) { this.healDuck(t, def.heal); ctx.audio?.play('heal', t.pos); }
        else this.damageDuck(t, def.dmg, d, null);
        return;
      }
      const head = hit.y > t.pos.y + 1.45;
      const dmg = def.dmg * (head ? 1.5 : 1) * (d.perks?.dmgMul || 1);
      if (head) emit('toast', { text: 'Headshot!', kind: 'good' });
      this.damageDuck(t, dmg, d, new THREE.Vector3(dir.x * def.knock, 2.5, dir.z * def.knock));
    } else if (hit.kind === 'box') {
      this.world.structures.damage(hit.ref.ref, 30);
      ctx.fx?.dust(hit.x, hit.y - 0.15, hit.z, [0.5, 0.5, 0.48], 3);
    } else {
      ctx.fx?.dust(hit.x, hit.y, hit.z, this.groundColor(hit.x, hit.z), 4);
    }
  }

  doSlap(d, dir, def) {
    const fx = dir.x, fz = dir.z, fl = Math.hypot(fx, fz) || 1;
    let best = null, bestD = Infinity;
    for (const o of this.ducks) {
      if (!o.alive || o === d) continue;
      const vx = o.pos.x - d.pos.x, vz = o.pos.z - d.pos.z, dist = Math.hypot(vx, vz);
      if (dist > def.range || Math.abs(o.pos.y - d.pos.y) > 1.6) continue;
      const cos = (vx * fx + vz * fz) / (dist * fl + 1e-6);
      if (cos < 0.55) continue;
      if (dist < bestD) { bestD = dist; best = o; }
    }
    ctx.audio?.play('slap', d.pos);
    if (!best) { emit('toast', { text: 'Missed!', kind: 'info' }); return; }
    const k = def.knock;
    this.damageDuck(best, def.dmg * (d.perks?.dmgMul || 1), d, new THREE.Vector3(fx / fl * k, 5.5, fz / fl * k));
    ctx.fx?.feathers(best.pos.x, best.pos.y + 1.1, best.pos.z, this.duckColors(best), 8);
  }

  doHeal(d, target, def) {
    let t = d;
    if (target && target.alive && target.team === d.team && target.pos.distanceTo(d.pos) < 4) t = target;
    const splash = d.perks?.healSplash || 0;
    this.healDuck(t, def.heal + (splash >= 15 ? 10 : 0));
    if (splash) for (const o of d.team.ducks) if (o !== t && o.alive && o.pos.distanceTo(t.pos) < 5) this.healDuck(o, splash);
    ctx.audio?.play('heal', t.pos);
  }

  healDuck(t, amt) {
    const before = t.hp;
    t.hp = Math.min(t.maxHp, t.hp + amt);
    this.tags.draw(t);
    ctx.fx?.sparkle(t.pos.x, t.pos.y + 1.0, t.pos.z, [0.45, 1, 0.5], 14);
    emit('heal', { duck: t, amount: Math.round(t.hp - before) });
  }

  placeMine(d, target) {
    let x, z;
    if (target && Math.hypot(target.x - d.pos.x, target.z - d.pos.z) < 3.5) { x = target.x; z = target.z; }
    else { x = d.pos.x + Math.sin(d.yaw) * 1.3; z = d.pos.z + Math.cos(d.yaw) * 1.3; }
    const y = this.W.supportHeight(x, z, d.pos.y + 1);
    const m = { x, y, z, owner: d, armed: false, trig: -1, beepT: 0, alive: true, hidden: !!d.perks?.hiddenMines };
    m.mesh = new THREE.Mesh(this.getGeo('mine', MD.mineModel), this.mat);
    m.mesh.position.set(x, y, z);
    m.light = new THREE.Mesh(this.getGeo('mineLight', () => new THREE.SphereGeometry(0.045, 6, 4)), this.lightMat || (this.lightMat = new THREE.MeshBasicMaterial({ color: '#ff3a2a' })));
    m.light.position.set(0, 0.16, 0);
    m.mesh.add(m.light);
    this.group.add(m.mesh);
    this.mines.push(m);
  }

  callAirstrike(d, target, dir, def) {
    const dx = dir.x, dz = dir.z, l = Math.hypot(dx, dz) || 1;
    const fx = dx / l, fz = dz / l;
    const tx = clamp(target.x, -HALF + 2, HALF - 2), tz = clamp(target.z, -HALF + 2, HALF - 2);
    const ground = this.terrain.heightAt(tx, tz);
    const alt = Math.max(ground, 6) + 34, speed = 42;
    const plane = new THREE.Mesh(this.getGeo('plane', MD.planeModel), this.mat);
    const start = new THREE.Vector3(tx - fx * 160, alt, tz - fz * 160);
    plane.position.copy(start);
    plane.lookAt(start.x - fx, alt, start.z - fz);
    this.group.add(plane);
    ctx.audio?.play('plane', { x: tx, y: alt, z: tz });
    const fall = Math.sqrt(2 * (alt - ground) / GRAVITY), vh = 12;
    const bombs = def.bombs || 4;
    this.pending++;
    const flyT = 320 / speed;
    const tState = { t: 0 };
    this.timed.push({ dur: flyT, upd: (dt) => { tState.t += dt; plane.position.set(start.x + fx * speed * tState.t, alt, start.z + fz * speed * tState.t); }, end: () => { this.group.remove(plane); this.pending--; } });
    for (let i = 0; i < bombs; i++) {
      const s = (i - (bombs - 1) / 2) * 3.8;
      const dropX = tx + fx * (s - vh * fall), dropZ = tz + fz * (s - vh * fall);
      const tDrop = Math.hypot(dropX - start.x, dropZ - start.z) / speed;
      this.later(tDrop, () => {
        const p = this.launch('bomb', def, d, new THREE.Vector3(dropX, alt - 1, dropZ), new THREE.Vector3(fx * vh, 0, fz * vh));
        p.hitDucks = true;
        if (i === 0) ctx.audio?.play('whistle', { x: tx, y: ground + 5, z: tz }, { dur: fall * 0.9 });
      });
    }
  }

  // ------------------------------------------------------------------ damage
  groundColor(x, z) {
    const c = this.terrain.colorAt(x, z, _col);
    return [Math.min(1, c.r * 1.3), Math.min(1, c.g * 1.3), Math.min(1, c.b * 1.3)];
  }
  duckColors(d) {
    const s = SPECIES[d.look.species];
    return [new THREE.Color(s.body), new THREE.Color(s.head), new THREE.Color(s.wing), new THREE.Color('#ffffff')];
  }

  explode(x, y, z, def, owner, scale = 1) {
    const R = def.radius * scale, D = def.dmg * scale;
    const water = y <= WATER + 0.35 && this.terrain.heightAt(x, z) < WATER - 0.3;
    if (!water && def.crater > 0) {
      this.terrain.crater(x, z, R * 0.55, def.crater * scale);
      this.world.props.reseat(x, z, R * 1.6);
    }
    for (const inst of this.world.props.blast(x, z, R)) {
      const kind = inst.recipe.kind;
      ctx.fx?.debris(inst.x, inst.y, inst.z, kind === 'rock' ? [0.45, 0.43, 0.4] : [0.4, 0.3, 0.2], kind === 'tree' ? 18 : 8, kind === 'tree' || kind === 'bush');
    }
    for (const it of this.world.structures.items) {
      if (!it.alive || it.hp === Infinity) continue;
      let best = Infinity;
      for (const c of it.colliders) {
        const rx = x - c.x, rz = z - c.z;
        const lx = rx * c.cos - rz * c.sin, lz = rx * c.sin + rz * c.cos;
        const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz), qy = clamp(y - c.y, -c.hy, c.hy);
        best = Math.min(best, Math.hypot(lx - qx, (y - c.y) - qy, lz - qz));
      }
      if (best < R) {
        const destroyed = this.world.structures.damage(it, D * (1 - best / R) * 1.25 + 4);
        if (destroyed) {
          ctx.fx?.debris(it.x, it.y, it.z, it.type === 'bunker' || it.type === 'wall' ? [0.55, 0.55, 0.52] : [0.42, 0.3, 0.2], 26);
          ctx.fx?.explosion(it.x, it.y + 0.5, it.z, 2.2, [0.4, 0.38, 0.35]);
          if (owner && it.objective) owner.stats.objective = (owner.stats.objective || 0) + 1;
          emit('toast', { text: `${it.label || 'Building'} destroyed`, kind: it.objective === 'target' ? 'good' : 'info' });
          if (it.explosive) this.later(0.25, () => this.explode(it.x, it.y + 0.6, it.z, { radius: 4.2, dmg: 32, crater: 1.3, knock: 10 }, owner));
        }
      }
    }
    for (const d of this.ducks) {
      if (!d.alive) continue;
      const cx = d.pos.x, cz = d.pos.z;
      const dist = duckBlastDist(d, x, y, z);
      if (dist >= R) continue;
      const f = 1 - dist / R;
      const op = owner?.perks;
      const dmg = D * (0.3 + 0.7 * f) * (op ? op.blastMul * op.dmgMul : 1);
      let hx = cx - x, hz = cz - z;
      const hl = Math.hypot(hx, hz);
      if (hl < 0.05) { hx = Math.random() - 0.5; hz = Math.random() - 0.5; }
      const hn = Math.hypot(hx, hz) || 1;
      const k = (def.knock || 8) * (0.35 + 0.65 * f);
      this.damageDuck(d, dmg, owner, new THREE.Vector3(hx / hn * k, k * 0.7 + 2, hz / hn * k));
    }
    for (const c of [...this.crates]) {
      if (Math.hypot(c.x - x, c.z - z) < R * 0.8) this.removeCrate(c, true);
    }
    for (const m of this.mines) {
      if (m.alive && m.trig < 0 && Math.hypot(m.x - x, m.z - z) < R) { m.trig = 0.15 + Math.random() * 0.2; m.armed = true; }
    }
    ctx.fx?.explosion(x, y, z, R, this.groundColor(x, z), water);
    ctx.audio?.play('explosion', { x, y, z }, { size: R / 4.4 });
    emit('explosion', { x, y, z, radius: R, owner, water });
  }

  damageDuck(d, amount, source, impulse = null) {
    if (!d.alive) return;
    amount = Math.max(1, Math.round(amount));
    const real = Math.min(amount, Math.max(0, d.hp));
    d.hp -= amount;
    if (source && source.team !== d.team) source.stats.damage += real;
    d.lastHitBy = source || d.lastHitBy;
    d.anim.flinch = 1;
    this.tags.draw(d);
    emit('damage', { duck: d, amount, source, battle: this });
    ctx.audio?.play(d.hp > 0 ? 'quackHurt' : 'quackDie', d.pos, { pitch: d.voice || 1 });
    ctx.fx?.feathers(d.pos.x, d.pos.y + 1.0, d.pos.z, this.duckColors(d), d.hp > 0 ? 6 : 16);
    if (d.camo) this.setCamo(d, false);
    if (impulse) {
      d.vel.copy(impulse).multiplyScalar(1 - (d.perks?.knockRes || 0));
      d.state = 'air'; d.pos.y += 0.08; d.airborneBy = source;
      d.chute = false; this.showChute(d, false);
    }
    if (d.hp <= 0) this.killDuck(d, 'hit', source);
  }

  killDuck(d, cause, source) {
    if (!d.alive) return;
    d.alive = false; d.hp = 0;
    const by = source || d.lastHitBy;
    if (by && by.team !== d.team && by.alive !== undefined) by.stats.kills++;
    d.showWeapon(null);
    d.mesh.visible = false;
    this.tags.release(d);
    if (cause !== 'swept') {
      const gy = this.W.supportHeight(d.pos.x, d.pos.z, d.pos.y + 1);
      const mem = new THREE.Mesh(MD.memorial(d.look.helmet || '#556'), this.mat);
      mem.position.set(d.pos.x, Math.max(gy, SWIM_Y + 0.4), d.pos.z);
      mem.rotation.y = Math.random() * 6;
      this.group.add(mem);
      ctx.fx?.feathers(d.pos.x, d.pos.y + 1.0, d.pos.z, this.duckColors(d), 20);
    }
    const msg = cause === 'swept' ? `${d.name} was swept downstream` : cause === 'fall' ? `${d.name} fell too far` : `${d.name} is out of action`;
    emit('toast', { text: msg, kind: d.team.isPlayer ? 'bad' : 'good' });
    emit('duckKilled', { duck: d, cause, source: by, battle: this });
    if (d === this.active && this.phase === 'act') { this.fired = true; this.phase = 'fired'; this.settleTime = 0; }
  }

  // ------------------------------------------------------------------ crates
  dropCrate(kind = null, landed = false) {
    let x = 0, z = 0, ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      x = this.rng.range(-HALF + 10, HALF - 10); z = this.rng.range(-HALF + 10, HALF - 10);
      ok = this.terrain.heightAt(x, z) > 0.8 && this.terrain.slopeAt(x, z) < 0.3 && !this.W.pointInSolid(x, this.terrain.heightAt(x, z) + 0.2, z, 0.8)
        && !this.ducks.some(d => Math.hypot(d.pos.x - x, d.pos.z - z) < 4);
    }
    if (!ok) return;
    kind = kind || (this.rng.chance(0.55) ? 'health' : 'weapon');
    let contents = null;
    if (kind === 'weapon') {
      const total = CRATE_WEAPONS.reduce((s, w) => s + w[1], 0);
      let r = this.rng.range(0, total);
      for (const [w, wt] of CRATE_WEAPONS) { r -= wt; if (r <= 0) { contents = w; break; } }
      contents = contents || 'grenade';
    }
    const c = { kind, contents, x, z, y: landed ? this.terrain.heightAt(x, z) : 42, landed, alive: true };
    c.mesh = new THREE.Mesh(this.getGeo(kind === 'health' ? 'hcrate' : 'wcrate', kind === 'health' ? MD.healthCrate : MD.weaponCrate), this.mat);
    c.mesh.position.set(x, c.y, z);
    c.mesh.rotation.y = this.rng.range(0, 6.28);
    if (!landed) {
      c.chute = new THREE.Mesh(this.getGeo('chute', MD.parachute), this.mat);
      c.mesh.add(c.chute);
      emit('toast', { text: kind === 'health' ? 'Supply drop: medical crate' : 'Supply drop: weapon crate', kind: 'info' });
    }
    this.group.add(c.mesh);
    this.crates.push(c);
  }

  removeCrate(c, blown = false) {
    c.alive = false;
    this.group.remove(c.mesh);
    this.crates.splice(this.crates.indexOf(c), 1);
    if (blown) {
      if (c.kind === 'weapon') this.later(0.1, () => this.explode(c.x, c.y + 0.3, c.z, { radius: 3.2, dmg: 22, crater: 0.8, knock: 7 }, null));
      else ctx.fx?.sparkle(c.x, c.y + 0.3, c.z, [1, 1, 1], 8);
    }
  }

  collectCrate(c, d) {
    if (c.kind === 'health') {
      this.healDuck(d, 30);
      emit('toast', { text: `${d.name} found a medical crate (+30)`, kind: 'good' });
    } else {
      const w = c.contents, amt = w === 'airstrike' || w === 'homing' || w === 'cluster' ? 1 : 2;
      d.ammo[w] = (d.ammo[w] || 0) + amt;
      emit('toast', { text: `${d.name} picked up ${amt} × ${WEAPONS[w].name}`, kind: 'good' });
      ctx.fx?.sparkle(c.x, c.y + 0.5, c.z, [1, 0.9, 0.4], 12);
    }
    ctx.audio?.play('pickup', d.pos);
    emit('pickup', { duck: d, crate: c });
    this.removeCrate(c);
  }

  // ------------------------------------------------------------------ simulation
  later(sec, fn) { this.pending++; this.timed.push({ dur: sec, t: 0, end: () => { this.pending--; fn(); } }); }

  simStep(dt) {
    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const res = stepProjectile(p, dt, this.W, this.wind, this.hit);
      if (p.bounced) { if (p.bounced > 1.5) ctx.audio?.play('bounce', p, { vol: Math.min(1, p.bounced / 8) }); p.bounced = 0; }
      if (p.splash) { p.splash = false; ctx.fx?.splash(p.x, p.z, 0.5); ctx.audio?.play('splash', p, { size: 0.5 }); }
      if (res === 0) continue;
      this.projectiles.splice(i, 1);
      this.finishProjectile(p, res);
    }
    // ducks
    for (const d of this.ducks) this.duckStep(d, dt);
    // timed effects
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.t = (t.t || 0) + dt;
      t.upd?.(dt);
      if (t.t >= t.dur) { this.timed.splice(i, 1); t.end(); }
    }
  }

  finishProjectile(p, res) {
    p.sound?.stop();
    if (p.mesh) this.group.remove(p.mesh);
    const def = p.def;
    if (res === 3) return; // lost off the map
    if (p.kind === 'bullet') {
      const H = this.hit;
      if (res === 1 && H.kind === 'duck') {
        const v = new THREE.Vector3(p.vx, 0, p.vz).normalize().multiplyScalar(def.knock);
        v.y = 1.5;
        this.damageDuck(H.ref, def.dmg * (p.owner?.perks?.dmgMul || 1), p.owner, v);
      } else if (res === 1 && H.kind === 'box') {
        this.world.structures.damage(H.ref.ref, 8);
        ctx.fx?.dust(p.x, p.y, p.z, [0.5, 0.5, 0.48], 2);
      } else if (res === 1 && H.kind === 'water') {
        ctx.fx?.splash(p.x, p.z, 0.3);
      } else ctx.fx?.dust(p.x, p.y, p.z, this.groundColor(p.x, p.z), 3);
      return;
    }
    if (p.cluster && res === 1) {
      this.explode(p.x, p.y, p.z, def, p.owner, 0.85);
      const n = def.bomblets || 5;
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2 + Math.random() * 0.5, sp = 3.5 + Math.random() * 3;
        const b = this.launch('bomblet', def, p.owner, new THREE.Vector3(p.x, p.y + 0.6, p.z), new THREE.Vector3(Math.cos(a) * sp, 6 + Math.random() * 3, Math.sin(a) * sp));
        b.bomblet = true; b.age = 0.4;
      }
      return;
    }
    this.explode(p.x, p.y + 0.15, p.z, def, p.owner, p.bomblet ? 0.85 : 1);
  }

  duckStep(d, dt) {
    if (!d.alive) return;
    if (d.walkTimer > 0) { d.walkTimer -= dt; if (d.walkTimer <= 0 && d.state === 'walk') d.state = 'idle'; }
    if (d.state === 'air') {
      if (d.chute) {
        // floating down under canopy, drifting a little with the wind
        d.vel.y = Math.max(d.vel.y - GRAVITY * dt, -3.2);
        d.vel.x += (this.wind.x * 0.25 - d.vel.x) * Math.min(1, dt * 1.5);
        d.vel.z += (this.wind.z * 0.25 - d.vel.z) * Math.min(1, dt * 1.5);
      } else d.vel.y -= GRAVITY * dt;
      const drag = 1 - 0.12 * dt;
      d.vel.x *= drag; d.vel.z *= drag;
      const ny = d.pos.y + d.vel.y * dt;
      let nx = d.pos.x + d.vel.x * dt, nz = d.pos.z + d.vel.z * dt;
      this.W.resolveCircle(nx, nz, 0.38, ny, _res);
      if (_res.blocked) { d.vel.x *= 0.3; d.vel.z *= 0.3; }
      d.pos.set(_res.x, ny, _res.z);
      const sup = this.W.supportHeight(d.pos.x, d.pos.z, d.pos.y + 0.4);
      if (sup < WATER - 0.45 && d.pos.y <= SWIM_Y) {
        d.pos.y = SWIM_Y; d.state = 'swim'; d.vel.set(0, 0, 0); d.jumping = false;
        d.safeLanding = false; if (d.chute) { d.chute = false; this.showChute(d, false); }
        ctx.fx?.splash(d.pos.x, d.pos.z, 0.9); ctx.audio?.play('splash', d.pos);
      } else if (d.pos.y <= sup) {
        const impact = d.safeLanding ? 0 : -d.vel.y;
        d.safeLanding = false; if (d.chute) { d.chute = false; this.showChute(d, false); }
        d.pos.y = sup; d.vel.set(0, 0, 0); d.state = 'idle';
        if (!d.jumping || impact > 6) { ctx.fx?.dust(d.pos.x, d.pos.y, d.pos.z, this.groundColor(d.pos.x, d.pos.z), 5); ctx.audio?.play('thud', d.pos, { vol: Math.min(1, impact / 10) }); }
        d.jumping = false;
        if (impact > 13) {
          const dmg = Math.round((impact - 13) * 3.5);
          this.damageDuck(d, dmg, d.airborneBy || null);
          if (!d.alive) { /* killed by fall */ }
        }
        emit('landed', { duck: d });
      }
    } else {
      const sup = this.W.supportHeight(d.pos.x, d.pos.z, d.pos.y + 0.45);
      if (sup < WATER - 0.45) {
        if (d.state !== 'swim') { d.state = 'swim'; ctx.fx?.splash(d.pos.x, d.pos.z, 0.6); }
        d.pos.y += (SWIM_Y - d.pos.y) * Math.min(1, dt * 8);
      } else if (d.pos.y > sup + 0.3 && d.state !== 'swim') {
        d.state = 'air'; d.vel.set(0, 0, 0);
      } else {
        d.pos.y = sup;
        if (d.state === 'swim') d.state = 'idle';
      }
    }
    if (Math.abs(d.pos.x) > SWEPT_LIMIT || Math.abs(d.pos.z) > SWEPT_LIMIT || d.pos.y < -25) this.killDuck(d, 'swept', d.airborneBy);
  }

  settled() {
    if (this.projectiles.length || this.pending > 0) return false;
    for (const d of this.ducks) if (d.alive && d.state === 'air') return false;
    for (const m of this.mines) if (m.trig >= 0) return false;
    return true;
  }

  update(dt) {
    this.phaseTime += dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < 8) { this.simStep(DT); this.acc -= DT; steps++; }
    if (steps >= 8) this.acc = 0;
    // projectile visuals + trails
    for (const p of this.projectiles) {
      if (!p.mesh) continue;
      p.mesh.position.set(p.x, p.y, p.z);
      if (p.kind === 'grenade' || p.kind === 'bomblet') { if (!p.resting && !p.floating) p.mesh.rotation.x += dt * 12; }
      else if (Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz) > 0.1) p.mesh.lookAt(p.x - p.vx, p.y - p.vy, p.z - p.vz);
      p.sound?.move(p);
      p.trailT -= dt;
      if (p.trailT <= 0 && !p.resting && !p.floating) {
        p.trailT = p.kind === 'bullet' ? 0.01 : 0.025;
        ctx.fx?.trail(p.x, p.y, p.z, p.kind === 'gull' ? 'homing' : p.kind);
      }
      if ((p.kind === 'shell' || p.kind === 'bomb') && p.vy < -6 && !p.whistled) { p.whistled = true; if (p.kind === 'shell') ctx.audio?.play('whistle', p, { dur: 0.9, vol: 0.6 }); }
    }
    for (const d of this.ducks) if (d.alive && !d.vrDriven) d.animate(dt);
    if (this.chute) {
      const cd = this.chute.userData.duck;
      this.chute.visible = !!(cd && cd.chute && cd.alive);
      if (this.chute.visible) { this.chute.position.copy(cd.pos); this.chute.rotation.y = cd.yaw; }
    }
    for (const d of this.ducks) {
      if (!(d.jetT > 0)) continue;
      d.jetT -= dt;
      if (d.state === 'air' && Math.floor(d.jetT * 40) !== Math.floor((d.jetT + dt) * 40)) ctx.fx?.trail(d.pos.x, d.pos.y + 0.7, d.pos.z, 'rocket');
    }
    // crates
    for (const c of [...this.crates]) {
      if (!c.landed) {
        c.y -= dt * 3.2;
        c.mesh.rotation.y += dt * 0.4;
        const g = this.W.supportHeight(c.x, c.z, c.y + 0.5);
        if (c.y <= g) { c.y = g; c.landed = true; if (c.chute) { c.mesh.remove(c.chute); c.chute = null; } ctx.fx?.dust(c.x, c.y, c.z, this.groundColor(c.x, c.z), 5); }
        if (g < WATER - 0.3 && c.y <= WATER) { this.removeCrate(c); ctx.fx?.splash(c.x, c.z, 0.8); continue; }
      } else {
        const g = this.W.supportHeight(c.x, c.z, c.y + 0.5);
        if (g < c.y - 0.05) c.y = Math.max(g, c.y - dt * 6);
        if (g < WATER - 0.3) { this.removeCrate(c); continue; }
      }
      c.mesh.position.set(c.x, c.y, c.z);
      if (c.landed) for (const d of this.ducks) {
        if (d.alive && Math.hypot(d.pos.x - c.x, d.pos.z - c.z) < 1.5 && Math.abs(d.pos.y - c.y) < 1.8) { this.collectCrate(c, d); break; }
      }
    }
    // mines
    const viewer = ctx.player?.duck;
    for (const m of this.mines) {
      if (!m.alive) continue;
      m.light.visible = m.trig >= 0 ? Math.floor(ctx.time * 12) % 2 === 0 : m.armed ? Math.floor(ctx.time * 1.5) % 2 === 0 : false;
      // an engineer's mine can't be seen by the other side unless you're right on it or a Commando spots it
      if (m.hidden) m.mesh.visible = m.trig >= 0 || (viewer ? m.owner?.team === viewer.team : m.owner?.team?.control === 'human') || !!viewer?.perks?.seesMines || (!!viewer && Math.hypot(viewer.pos.x - m.x, viewer.pos.z - m.z) < 3.5);
      const g = this.W.supportHeight(m.x, m.z, m.y + 0.5);
      if (g < m.y - 0.05) { m.y = g; m.mesh.position.y = g; }
      if (m.trig < 0 && m.armed) {
        for (const d of this.ducks) {
          if (d.alive && Math.hypot(d.pos.x - m.x, d.pos.z - m.z) < 1.5 && Math.abs(d.pos.y - m.y) < 1.5) { m.trig = 1.3; ctx.audio?.play('beep', m); emit('toast', { text: 'Mine triggered!', kind: 'bad' }); break; }
        }
      } else if (m.trig >= 0) {
        m.beepT -= dt;
        if (m.beepT <= 0) { m.beepT = 0.25; ctx.audio?.play('beep', m, { pitch: 1.2 }); }
        m.trig -= dt;
        if (m.trig <= 0) {
          m.alive = false; m.trig = -1;
          this.group.remove(m.mesh);
          this.explode(m.x, m.y + 0.2, m.z, WEAPONS.mine, m.owner);
        }
      }
    }
    this.mines = this.mines.filter(m => m.alive);
    if (this.tracerT > 0) { this.tracerT -= dt; if (this.tracerT <= 0) this.tracer.hide(); }
    // phases
    switch (this.phase) {
      case 'intro':
        if (this.phaseTime > 1.8) this.beginTurn();
        break;
      case 'act':
        if (!this.active || !this.active.alive) { this.fired = true; this.phase = 'fired'; this.settleTime = 0; break; }
        if (this.timer !== Infinity) {
          const before = Math.ceil(this.timer);
          this.timer -= dt;
          if (this.timer <= 5 && Math.ceil(this.timer) !== before && this.team.control === 'human') ctx.audio?.play('tick');
          if (this.timer <= 0) { emit('toast', { text: 'Time up', kind: 'info' }); this.endTurn('time'); break; }
        }
        this.ai?.update(dt);
        break;
      case 'fired':
        if (this.settled()) {
          this.settleTime += dt;
          if (this.settleTime > 1.1) { if (!this.checkEnd()) this.endTurn('done'); }
        } else this.settleTime = 0;
        break;
      case 'between':
        if (this.phaseTime > 1.2 && this.settled()) this.beginTurn();
        break;
    }
  }

  // ------------------------------------------------------------------ objectives
  checkEnd() {
    if (this.result) return true;
    const obj = this.mission.objective || { type: 'eliminate' };
    const player = this.playerTeam();
    const humanTeams = this.teams.filter(t => t.control === 'human');
    if (this.mission.mode === 'skirmish') {
      const alive = this.teams.filter(t => this.teamAlive(t));
      if (alive.length <= 1) {
        const w = alive[0];
        this.finish(w && w.control === 'human' ? 'victory' : 'defeat', w ? `${w.name} win the day.` : 'Nobody is left standing.', w);
        return true;
      }
      return false;
    }
    if (!this.teamAlive(player)) { this.finish('defeat', 'Your squad was knocked out.'); return true; }
    const enemies = this.ducks.filter(d => d.team !== player);
    const enemiesAlive = enemies.some(d => d.alive);
    switch (obj.type) {
      case 'destroy': {
        const targets = this.world.structures.items.filter(s => s.objective === 'target');
        if (targets.length && targets.every(s => !s.alive)) { this.finish('victory', obj.win || 'All targets destroyed.'); return true; }
        break;
      }
      case 'assassinate': {
        const boss = enemies.find(d => d.commander);
        if (!boss || !boss.alive) { this.finish('victory', obj.win || 'The enemy commander is down.'); return true; }
        break;
      }
      case 'capture':
        if (player.captureCount >= obj.turns) { this.finish('victory', obj.win || 'The hill is ours.'); return true; }
        break;
      case 'rescue': {
        const c = this.world.captive;
        if (c && player.ducks.some(d => d.alive && Math.hypot(d.pos.x - c.x, d.pos.z - c.z) < 2.6)) { this.finish('victory', obj.win || 'Prisoner rescued.'); return true; }
        break;
      }
    }
    if (enemies.length && !enemiesAlive) { this.finish('victory', obj.type === 'eliminate' ? (obj.win || 'All enemy ducks are out of action.') : 'The enemy squad has been wiped out.'); return true; }
    return false;
  }

  finish(outcome, reason, winnerTeam = null) {
    if (this.result) return;
    this.result = { outcome, reason, winnerTeam, turns: this.turnCount, playerTurns: this.playerTurns };
    this.phase = 'over';
    this.ai = null;
    const winners = winnerTeam || (outcome === 'victory' ? this.playerTeam() : this.teams.find(t => !t.isPlayer && this.teamAlive(t)));
    if (winners) for (const d of winners.ducks) if (d.alive) d.anim.cheer = 4;
    ctx.audio?.play(outcome === 'victory' ? 'victory' : 'defeat');
    emit('battleOver', { result: this.result, battle: this });
  }

  // ------------------------------------------------------------------ aim preview
  // Fills out[] with points of the predicted path. Returns point count.
  predict(weapon, origin, vel, out, maxPts, seconds, target = null) {
    const def = WEAPONS[weapon];
    const kind = def.kind === 'rocket' ? 'rocket' : def.kind === 'grenade' ? 'grenade' : def.kind === 'homing' ? 'gull' : def.kind === 'bullet' ? 'bullet' : 'shell';
    const p = makeProjState(kind, def, this.active, origin.x, origin.y, origin.z, vel.x, vel.y, vel.z);
    if (kind === 'gull') p.target = target;
    let n = 0, t = 0;
    const dt = 1 / 60, every = Math.max(1, Math.round(seconds / dt / maxPts));
    out[n * 3] = p.x; out[n * 3 + 1] = p.y; out[n * 3 + 2] = p.z; n++;
    let step = 0;
    while (t < seconds && n < maxPts) {
      const r = stepProjectile(p, dt, this.W, this.wind, _ph);
      t += dt; step++;
      if (step % every === 0 || r) { out[n * 3] = p.x; out[n * 3 + 1] = p.y; out[n * 3 + 2] = p.z; n++; }
      if (r) { this.predictHit = r === 1 ? { x: p.x, y: p.y, z: p.z } : r === 2 ? { x: p.x, y: p.y, z: p.z } : null; return n; }
    }
    this.predictHit = null;
    return n;
  }

  dispose() {
    for (const p of this.projectiles) p.sound?.stop();
    this.world.group.remove(this.group);
    this.tags.dispose();
    for (const k in this.geo) this.geo[k].dispose();
    this.mat.dispose();
    this.lightMat?.dispose();
    this.chuteMat?.dispose();
  }
}
const _res = { x: 0, z: 0, blocked: false };
const _v = new THREE.Vector3();
const _col = new THREE.Color();
const _ph = new Hit();
