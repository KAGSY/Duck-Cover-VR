// Careers and promotions: the career tree rules, the barracks and career screens, each career's kit and
// bonuses in battle, and the free abilities (camouflage, sandbags, jetpack, parachute).
import { launch, advance } from './lib.mjs';
const out = process.argv[2] || '/tmp/claude-0/shots';
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const T = await launch({ port: 8786, w: 1100, h: 620 });
const { page, errors } = T;
let fails = 0;
const check = (cond, msg) => { console.log(cond ? 'ok  ' : 'FAIL', msg); if (!cond) fails++; };
const render = async (name) => { await page.evaluate(() => window.__duck.step(0.0001, false)); await page.screenshot({ path: `${out}/${name}.png` }); };
await page.click('#play');
await advance(page, 1, 1 / 30, false);

// ------------------------------------------------------------------ career tree rules and promotion points
const rules = await page.evaluate(() => {
  const D = window.__duck, C = D.CLASSES, K = D.CAMPAIGN, r = {};
  const camp = D.newCampaign(), pud = camp.roster[0];
  r.squad = camp.roster.map(d => C.classTitle(d.rank, d.spec));
  r.points0 = camp.points;
  r.next = C.nextPromotion(pud);
  r.broke = K.promote(camp, pud, 'sapper');               // no points yet
  camp.points = 1;
  r.bad = K.promote(camp, pud, 'pilot');                  // not a career
  r.ok = K.promote(camp, pud, 'sapper');
  r.after = [pud.rank, pud.spec, C.classTitle(pud.rank, pud.spec), camp.points];
  // career levels cost one point, the elite ranks two
  r.costs = [2, 3, 4, 5, 6, 7].map(k => C.RANKS[k].cost);
  r.invested = C.pointsInvested(7);
  pud.rank = 4; camp.points = 1;
  r.eliteShort = K.promote(camp, pud);
  camp.points = 2;
  r.elite = K.promote(camp, pud) && C.classTitle(pud.rank, pud.spec);
  r.eliteLeft = camp.points;
  pud.rank = 7; r.top = [C.classTitle(7, 'sapper'), C.nextPromotion(pud)];
  r.gains = C.kitGains(2, 3, 'sharpshooter').map(g => `${g.weapon} ${g.from}→${g.to === Infinity ? '∞' : g.to}`);
  // points from missions: a fake battle with the squad
  const c2 = D.newCampaign();
  const fight = (id, outcome, alive) => K.applyResults(c2, D.MISSIONS[id - 1], {
    result: { outcome, reason: '' },
    playerTeam: () => ({ ducks: c2.roster.slice(0, 4).map((info, i) => ({ info, alive: alive[i], stats: { kills: 1, damage: 30 } })) }),
  }).points;
  r.win = fight(2, 'victory', [1, 1, 1, 1]);
  r.again = fight(2, 'victory', [1, 1, 1, 1]);
  r.winLoss = fight(3, 'victory', [1, 0, 1, 1]);
  r.redo = fight(3, 'victory', [1, 1, 1, 1]);
  r.defeat = fight(5, 'defeat', [1, 1, 1, 1]);
  const before = c2.roster.length;
  fight(4, 'victory', [1, 1, 1, 1]); const joined = c2.roster.length - before;
  fight(4, 'victory', [1, 1, 1, 1]); const joinedAgain = c2.roster.length - before - joined;
  r.reinforce = [joined, joinedAgain, C.classTitle(c2.roster[c2.roster.length - 1].rank, c2.roster[c2.roster.length - 1].spec)];
  r.total = c2.points;
  return r;
});
console.log(JSON.stringify(rules));
check(rules.squad.join() === 'Private,Private,Private,Private' && rules.points0 === 0, 'every duck starts as a Private, with no points');
check(rules.next && rules.next.needsCareer && rules.next.cost === 1 && !rules.broke, 'a Private needs a point and a career to be promoted');
check(!rules.bad && rules.ok && rules.after.join() === '2,sapper,Sapper,0', 'one point makes Puddles a Sapper');
check(rules.costs.join() === '1,1,1,2,2,2' && rules.invested === 9, 'career levels cost 1 point, elite ranks 2 (9 points to Legend)');
check(!rules.eliteShort && rules.elite === 'Commando' && rules.eliteLeft === 0, 'Commando takes two points');
check(rules.top[0] === 'Legend' && !rules.top[1], 'Legend is the top rank');
check(rules.gains.join() === 'sniper 2→∞,camo 1→2', 'Scout to Sniper adds an endless sniper rifle and more camouflage');
check(rules.win.victory === 1 && rules.win.survival === 1 && rules.win.total === 2, 'a win with every duck home pays 1 point plus a 1 point bonus');
check(rules.again.victory === 0 && rules.again.survival === 0 && rules.again.wonBefore && rules.again.bonusBefore, 'replaying a mission doesn’t pay twice');
check(rules.winLoss.victory === 1 && rules.winLoss.survival === 0 && rules.winLoss.lost === 1, 'losing a duck misses the bonus');
check(rules.redo.victory === 0 && rules.redo.survival === 1, 'the missed bonus can be earned by replaying');
check(rules.defeat.victory === 0 && rules.defeat.survival === 0, 'a defeat pays nothing');
check(rules.reinforce[0] === 1 && rules.reinforce[1] === 0 && rules.reinforce[2] === 'Private', 'reinforcements join once, as Privates');
check(rules.total === 6, `points add up (${rules.total})`);

