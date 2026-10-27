// Enemy AI: searches moves and shots by simulating real projectile physics,
// time-sliced so VR frame rate never drops while it thinks.
import * as THREE from 'three';
import { WEAPONS, weaponList } from './weapons.js';
import { stepProjectile, makeProjState, muzzleFor, dirFrom, GRAVITY, SWIM_Y } from './battle.js';
import { Hit, DUCK_BODY_Y, duckBlastDist } from './physics.js';
import { WATER, HALF } from './terrain.js';
import { ctx, clamp, lerp, wrapAngle, dampAngle } from './ctx.js';
import { RNG } from './rng.js';

const DIFF = {
  recruit: { yawErr: 0.04, powErr: 0.045, windAware: 0.4, pickBest: 0.55, move: 0.6, refine: 2, hitscanAcc: 0.6 },
  veteran: { yawErr: 0.016, powErr: 0.018, windAware: 0.85, pickBest: 0.82, move: 0.9, refine: 4, hitscanAcc: 0.8 },
  elite: { yawErr: 0.008, powErr: 0.01, windAware: 1.0, pickBest: 0.95, move: 1.0, refine: 6, hitscanAcc: 0.93 },
};
const PITCHES = [0.18, 0.36, 0.55, 0.75, 0.98, 1.2];
// How far a computer duck plans to walk in a turn (turns are timed; this keeps its moves purposeful).
const MOVE_RANGE = 20;
const MORTAR_PITCHES = [0.85, 1.0, 1.15, 1.3];

export class AIController {
  constructor(battle, team) {
    this.b = battle; this.team = team;
    this.D = DIFF[team.difficulty] || DIFF.veteran;
    this.rng = new RNG(Math.floor(Math.random() * 1e9));
    this.hit = new Hit();
    this.state = 'think'; this.t = 0;
    this.gen = this.plan();
    this.choice = null;
  }

  budget() { return ctx.isXR ? 2.5 : 6; }

  update(dt) {
    const b = this.b, d = b.active;
    this.t += dt;
    if (!d || !d.alive) return;
    switch (this.state) {
      case 'think': {
        const t0 = performance.now();
        let r;
        do { r = this.gen.next(); } while (!r.done && performance.now() - t0 < this.budget());
        // idle look-around while thinking
        if (r.done) {
          this.choice = r.value;
          if (this.choice && this.choice.duck !== b.active) b.chooseDuck(this.choice.duck);
          this.state = this.choice ? 'walk' : 'skip';
          this.t = 0; this.stuck = 0; this.lastDist = Infinity;
        }
        break;
      }
      case 'walk': {
        const c = this.choice, du = b.active;
        if (!c.pos || this.t < 0.6) break;
        const dx = c.pos.x - du.pos.x, dz = c.pos.z - du.pos.z, dist = Math.hypot(dx, dz);
        if (dist < 0.25 || this.stuck > 0.6 || this.t > 14) { this.beginAim(); break; }
        const step = Math.min(dist, (du.state === 'swim' ? 1.6 : 3.0) * (du.perks?.speedMul || 1) * dt);
        du.yaw = dampAngle(du.yaw, Math.atan2(dx, dz), 10, dt);
        const used = b.walk(du, dx / dist * step, dz / dist * step);
        if (used <= 0.0001) this.stuck += dt; else this.stuck = 0;
        if (dist > this.lastDist - 0.0005) this.stuck += dt * 0.5;
        this.lastDist = dist;
        break;
      }
      case 'aim': {
        const s = this.shot, du = b.active;
        if (!s) { this.state = 'skip'; break; }
        if (this.aimGen) {
          const t0 = performance.now();
          let r;
          do { r = this.aimGen.next(); } while (!r.done && performance.now() - t0 < this.budget());
          if (!r.done) break;
          this.aimGen = null;
          if (r.value) Object.assign(s, r.value);
        }
        du.yaw = dampAngle(du.yaw, s.yaw, 5, dt);
        du.anim.aiming = Math.min(1, du.anim.aiming + dt * 2);
        du.anim.aimPitch = lerp(du.anim.aimPitch, s.pitch || 0, Math.min(1, dt * 5));
        if (this.t > 1.0 && Math.abs(wrapAngle(du.yaw - s.yaw)) < 0.03) this.fireShot();
        break;
      }
      case 'skip':
        if (this.t > 1.2) { b.skipTurn(); this.state = 'done'; }
        break;
    }
  }