// ------------------------------------------------------------------ barracks, career and map screens
const tap = (id) => page.evaluate((id) => {
  const D = window.__duck, p = D.scene.getObjectByName('menu').userData.panel;
  const r = p.rects.find(r => r.id === id);
  if (!r) return 'missing';
  if (r.enabled === false) return 'disabled';
  r.onClick(); D.step(0.016, false); D.step(0.016, false); return 'ok';
}, id);
await page.evaluate(() => {
  const D = window.__duck, c = D.newCampaign();
  c.unlocked = 5; c.completed = { 1: true, 2: true, 3: true, 4: true }; c.flawless = { 1: true, 3: true };
  c.points = 0;
  c.roster[2].rank = 4; c.roster[2].spec = 'sharpshooter'; c.roster[2].kills = 9; c.roster[2].missions = 4;
  const r = D.makeDuckInfo('Dabs'); r.deploy = false; c.roster.push(r);
  D.ctx.save.campaign = c;
  D.app.show('barracks'); D.step(0.016, false); D.step(0.016, false);
});
check(await tap('car0') === 'disabled', 'with no points, promotion buttons are greyed out');
await page.evaluate(() => { const D = window.__duck; D.ctx.save.campaign.points = 4; D.app.show('barracks'); D.step(0.016, false); D.step(0.016, false); });
await page.screenshot({ path: `${out}/c1-barracks.png` });
check(await tap('car0') === 'ok', 'a Private with a point to spend can choose a career');
await page.screenshot({ path: `${out}/c2-choose-career.png` });
check(await tap('nsapper1') === 'ok', 'the career tree lets you pick a career');
await page.screenshot({ path: `${out}/c3-career-sapper.png` });
check(await tap('confirm') === 'ok', 'the choice can be confirmed');
let sq = await page.evaluate(() => { const c = window.__duck.ctx.save.campaign; return { rank: c.roster[0].rank, spec: c.roster[0].spec, points: c.points }; });
check(sq.rank === 2 && sq.spec === 'sapper' && sq.points === 3, 'Puddles is now a Sapper and a point is spent');
await page.screenshot({ path: `${out}/c4-promoted.png` });
await tap('back');
check(await tap('pr0') === 'ok', 'a duck with a career is promoted straight from the barracks');
sq = await page.evaluate(() => { const D = window.__duck, c = D.ctx.save.campaign; return { title: D.CLASSES.classTitle(c.roster[0].rank, c.roster[0].spec), points: c.points }; });
check(sq.title === 'Engineer' && sq.points === 2, 'Puddles is promoted to Engineer');
await tap('back');
check(await tap('pr2') === 'ok', 'two points buy an elite promotion');
sq = await page.evaluate(() => { const D = window.__duck, c = D.ctx.save.campaign; return { title: D.CLASSES.classTitle(c.roster[2].rank, c.roster[2].spec), points: c.points }; });
check(sq.title === 'Commando' && sq.points === 0, 'Mallory becomes a Commando');
await tap('e6');
await page.screenshot({ path: `${out}/c5-commando-tree.png` });
await tap('back');
await page.screenshot({ path: `${out}/c5b-barracks-spent.png` });
// the campaign map: regions to pick, the next mission's briefing
const mapInfo = await page.evaluate(() => {
  const D = window.__duck, p = D.scene.getObjectByName('menu').userData.panel;
  D.app.show('campaign'); D.step(0.016, false); D.step(0.016, false);
  // point at the middle of Pollard's Mill (mission 3's region) the way the mouse or laser would
  const M = D.campaignMap, c = M.centres[3];
  const hit = p.pick({ x: (26 + c.x) / p.w, y: 1 - (28 + c.y) / p.h });
  const sea = p.pick({ x: (26 + 300) / p.w, y: 1 - (28 + 4) / p.h });
  return { hit: hit?.id, sea: sea?.id || null, ready: M.ready };
});
check(mapInfo.ready && mapInfo.hit === 'rg3' && !mapInfo.sea?.startsWith?.('rg'), `pointing at a region picks that region, the sea picks nothing (${JSON.stringify(mapInfo)})`);
await page.screenshot({ path: `${out}/c6-map.png` });
check(await tap('rg9') === 'ok', 'a locked region can be inspected');
const locked = await tap('brief');
check(locked === 'disabled', 'a locked mission cannot be started');
await page.screenshot({ path: `${out}/c6b-map-locked.png` });
check(await tap('rg5') === 'ok' && await tap('brief') === 'ok', 'the next mission opens its briefing from the map');
const onBrief = await page.evaluate(() => !!window.__duck.scene.getObjectByName('menu').userData.panel.rects.find(r => r.id === 'go'));
check(onBrief, 'the briefing is up, ready to deploy');

// ------------------------------------------------------------------ battle: careers at level 3
await page.evaluate(() => { const D = window.__duck; D.stop(); D.app.startSkirmish({ biome: 'farm', enemy: 'teal', size: 4, rank: 4, hotseat: false, difficulty: 'veteran', seed: 4242 }); });
await advance(page, 5, 1 / 20, false);
await page.evaluate(() => {
  const D = window.__duck, b = D.battle, V = D.camera.position.constructor, T = b.terrain;
  window.__ai = b.makeAI; b.makeAI = () => null; b.ai = null; b.timer = Infinity;
  b.wind.set(0, 0, 0); b.windStrength = 0;
  const used = [];
  window.__t = {
    V,
    // flat, dry, open ground near (cx, cz), away from buildings and from spots already used
    flat(cx, cz, r = 4) {
      let best = null, bs = 1e9;
      for (let gx = -36; gx <= 36; gx += 3) for (let gz = -36; gz <= 36; gz += 3) {
        const x = cx + gx, z = cz + gz;
        if (Math.abs(x) > 62 || Math.abs(z) > 62) continue;
        const h = T.heightAt(x, z); if (h < 0.8) continue;
        if (b.W.pointInSolid(x, h + 0.6, z, r + 2)) continue;
        if (b.world.structures.items.some(s => s.alive && Math.hypot(s.x - x, s.z - z) < r + 8)) continue;
        if (used.some(u => Math.hypot(u.x - x, u.z - z) < 14)) continue;
        if (b.ducks.some(d => d.alive && Math.hypot(d.pos.x - x, d.pos.z - z) < 6)) continue;
        let s = 0; for (let k = -r; k <= r; k += 2) for (let j = -r; j <= r; j += 2) s += Math.abs(T.heightAt(x + k, z + j) - h);
        s += Math.hypot(gx, gz) * 0.03;
        if (s < bs) { bs = s; best = { x, z, y: h }; }
      }
      if (best) used.push(best);
      return best;
    },
    put(d, x, z, yaw = 0) { d.pos.set(x, b.W.supportHeight(x, z, T.heightAt(x, z) + 4), z); d.vel.set(0, 0, 0); d.state = 'idle'; d.yaw = yaw; d.chute = false; },
    act(d) { b.turnTeam = d.team.index; b.phase = 'act'; b.fired = false; b.moved = 0; b.timer = Infinity; b.wind.set(0, 0, 0); b.windStrength = 0; b.setActive(d); if (d.team.control === 'human') D.player.inhabit(d, { fade: false }); },
    run(sec, dt = 1 / 30) { for (let i = 0, n = Math.round(sec / dt); i < n; i++) { D.step(dt, true); if (b.phase !== 'act' && b.phase !== 'fired') b.phase = 'act'; } },
    booms: [],
  };
  const ex = b.explode.bind(b);
  b.explode = (x, y, z, def, owner, sc) => { window.__t.booms.push({ x, y, z, ground: Math.max(0, T.heightAt(x, z)), w: def.name, owner: owner?.branch }); return ex(x, y, z, def, owner, sc); };
});