  beginAim() {
    const b = this.b, du = b.active;
    du.state = du.state === 'walk' ? 'idle' : du.state;
    // Re-plan the exact shot from where we actually ended up.
    const c = this.choice;
    if (c.kind === 'none' || !c.weapon) { this.state = 'skip'; this.t = 0; return; }
    if (c.kind === 'camo') {
      // nothing worth shooting from here: melt into the scenery and wait
      b.fire({ weapon: 'camo', origin: du.pos.clone(), dir: new THREE.Vector3(Math.sin(du.yaw), 0, Math.cos(du.yaw)) });
      this.state = 'skip'; this.t = 0; return;
    }
    if (c.heal && (!c.target || !c.target.alive)) { this.state = 'skip'; this.t = 0; return; }
    if (c.target && !c.target.alive && c.kind !== 'self') {
      // target already gone (e.g. walked into a mine): shoot the nearest instead
      const e = b.ducks.filter(x => x.alive && x.team !== this.team).sort((a, q) => a.pos.distanceTo(du.pos) - q.pos.distanceTo(du.pos))[0];
      if (!e) { this.state = 'skip'; this.t = 0; return; }
      c.target = e; c.point = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    }
    this.shot = { weapon: c.weapon, target: c.target, point: c.point, yaw: c.yaw, pitch: c.pitch, speed: c.speed, kind: c.kind };
    if (c.kind === 'ballistic' || c.kind === 'bullet') this.aimGen = this.refineShot(du, c);
    else if (c.kind === 'hitscan' || c.kind === 'melee') {
      const tgt = c.target;
      const o = muzzleFor(du.pos, 0, 0);
      const tx = tgt.pos.x, ty = tgt.pos.y + DUCK_BODY_Y, tz = tgt.pos.z;
      this.shot.yaw = Math.atan2(tx - du.pos.x, tz - du.pos.z);
      const hd = Math.hypot(tx - o.x, tz - o.z);
      this.shot.pitch = Math.atan2(ty - o.y, hd);
    } else if (c.kind === 'point') {
      this.shot.yaw = Math.atan2(c.point.x - du.pos.x, c.point.z - du.pos.z);
      this.shot.pitch = 0.3;
    } else {
      this.shot.yaw = du.yaw; this.shot.pitch = 0;
    }
    if (c.weapon !== du.weapon) b.setWeapon(c.weapon);
    this.state = 'aim'; this.t = 0;
  }

  fireShot() {
    const b = this.b, du = b.active, s = this.shot, D = this.D, R = this.rng;
    const def = WEAPONS[s.weapon];
    let yaw = s.yaw + R.gauss() * D.yawErr, pitch = (s.pitch || 0) + R.gauss() * D.yawErr * 0.6;
    const spec = { weapon: s.weapon, origin: muzzleFor(du.pos, yaw, pitch), dir: dirFrom(yaw, pitch) };
    if (s.kind === 'ballistic' || s.kind === 'bullet') {
      const sp = (s.speed || def.speed[1]) * (1 + R.gauss() * D.powErr);
      spec.velocity = spec.dir.clone().multiplyScalar(sp);
    }
    if (s.kind === 'hitscan' && R.next() > D.hitscanAcc) {
      yaw += (R.chance(0.5) ? 1 : -1) * R.range(0.02, 0.06);
      spec.dir = dirFrom(yaw, pitch); spec.origin = muzzleFor(du.pos, yaw, pitch);
    }
    if (s.kind === 'point') {
      const jitter = 1 - D.pickBest;
      spec.target = new THREE.Vector3(s.point.x + R.gauss() * 3 * jitter, s.point.y, s.point.z + R.gauss() * 3 * jitter);
      if (s.weapon === 'airstrike') spec.dir = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    }
    if (s.weapon === 'medkit') spec.targetDuck = du;
    du.yaw = yaw;
    b.fire(spec);
    this.state = 'done';
  }

  // ------------------------------------------------------------ planning
  *plan() {
    const b = this.b, team = this.team;
    const mine = team.ducks.filter(d => d.alive);
    const all = b.ducks.filter(d => d.alive && d.team !== team);
    // camouflaged ducks can't be picked out unless one of ours is close by
    const enemies = all.filter(e => !e.camo || mine.some(m => this.dist(m.pos, e.pos) < 7));
    const objTargets = team.isPlayer && b.mission.objective?.type === 'destroy' ? b.world.structures.items.filter(s => s.alive && s.objective === 'target') : [];
    if (!mine.length) return null;
    if (!enemies.length && !objTargets.length) {
      const du = b.active;
      if (du.ammo.camo > 0 && !du.camo) return { duck: du, pos: { x: du.pos.x, y: du.pos.y, z: du.pos.z }, weapon: 'camo', kind: 'camo', score: 0 };
      // everyone is hiding: go and search where they were last seen
      const e = all.slice().sort((a, c) => this.dist(a.pos, du.pos) - this.dist(c.pos, du.pos))[0];
      if (!e) return null;
      const dx = e.pos.x - du.pos.x, dz = e.pos.z - du.pos.z, dd = Math.hypot(dx, dz) || 1;
      const step = Math.min(MOVE_RANGE * 0.8, dd - 5);
      const p = step > 1.5 ? this.validPos(du, du.pos.x + dx / dd * step, du.pos.z + dz / dd * step) : null;
      return p ? { duck: du, pos: p, weapon: weaponList(du.ammo)[0], kind: 'none', score: 0, skipAfter: true } : null;
    }
    const options = [];
    // the rotation duck goes first; others may be chosen if clearly better
    const order = [b.active, ...mine.filter(d => d !== b.active)];
    for (const duck of order) {
      const positions = this.positions(duck, enemies);
      for (const pos of positions) {
        yield;
        const ranked = enemies.slice().sort((a, c) => this.dist(pos, a.pos) - this.dist(pos, c.pos));
        const targets = ranked.slice(0, 2);
        for (const e of enemies) if (e.commander && !targets.includes(e)) targets.push(e);
        if (duck.ammo.medidart > 0) {
          for (const mate of mine) {
            if (mate === duck || mate.hp > mate.maxHp * 0.6 || this.dist(pos, mate.pos) > 80) continue;
            const o = muzzleFor(pos, Math.atan2(mate.pos.x - pos.x, mate.pos.z - pos.z), 0);
            if (!b.W.clearLine(o.x, o.y, o.z, mate.pos.x, mate.pos.y + DUCK_BODY_Y, mate.pos.z, duck, false)) continue;
            options.push({ duck, pos, weapon: 'medidart', kind: 'hitscan', heal: true, target: mate, score: Math.min(WEAPONS.medidart.heal, mate.maxHp - mate.hp) * 1.3 + pos.bonus });
          }
        }
        for (const w of weaponList(duck.ammo)) {
          for (const tgt of targets) {
            const opt = yield* this.evaluate(duck, pos, w, tgt, enemies);
            if (opt) { opt.score += pos.bonus + (duck === b.active ? 3 : 0); options.push(opt); }
          }
        }
        if (team.isPlayer && b.mission.objective?.type === 'destroy') {
          for (const st of b.world.structures.items.filter(s => s.alive && s.objective === 'target').slice(0, 2)) {
            const fake = { pos: { x: st.x, y: st.y + 0.3, z: st.z }, hp: st.hp, alive: true, team: null, commander: false, structure: st };
            for (const w of ['bazooka', 'grenade', 'mortar']) {
              if (!(duck.ammo[w] > 0)) continue;
              const opt = yield* this.evaluate(duck, pos, w, fake, enemies);
              if (opt && opt.impact) {
                const dd = Math.hypot(opt.impact.x - st.x, opt.impact.z - st.z);
                const R = WEAPONS[w].radius;
                opt.score = (dd < R ? WEAPONS[w].dmg * (1 - dd / R) * 1.2 + 4 : 0) * (st.hp <= WEAPONS[w].dmg ? 1.6 : 1) + pos.bonus;
                options.push(opt);
              }
            }
          }
        }
        // healing
        if (duck.ammo.medkit > 0 && duck.hp < duck.maxHp * 0.45) {
          options.push({ duck, pos, weapon: 'medkit', kind: 'self', score: Math.min(35, duck.maxHp - duck.hp) * 0.9 + pos.bonus });
        }
      }
    }
    if (!options.length) {
      // nothing useful: advance toward the nearest enemy and skip
      const duck = b.active;
      const e = enemies.slice().sort((a, c) => a.pos.distanceTo(duck.pos) - c.pos.distanceTo(duck.pos))[0] || (objTargets[0] && { pos: new THREE.Vector3(objTargets[0].x, objTargets[0].y, objTargets[0].z) });
      if (!e) return null;
      const dir = new THREE.Vector3().subVectors(e.pos, duck.pos).setY(0).normalize();
      // head toward them; if the straight way is blocked (cliff, deep water), try angling round it
      for (const [ang, frac] of [[0, 0.8], [0.5, 0.8], [-0.5, 0.8], [0, 0.45], [1, 0.6], [-1, 0.6], [0.5, 0.4], [-0.5, 0.4]]) {
        const c = Math.cos(ang), s = Math.sin(ang), dx = dir.x * c - dir.z * s, dz = dir.x * s + dir.z * c;
        const p = this.validPos(duck, duck.pos.x + dx * MOVE_RANGE * frac, duck.pos.z + dz * MOVE_RANGE * frac);
        if (p) return { duck, pos: p, weapon: weaponList(duck.ammo)[0], kind: 'none', target: e, score: 0, skipAfter: true };
      }
      return null;
    }
    options.sort((a, c) => c.score - a.score);
    let pick = options[0];
    if (this.rng.next() > this.D.pickBest && options.length > 1) pick = options[Math.min(options.length - 1, 1 + Math.floor(this.rng.next() * 2))];
    const pd = pick.duck;
    if (pd.ammo.camo > 0 && !pd.camo && (pick.score <= 4 || (pd.hp < pd.maxHp * 0.35 && pick.score < 25))) {
      return { duck: pd, pos: pick.pos, weapon: 'camo', kind: 'camo', score: 0 };
    }
    if (pick.score <= 2 && pick.kind !== 'self') {
      // poor options only: still take the shot but prefer moving closer
      pick.score = 1;
    }
    return pick;
  }