const kit = await page.evaluate(() => {
  const b = window.__duck.battle;
  return b.teams[0].ducks.map(d => ({ name: d.name, branch: d.branch, rank: d.rank, hp: d.maxHp, perks: d.perks, ammo: Object.fromEntries(Object.entries(d.ammo).map(([k, v]) => [k, v === Infinity ? 'inf' : v])) }));
});
for (const k of kit) console.log(k.name, k.branch, k.rank, k.hp, JSON.stringify(k.ammo), JSON.stringify(k.perks));
const [hv, en, rc, md] = kit;
check(hv.branch === 'grenadier' && hv.ammo.bazooka === 'inf' && hv.ammo.airburst === 2 && hv.perks.blastMul === 1.2, 'Artillerist: endless bazooka, airburst shells, bigger blasts');
check(en.branch === 'sapper' && en.ammo.shotgun === 'inf' && en.ammo.tnt === 3 && en.ammo.sandbags === 2 && en.perks.hiddenMines && en.perks.knockRes === 0.3, 'Saboteur: shotgun, TNT, sandbags, hidden mines, steady on its feet');
check(rc.branch === 'sharpshooter' && rc.ammo.sniper === 'inf' && rc.ammo.homing === 2 && rc.ammo.camo === 3 && rc.perks.speedMul === 1.45, 'Infiltrator: sniper, homing gulls, camouflage, quick');
check(md.branch === 'medic' && md.ammo.medkit === 4 && md.ammo.medidart === 4 && md.perks.regen === 8 && md.perks.healSplash === 15, 'Surgeon: medkits, medicine darts, heals every turn');

// camouflage: a free action; the computer can't pick out hidden ducks
const camo = await page.evaluate(() => {
  const D = window.__duck, b = D.battle, H = window.__t, V = H.V, d = b.teams[0].ducks[2];
  const s = H.flat(-20, 20); H.put(d, s.x, s.z, 0.3); H.act(d);
  b.setWeapon('camo');
  const before = d.ammo.camo;
  const ok = b.fire({ weapon: 'camo', origin: d.pos.clone(), dir: new V(0, 0, 1) });
  const r = { ok, camo: d.camo, used: before - d.ammo.camo, phase: b.phase, fired: b.fired, transparent: !!d.mesh.material.transparent, weaponAfter: d.weapon };
  // all of our ducks hide: the computer finds nobody to shoot
  for (const p of b.teams[0].ducks) b.setCamo(p, true);
  const e = b.teams[1].ducks[0];
  H.act(e);
  const ai = window.__ai(b, b.teams[1]);
  const gen = ai.plan(); let res; do { res = gen.next(); } while (!res.done);
  r.ai = res.value ? { kind: res.value.kind, target: res.value.target?.name || null } : null;
  for (const p of b.teams[0].ducks) if (p !== d) b.setCamo(p, false);
  // two of our turns later it wears off
  b.turnTeam = 1; b.phase = 'between'; b.beginTurn(); r.after1 = d.camo;
  b.turnTeam = 1; b.phase = 'between'; b.beginTurn(); r.after2 = d.camo;
  // shooting gives you away
  H.act(d); b.setCamo(d, true); b.setWeapon('rifle');
  b.fire({ weapon: 'rifle', origin: d.pos.clone().setY(d.pos.y + 1.4), dir: new V(Math.sin(d.yaw), 0, Math.cos(d.yaw)) });
  r.afterShot = d.camo;
  H.run(2);
  return r;
});
console.log('camo', JSON.stringify(camo));
check(camo.ok && camo.camo && camo.used === 1 && camo.phase === 'act' && !camo.fired && camo.transparent, 'camouflage is a free action that fades the duck out');
check(!camo.ai || (camo.ai.kind !== 'ballistic' && !camo.ai.target), `the computer can’t target camouflaged ducks (${JSON.stringify(camo.ai)})`);
check(camo.after1 && !camo.after2, 'camouflage lasts until your second turn after');
check(!camo.afterShot, 'firing breaks camouflage');