  dist(p, q) { return Math.hypot(p.x - q.x, p.z - q.z); }

  positions(duck, enemies) {
    const b = this.b, list = [];
    const here = { x: duck.pos.x, z: duck.pos.z, y: duck.pos.y, bonus: duck.state === 'swim' ? -8 : 0, cost: 0 };
    list.push(here);
    if (this.rng.next() > this.D.move) return list;
    let near = enemies.slice().sort((a, c) => a.pos.distanceTo(duck.pos) - c.pos.distanceTo(duck.pos))[0];
    if (!near) {
      const st = b.world.structures.items.find(s => s.alive && s.objective === 'target');
      if (!st) return list;
      near = { pos: new THREE.Vector3(st.x, st.y, st.z) };
    }
    const dx = near.pos.x - duck.pos.x, dz = near.pos.z - duck.pos.z, dist = Math.hypot(dx, dz);
    const ux = dx / (dist || 1), uz = dz / (dist || 1);
    const S = MOVE_RANGE;
    const tryAdd = (x, z, bonus) => { const p = this.validPos(duck, x, z); if (p) { p.bonus = bonus + (p.y <= SWIM_Y + 0.01 ? -10 : 0); list.push(p); } };
    if (dist > 16) tryAdd(duck.pos.x + ux * Math.min(S * 0.9, dist - 12), duck.pos.z + uz * Math.min(S * 0.9, dist - 12), 1);
    if (dist - 1.4 < S * 0.95) tryAdd(near.pos.x - ux * 1.3, near.pos.z - uz * 1.3, 0);
    tryAdd(duck.pos.x - uz * Math.min(S * 0.7, 9), duck.pos.z + ux * Math.min(S * 0.7, 9), 0);
    if (duck.hp < duck.maxHp * 0.4) tryAdd(duck.pos.x - ux * S * 0.8, duck.pos.z - uz * S * 0.8, 6);
    const obj = b.mission.objective || {};
    const goal = obj.type === 'capture' ? b.world.zone : obj.type === 'rescue' ? b.world.captive : null;
    if (goal && duck.team.isPlayer) {
      const gx = goal.x - duck.pos.x, gz = goal.z - duck.pos.z, gd = Math.hypot(gx, gz);
      const step = Math.min(S * 0.95, Math.max(0, gd - (obj.type === 'rescue' ? 1.2 : 1.5)));
      if (gd > 0.5) tryAdd(duck.pos.x + gx / gd * step, duck.pos.z + gz / gd * step, obj.type === 'rescue' ? (gd - step < 2.5 ? 400 : 30) : (gd - step < (goal.r || 6) ? 45 : 20));
    }
    for (const c of b.crates) {
      if (!c.landed) continue;
      if (Math.hypot(c.x - duck.pos.x, c.z - duck.pos.z) < S * 0.9) tryAdd(c.x, c.z, c.kind === 'health' ? (duck.hp < duck.maxHp * 0.7 ? 28 : 8) : 16);
    }
    return list.slice(0, 5);
  }