// sandbags: an Engineer builds cover in front of itself without ending the turn
const bags = await page.evaluate(() => {
  const b = window.__duck.battle, H = window.__t, V = H.V, d = b.teams[0].ducks[1];
  const s = H.flat(-15, -15); H.put(d, s.x, s.z, 0.6); H.act(d);
  const n0 = b.world.structures.items.length;
  const fx = s.x + Math.sin(0.6) * 2, fz = s.z + Math.cos(0.6) * 2, fy = b.terrain.heightAt(fx, fz) + 0.35;
  const solid0 = b.W.pointInSolid(fx, fy, fz, 0.1);
  b.setWeapon('sandbags');
  const ok = b.fire({ weapon: 'sandbags', origin: d.pos.clone(), dir: new V(Math.sin(0.6), 0, Math.cos(0.6)) });
  const solid1 = b.W.pointInSolid(fx, fy, fz, 0.1);
  return { ok, added: b.world.structures.items.length - n0, solid0, solid1, phase: b.phase, left: d.ammo.sandbags, weapon: d.weapon };
});
console.log('sandbags', JSON.stringify(bags));
check(bags.ok && bags.added === 1 && !bags.solid0 && bags.solid1 && bags.phase === 'act', 'an Engineer builds a solid sandbag wall without ending the turn');
await page.evaluate(() => { const D = window.__duck; D.player.pitch = -0.32; window.__t.run(0.5); });
await render('c6-sandbags-fp');

// shotgun: seven pellets at once
const sg = await page.evaluate(() => {
  const b = window.__duck.battle, H = window.__t, V = H.V, d = b.teams[0].ducks[1], e = b.teams[1].ducks[0];
  const s = H.flat(20, -25); H.put(d, s.x, s.z, 0); H.put(e, s.x, s.z + 6, Math.PI); H.act(d);
  b.setWeapon('shotgun');
  const hp0 = e.hp, n0 = b.projectiles.length;
  const o = new V(d.pos.x, d.pos.y + 1.3, d.pos.z + 0.4);
  const dir = new V(e.pos.x, e.pos.y + 1.0, e.pos.z).sub(o).normalize();
  b.fire({ weapon: 'shotgun', origin: o, dir });
  const pellets = b.projectiles.length - n0;
  H.run(1.5);
  return { pellets, dmg: hp0 - e.hp, endless: d.ammo.shotgun === Infinity };
});
console.log('shotgun', JSON.stringify(sg));
check(sg.pellets === 7 && sg.dmg >= 36 && sg.endless, `the shotgun fires 7 pellets and hits hard up close (${sg.dmg} damage)`);
const sgFar = await page.evaluate(() => {
  const b = window.__duck.battle, H = window.__t, V = H.V, d = b.teams[0].ducks[1], e = b.teams[1].ducks[0];
  const s = H.flat(-30, 0, 3); H.put(d, s.x, s.z, 0); H.put(e, s.x, s.z + 45, Math.PI); H.act(d);
  b.setWeapon('shotgun');
  const hp0 = e.hp;
  const o = new V(d.pos.x, d.pos.y + 1.3, d.pos.z + 0.4);
  b.fire({ weapon: 'shotgun', origin: o, dir: new V(e.pos.x, e.pos.y + 1.0, e.pos.z).sub(o).normalize() });
  H.run(1.5);
  return { dmg: hp0 - e.hp };
});
check(sgFar.dmg === 0, 'shotgun pellets fall short at 45 m');

// medicine dart: heal a squadmate from afar
const dart = await page.evaluate(() => {
  const b = window.__duck.battle, H = window.__t, V = H.V, d = b.teams[0].ducks[3], mate = b.teams[0].ducks[0], foe = b.teams[1].ducks[3];
  const s = H.flat(25, 20); H.put(d, s.x, s.z, 0); H.put(mate, s.x, s.z + 12, Math.PI); H.act(d);
  mate.hp = 40;
  b.setWeapon('medidart');
  const aim = (t) => { const o = new V(d.pos.x, d.pos.y + 1.3, d.pos.z + 0.4); return { o, dir: new V(t.pos.x, t.pos.y + 1.0, t.pos.z).sub(o).normalize() }; };
  let a = aim(mate); b.fire({ weapon: 'medidart', origin: a.o, dir: a.dir });
  const healed = mate.hp;
  H.run(2.5);
  H.put(foe, s.x + 3, s.z + 12, Math.PI); H.act(d);
  const f0 = foe.hp; a = aim(foe); b.fire({ weapon: 'medidart', origin: a.o, dir: a.dir });
  const stung = f0 - foe.hp;
  H.run(2.5);
  return { healed, stung, left: d.ammo.medidart };
});
console.log('dart', JSON.stringify(dart));
check(dart.healed === 70 && dart.stung > 0 && dart.stung < 10, 'a medicine dart heals a squadmate 30 and only stings an enemy');

// regeneration at the start of your turn, and medkit splash
const regen = await page.evaluate(() => {
  const b = window.__duck.battle, H = window.__t, d = b.teams[0].ducks[3], mate = b.teams[0].ducks[0];
  d.hp = d.maxHp - 30;
  b.turnTeam = 1; b.phase = 'between'; b.beginTurn();
  const r = { regen: d.hp - (d.maxHp - 30) };
  const s = H.flat(-5, 35); H.put(d, s.x, s.z, 0); H.put(mate, s.x + 2, s.z, 0); H.act(d);
  d.hp = d.maxHp - 60; mate.hp = 50;
  b.setWeapon('medkit');
  b.fire({ weapon: 'medkit', origin: d.pos.clone(), dir: new H.V(0, 0, 1), targetDuck: d });
  r.self = d.hp - (d.maxHp - 60); r.splash = mate.hp - 50;
  H.run(2.5);
  return r;
});
console.log('regen', JSON.stringify(regen));
check(regen.regen === 8 && regen.self >= 45 && regen.splash === 15, 'a Surgeon heals 8 a turn and its medkit splashes 15 onto squadmates');

// knockback resistance and bigger blasts
const kb = await page.evaluate(() => {
  const b = window.__duck.battle, H = window.__t, V = H.V, P = b.teams[0].ducks, E = b.teams[1].ducks;
  const s = H.flat(35, -5, 3), r = {};
  for (const i of [0, 1]) { const d = P[i]; H.put(d, s.x + i * 8, s.z); const hp = d.hp; b.damageDuck(d, 1, null, new V(6, 6, 0)); r[d.branch] = d.vel.length(); d.hp = hp; }
  H.run(2.5);
  // the same blast from a Heavy Weapons duck and from a medic
  const t = E[3], s2 = H.flat(-35, -30, 3); H.put(t, s2.x, s2.z); H.put(P[0], s2.x - 30, s2.z); H.put(P[3], s2.x + 30, s2.z);
  const def = { name: 'test', radius: 5, dmg: 40, crater: 0, knock: 0.01 };
  const hp0 = t.hp; b.explode(s2.x + 2, t.pos.y + 0.5, s2.z, def, P[0]); r.heavy = hp0 - t.hp; t.hp = hp0;
  H.run(1.5); H.put(t, s2.x, s2.z);
  b.explode(s2.x + 2, t.pos.y + 0.5, s2.z, def, P[3]); r.plain = hp0 - t.hp; t.hp = hp0;
  H.run(1.5);
  return r;
});
console.log('knock', JSON.stringify(kb));
check(Math.abs(kb.sapper / kb.grenadier - 0.7) < 0.01, 'an Engineer shrugs off 30% of knockback');
check(kb.heavy > kb.plain && Math.abs(kb.heavy / kb.plain - 1.2) < 0.06, `Heavy Weapons explosions hit 20% harder (${kb.heavy} vs ${kb.plain})`);