  validPos(duck, x, z) {
    const b = this.b;
    x = clamp(x, -HALF + 4, HALF - 4); z = clamp(z, -HALF + 4, HALF - 4);
    const chk = b.checkHop(duck, x, z);
    if (!chk.ok) return null;
    for (const m of b.mines) {
      if (m.hidden && m.owner?.team !== this.team) continue; // an enemy engineer's mine: we don't know it's there
      // distance from mine to path segment
      const ax = duck.pos.x, az = duck.pos.z, vx = x - ax, vz = z - az, l2 = vx * vx + vz * vz || 1;
      const t = clamp(((m.x - ax) * vx + (m.z - az) * vz) / l2, 0, 1);
      if (Math.hypot(ax + vx * t - m.x, az + vz * t - m.z) < 2.2) return null;
    }
    // straight-line path must be walkable (no cliffs)
    const steps = Math.ceil(Math.hypot(x - duck.pos.x, z - duck.pos.z) / 1.5);
    let prev = duck.pos.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, px = duck.pos.x + (x - duck.pos.x) * t, pz = duck.pos.z + (z - duck.pos.z) * t;
      const h = Math.max(b.terrain.heightAt(px, pz), SWIM_Y);
      if (h - prev > 1.3) return null;
      if (b.W.pointInSolid(px, h + 0.2, pz, 0.3)) return null;
      prev = h;
    }
    return { x, z, y: chk.y, cost: chk.cost, bonus: 0 };
  }

  // Expected value of an explosion at p for this team.
  blastValue(px, py, pz, R, D, shooter, enemies) {
    let v = 0;
    for (const d of this.b.ducks) {
      if (!d.alive) continue;
      const dist = duckBlastDist(d, px, py, pz);
      if (dist >= R) continue;
      const dmg = D * (0.3 + 0.7 * (1 - dist / R));
      let val = Math.min(dmg, d.hp);
      const edge = Math.max(Math.abs(d.pos.x), Math.abs(d.pos.z)) > HALF - 12 || this.b.terrain.heightAt(d.pos.x, d.pos.z) < WATER + 0.6;
      if (dmg >= d.hp) val += 30;
      else if (edge) val += 8;
      if (d.team === this.team) v -= val * (d === shooter ? 2.2 : 1.6);
      else v += val * (d.commander ? 1.3 : 1);
    }
    return v;
  }

  *evaluate(duck, pos, w, tgt, enemies) {
    const def = WEAPONS[w], b = this.b;
    const P = { x: pos.x, y: pos.y, z: pos.z };
    const tx = tgt.pos.x, ty = tgt.pos.y + DUCK_BODY_Y, tz = tgt.pos.z;
    const yaw0 = Math.atan2(tx - P.x, tz - P.z);
    const hd = Math.hypot(tx - P.x, tz - P.z);
    switch (def.kind) {
      case 'camo': case 'build': case 'jetpack': case 'paradrop':
        return null; // abilities are chosen separately
      case 'melee': {
        if (hd > def.range - 0.2) return null;
        let s = def.dmg;
        if (b.terrain.heightAt(tx, tz) < WATER + 0.8 || Math.max(Math.abs(tx), Math.abs(tz)) > HALF - 10) s += 25;
        return { duck, pos, weapon: w, kind: 'melee', target: tgt, score: s * 1.1 };
      }
      case 'hitscan': {
        if (def.healDart) return null; // darts are for squadmates (see plan)
        const o = muzzleFor(P, yaw0, 0);
        if (hd > def.range) return null;
        if (!b.W.clearLine(o.x, o.y, o.z, tx, ty, tz, duck, false)) return null;
        const acc = this.D.hitscanAcc * clamp(1.15 - hd / 220, 0.4, 1);
        return { duck, pos, weapon: w, kind: 'hitscan', target: tgt, score: Math.min(def.dmg, tgt.hp) * acc + (def.dmg >= tgt.hp ? 25 * acc : 0) };
      }
      case 'airstrike': {
        const ux = Math.sin(yaw0), uz = Math.cos(yaw0);
        let v = 0;
        for (let k = 0; k < (def.bombs || 4); k++) {
          const s = (k - 1.5) * 3.8;
          const bx = tx + ux * s, bz = tz + uz * s;
          v += this.blastValue(bx, b.terrain.heightAt(bx, bz) + 0.3, bz, def.radius, def.dmg, duck, enemies) * 0.75;
        }
        return { duck, pos, weapon: w, kind: 'point', target: tgt, point: { x: tx, y: tgt.pos.y, z: tz }, yaw: yaw0, score: v };
      }
      case 'mine':
        return hd < 9 ? { duck, pos, weapon: w, kind: 'self', target: tgt, score: 8 } : null;
      case 'heal':
        return null;
      case 'homing': {
        yield;
        const o = muzzleFor(P, yaw0, 0.6);
        const dir = dirFrom(yaw0, 0.6);
        const st = makeProjState('gull', def, duck, o.x, o.y, o.z, dir.x * def.speed[0], dir.y * def.speed[0], dir.z * def.speed[0]);
        st.target = { x: tx, y: ty, z: tz };
        const imp = this.sim(st, 1 / 40, duck);
        if (!imp) return null;
        return { duck, pos, weapon: w, kind: 'point', target: tgt, point: { x: tx, y: tgt.pos.y, z: tz }, score: this.blastValue(imp.x, imp.y, imp.z, def.radius, def.dmg, duck, enemies) * 0.95 };
      }
      default: {
        // ballistic: rocket / shell / cluster / grenade / bullet
        const isBullet = def.kind === 'bullet';
        if (def.kind === 'grenade' && hd > 30) return null;
        if (isBullet && hd > (def.life ? def.speed[0] * def.life * 0.85 : 110)) return null;
        const pitches = isBullet ? [null] : def.kind === 'shell' || def.kind === 'cluster' ? (w === 'mortar' ? MORTAR_PITCHES : PITCHES.concat(MORTAR_PITCHES.slice(1))) : PITCHES;
        let best = null;
        for (const pc of pitches) {
          yield;
          const sol = this.solve(P, yaw0, pc, { x: tx, y: ty, z: tz }, def, isBullet);
          if (!sol) continue;
          const o = muzzleFor(P, sol.yaw, sol.pitch);
          const dv = dirFrom(sol.yaw, sol.pitch);
          const kind = def.kind === 'rocket' ? 'rocket' : def.kind === 'grenade' ? 'grenade' : isBullet ? 'bullet' : 'shell';
          const st = makeProjState(kind, def, duck, o.x, o.y, o.z, dv.x * sol.speed, dv.y * sol.speed, dv.z * sol.speed);
          const imp = this.sim(st, 1 / 40, duck);
          if (!imp) continue;
          let score;
          if (isBullet) score = imp.duck === tgt ? Math.min(def.dmg * (def.burst ? def.shots * 0.55 : 2.4), tgt.hp) : imp.duck && imp.duck.team !== this.team ? def.dmg : imp.duck ? -20 : 0;
          else {
            let R = def.radius, D = def.dmg;
            if (def.kind === 'cluster') { R *= 1.5; D *= 1.7; }
            score = this.blastValue(imp.x, imp.y, imp.z, R, D, duck, enemies);
          }
          if (!best || score > best.score) best = { duck, pos, weapon: w, kind: isBullet ? 'bullet' : 'ballistic', target: tgt, yaw: sol.yaw, pitch: sol.pitch, speed: sol.speed, score, impact: imp };
        }
        return best;
      }
    }
  }

  // Analytic launch speed for a pitch, with partial wind compensation.
  solve(P, yaw0, pitch, T, def, isBullet) {
    const b = this.b;
    const wf = (def.wind || 0) * this.D.windAware;
    let aimX = T.x, aimZ = T.z, yaw = yaw0, speed = 0;
    const g = GRAVITY * (def.gravity ?? 1);
    for (let it = 0; it < 3; it++) {
      yaw = Math.atan2(aimX - P.x, aimZ - P.z);
      if (isBullet) {
        const o = muzzleFor(P, yaw, 0);
        const R = Math.hypot(aimX - o.x, aimZ - o.z);
        speed = def.speed[0];
        // low-arc solution for fixed speed
        const H = T.y - o.y, v2 = speed * speed;
        const disc = v2 * v2 - g * (g * R * R + 2 * H * v2);
        if (disc < 0) return null;
        pitch = Math.atan((v2 - Math.sqrt(disc)) / (g * R));
        return { yaw, pitch, speed };
      }
      const o = muzzleFor(P, yaw, pitch);
      const R = Math.hypot(aimX - o.x, aimZ - o.z), H = T.y - o.y;
      const c = Math.cos(pitch), denom = 2 * c * c * (R * Math.tan(pitch) - H);
      if (denom <= 0) return null;
      speed = Math.sqrt(g * R * R / denom);
      if (!(speed >= def.speed[0] * 0.98 && speed <= def.speed[1])) return null;
      if (!wf) break;
      const tf = R / (speed * c);
      aimX = T.x - 0.5 * b.wind.x * wf * tf * tf;
      aimZ = T.z - 0.5 * b.wind.z * wf * tf * tf;
    }
    return { yaw, pitch, speed };
  }

  // Run a projectile to its end. Returns impact {x,y,z,duck} or null.
  sim(st, dt, shooter) {
    const b = this.b, H = this.hit;
    const wind = _wind.copy(b.wind).multiplyScalar(this.D.windAware);
    for (let i = 0; i < 1200; i++) {
      const r = stepProjectile(st, dt, b.W, wind, H);
      if (r === 1) return { x: st.x, y: st.y, z: st.z, duck: H.kind === 'duck' ? H.ref : null, kind: H.kind };
      if (r === 2) return { x: st.x, y: st.y, z: st.z, duck: null, kind: 'fuse' };
      if (r === 3) return null;
    }
    return null;
  }

  // Fine-tune speed/yaw with full-rate simulation from the actual position.
  *refineShot(du, c) {
    const b = this.b, def = WEAPONS[c.weapon];
    const tgt = c.target;
    if (!tgt.alive) return null;
    const T = { x: tgt.pos.x, y: tgt.pos.y + DUCK_BODY_Y, z: tgt.pos.z };
    const isBullet = def.kind === 'bullet';
    let best = null;
    const pitches = c.pitch !== undefined ? [c.pitch] : PITCHES;
    for (const pc of pitches) {
      const sol = this.solve(du.pos, Math.atan2(T.x - du.pos.x, T.z - du.pos.z), pc, T, def, isBullet);
      if (sol) { best = sol; break; }
    }
    if (!best) {
      for (const pc of PITCHES.concat(MORTAR_PITCHES)) { const s = this.solve(du.pos, Math.atan2(T.x - du.pos.x, T.z - du.pos.z), pc, T, def, isBullet); if (s) { best = s; break; } }
    }
    if (!best) return { yaw: Math.atan2(T.x - du.pos.x, T.z - du.pos.z), pitch: 0.6, speed: def.speed ? def.speed[1] * 0.7 : 0 };
    let { yaw, pitch, speed } = best;
    const kind = def.kind === 'rocket' ? 'rocket' : def.kind === 'grenade' ? 'grenade' : isBullet ? 'bullet' : 'shell';
    for (let it = 0; it < this.D.refine; it++) {
      yield;
      const o = muzzleFor(du.pos, yaw, pitch), dv = dirFrom(yaw, pitch);
      const st = makeProjState(kind, def, du, o.x, o.y, o.z, dv.x * speed, dv.y * speed, dv.z * speed);
      const imp = this.sim(st, 1 / 120, du);
      if (!imp) break;
      if (imp.duck === tgt) break;
      const mx = T.x - imp.x, mz = T.z - imp.z;
      if (Math.hypot(mx, mz) < 0.6) break;
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
      const er = mx * fx + mz * fz, el = mx * rx + mz * rz;
      const R = Math.max(4, Math.hypot(T.x - o.x, T.z - o.z));
      if (isBullet) pitch += clamp(er / R * 0.5, -0.05, 0.05);
      else speed = clamp(speed * (1 + clamp(er / R * 0.55, -0.18, 0.18)), def.speed[0], def.speed[1]);
      yaw -= Math.atan2(el, R) * 0.85;
    }
    return { yaw, pitch, speed };
  }
}
const _wind = new THREE.Vector3();