// airburst shells burst in the air over the target
const ab = await page.evaluate(() => {
  const b = window.__duck.battle, H = window.__t, V = H.V, d = b.teams[0].ducks[0], e = b.teams[1].ducks[2];
  const s = H.flat(10, 40, 3); H.put(d, s.x, s.z - 14, 0); H.put(e, s.x, s.z + 14, Math.PI); H.act(d);
  b.setWeapon('airburst');
  H.booms.length = 0;
  const pitch = 0.95, o = new V(d.pos.x, d.pos.y + 1.5, d.pos.z + 0.5);
  b.fire({ weapon: 'airburst', origin: o, dir: new V(0, Math.sin(pitch), Math.cos(pitch)), power: 0.18 });
  H.run(7);
  return { booms: H.booms.slice(), left: d.ammo.airburst };
});
console.log('airburst', JSON.stringify(ab));
check(ab.booms.length === 1 && ab.booms[0].y - ab.booms[0].ground > 2, 'an airburst shell explodes in mid-air');

// TNT: a heavy charge on a long fuse
const tnt = await page.evaluate(() => {
  const b = window.__duck.battle, H = window.__t, V = H.V, d = b.teams[0].ducks[1];
  const s = H.flat(-40, 40, 3); H.put(d, s.x, s.z, 0); H.act(d);
  b.setWeapon('tnt');
  H.booms.length = 0;
  b.fire({ weapon: 'tnt', origin: new V(d.pos.x, d.pos.y + 1.4, d.pos.z + 0.4), dir: new V(0, 0.6, 0.8).normalize(), power: 0.5 });
  const p = b.projectiles[b.projectiles.length - 1];
  const r = { kind: p.kind, model: p.mesh.geometry === b.geo.p_tnt };
  let t = 0; while (!H.booms.length && t < 8) { H.run(0.25); t += 0.25; }
  r.fuse = t; r.booms = H.booms.slice(); r.dist = H.booms[0] ? Math.hypot(H.booms[0].x - s.x, H.booms[0].z - s.z) : 0;
  H.run(2);
  return r;
});
console.log('tnt', JSON.stringify(tnt));
check(tnt.kind === 'grenade' && tnt.model && tnt.booms.length === 1 && tnt.fuse >= 3.5 && tnt.dist > 4, 'TNT is thrown and goes off after its fuse');

// hidden mines: invisible to the other side unless close, or spotted by an elite
const mines = await page.evaluate(() => {
  const D = window.__duck, b = D.battle, H = window.__t, V = H.V, d = b.teams[0].ducks[1], e = b.teams[1].ducks[1];
  const s = H.flat(40, 40, 3); H.put(d, s.x, s.z, 0); H.act(d);
  b.setWeapon('mine');
  b.fire({ weapon: 'mine', origin: d.pos.clone(), dir: new V(0, 0, 1) });
  const m = b.mines[b.mines.length - 1];
  b.update(0.001);
  const r = { hidden: m.hidden, own: m.mesh.visible };
  const P = D.player, keep = P.duck;
  H.put(e, m.x + 14, m.z, 0); P.duck = e; b.update(0.001); r.far = m.mesh.visible;
  H.put(e, m.x + 2.5, m.z, 0); b.update(0.001); r.near = m.mesh.visible;
  H.put(e, m.x + 14, m.z, 0); const pk = e.perks; e.perks = D.CLASSES.perksFor(5, 'sapper'); b.update(0.001); r.elite = m.mesh.visible; e.perks = pk;
  // the computer plans paths straight over mines it can't see, but not over its own side's
  const ai = window.__ai(b, b.teams[1]);
  H.put(e, m.x - 6, m.z, 0);
  r.aiPath = !!ai.validPos(e, m.x + 6, m.z);
  m.hidden = false; r.aiPathSeen = !!ai.validPos(e, m.x + 6, m.z); m.hidden = true;
  P.duck = keep;
  m.alive = false; b.group.remove(m.mesh);
  H.run(2);
  return r;
});
console.log('mines', JSON.stringify(mines));
check(mines.hidden && mines.own && !mines.far && mines.near && mines.elite, 'an Engineer’s mines are hidden from enemies until they are close or an elite spots them');
check(mines.aiPath && !mines.aiPathSeen, 'the computer walks into hidden mines it doesn’t know about but avoids visible ones');

// jetpack: a free hop across the battlefield
const jp = await page.evaluate(() => {
  const D = window.__duck, b = D.battle, H = window.__t, V = H.V, d = b.teams[0].ducks[2];
  const s = H.flat(-45, -45, 3); H.put(d, s.x, s.z, 0); H.act(d);
  d.ammo.jetpack = 1; b.setWeapon('jetpack');
  const tgt = new V(s.x + 5, 0, s.z + 16); tgt.y = b.terrain.heightAt(tgt.x, tgt.z);
  const hp = d.hp;
  const ok = b.fire({ weapon: 'jetpack', origin: d.pos.clone(), dir: new V(0, 0, 1), target: tgt });
  const air = d.state === 'air';
  let rise = 0, i = 0;
  for (; i < 200; i++) { D.step(1 / 30, true); rise = Math.max(rise, d.pos.y - s.y); if (d.state !== 'air' && i > 5) break; }
  return { ok, air, state: d.state, miss: Math.hypot(d.pos.x - tgt.x, d.pos.z - tgt.z), hp0: hp, hp: d.hp, phase: b.phase, rise, secs: i / 30, weapon: d.weapon };
});
console.log('jetpack', JSON.stringify(jp));
check(jp.ok && jp.air && jp.state !== 'air' && jp.miss < 1.5 && jp.hp === jp.hp0 && jp.phase === 'act', `a jetpack hop lands on target unhurt and the turn goes on (missed by ${jp.miss.toFixed(2)} m)`);

// paradrop: dropped from a plane anywhere on the map, floating down under a canopy
const pd = await page.evaluate(() => {
  const D = window.__duck, b = D.battle, H = window.__t, V = H.V, d = b.teams[0].ducks[0];
  const s = H.flat(45, -45, 3); H.act(d);
  d.ammo.paradrop = 1; b.setWeapon('paradrop');
  const hp = d.hp;
  const ok = b.fire({ weapon: 'paradrop', origin: d.pos.clone(), dir: new V(0, 0, 1), target: new V(s.x, s.y, s.z) });
  const startH = d.pos.y - s.y;
  H.run(1.6);
  D.player.pitch = -0.7;
  return { ok, startH, chute: !!b.chute?.visible, mid: d.pos.y - s.y, vy: d.vel.y, hp0: hp, s };
});
await advance(page, 0.2, 1 / 30);
await page.screenshot({ path: `${out}/c7-paradrop-fp.png` });
const pd2 = await page.evaluate((s) => {
  const D = window.__duck, b = D.battle, H = window.__t, d = b.teams[0].ducks[0];
  let t = 0; while (d.state === 'air' && t < 15) { H.run(0.25); t += 0.25; }
  return { t, state: d.state, hp: d.hp, chuteAfter: !!b.chute?.visible, miss: Math.hypot(d.pos.x - s.x, d.pos.z - s.z), phase: b.phase };
}, pd.s);
console.log('paradrop', JSON.stringify(pd), JSON.stringify(pd2));
check(pd.ok && pd.startH > 15 && pd.chute && pd.vy >= -3.3, 'a paradrop starts high under an open canopy, falling slowly');
check(pd2.state !== 'air' && pd2.hp === pd.hp0 && !pd2.chuteAfter && pd2.miss < 6 && pd2.phase === 'act', 'the duck lands unhurt near the drop point and can still act');

// the computer plays a turn with the new kit without errors (its Infiltrator may hide)
const aiTurn = await page.evaluate(() => {
  const D = window.__duck, b = D.battle;
  b.makeAI = window.__ai;
  for (const d of b.ducks) if (d.camo) b.setCamo(d, false);
  b.turnTeam = 0; b.phase = 'between'; b.timer = 45;
  b.beginTurn();
  const team = b.team.name;
  let t = 0; while (t < 60 && b.team?.control === 'ai' && b.phase !== 'over') { for (let i = 0; i < 15; i++) D.step(1 / 30, true); t += 0.5; }
  return { team, t, phase: b.phase, next: b.team?.name };
});
console.log('ai turn', JSON.stringify(aiTurn));
check(aiTurn.t < 60, 'the computer finishes its turn');

console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'all passed');
await T.close();
process.exit(fails || errors.length ? 1 : 0);
