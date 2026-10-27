// Photos of every career's look: helmet stripes, armbands, kit, elite headgear; plus the abilities in use.
import { launch, advance } from './lib.mjs';
const out = process.argv[2] || '/tmp/claude-0/shots';
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const T = await launch({ port: 8787, w: 1100, h: 620 });
const { page, errors } = T;
await page.click('#play');
await advance(page, 1, 1 / 30, false);

// a battle whose squad holds one duck of every rank and career
await page.evaluate(() => {
  const D = window.__duck, C = D.CLASSES;
  const cfg = D.skirmishBattle({ biome: 'farm', enemy: 'teal', size: 4, rank: 2, seed: 777, difficulty: 'veteran' });
  const mk = (name, rank, spec) => ({ id: 'p' + name, name, rank, spec, xp: 0, maxHp: C.hpFor(rank, spec), ammo: C.loadoutFor(rank, spec) });
  cfg.teams[0].ducksInfo = [
    mk('Recruit', 1, 'none'), mk('Gunner', 2, 'grenadier'), mk('Sapper', 2, 'sapper'), mk('Scout', 2, 'sharpshooter'), mk('Orderly', 2, 'medic'),
    mk('Artillerist', 4, 'grenadier'), mk('Saboteur', 4, 'sapper'), mk('Infiltrator', 4, 'sharpshooter'), mk('Surgeon', 4, 'medic'),
    mk('Commando', 5, 'sapper'), mk('Hero', 6, 'medic'), mk('Legend', 7, 'grenadier'),
  ];
  D.stop(); D.startBattle(cfg);
});
await advance(page, 5, 1 / 20, false);

const stage = async (name, poses, cam = { dist: 4.4, h: 1.35, side: 0.5, look: 1.0 }) => {
  await page.evaluate(({ poses, cam }) => {
    const D = window.__duck, b = D.battle, P = D.player, mine = b.teams[0].ducks;
    P.inBattle = false; P.handWeapon.visible = false; P.crosshair.visible = false;
    if (!window.__hudVis) { window.__hudVis = {}; for (const k in D.ctx.hud) window.__hudVis[k] = D.ctx.hud[k].panel.mesh.visible; }
    for (const k in D.ctx.hud) D.ctx.hud[k].panel.mesh.visible = false;
    b.tags.mesh.visible = !!cam.tags;
    b.ducks.forEach(d => { d.mesh.visible = false; d.setFirstPerson(false); d.mesh.visible = false; });
    if (!window.__base) {
      const T = b.terrain, p0 = mine[0].pos;
      let best = null, bestS = 1e9;
      for (let gx = -16; gx <= 16; gx += 2) for (let gz = -16; gz <= 16; gz += 2) {
        const x = p0.x + gx, z = p0.z + gz, h = T.heightAt(x, z);
        if (h < 0.6) continue;
        let s2 = 0; for (let k = -4; k <= 4; k++) for (const dz of [0, 3]) s2 += Math.abs(T.heightAt(x + k, z + dz) - h);
        if (s2 < bestS && !b.W.pointInSolid(x, h + 0.5, z, 4)) { bestS = s2; best = { x, z, h }; }
      }
      window.__base = best;
    }
    const base = window.__base, n = poses.length;
    poses.forEach((p, i) => {
      const d = mine.find(m => m.info.name === p.duck);
      const x = base.x + (i - (n - 1) / 2) * (cam.gap || 1.45) + (p.dx || 0), z = base.z + (p.dz || 0);
      d.pos.set(x, b.W.supportHeight(x, z, base.h + 3) + (p.lift || 0), z); d.mesh.visible = true;
      d.yaw = p.yaw || 0; d.state = p.state || 'idle'; d.jumping = !!p.jumping;
      const keep = b.active; b.active = d; d.weapon = p.weapon || 'slap'; b.refreshWeapon(); b.active = keep;
      d.anim.aiming = p.aim || 0; d.anim.aimPitch = p.pitch || 0; d.anim.salute = p.salute || 0; d.anim.cheer = p.cheer || 0;
      if (p.camo) b.setCamo(d, true); else if (d.camo) b.setCamo(d, false);
      if (p.chute) { d.chute = true; b.showChute(d, true); b.chute.visible = true; b.chute.position.copy(d.pos); b.chute.rotation.y = d.yaw; }
    });
    if (!poses.some(p => p.chute) && b.chute) b.chute.visible = false;
    for (let k = 0; k < 40; k++) for (const p of poses) mine.find(m => m.info.name === p.duck).animate(1 / 30);
    b.tags.update(b.ducks, D.camera.getWorldPosition(D.camera.position.clone()));
    const cx = base.x + cam.side * cam.dist, cz = base.z + cam.dist;
    D.rig.position.set(cx, base.h + cam.h, cz);
    D.rig.rotation.set(0, Math.atan2(cx - base.x, cz - base.z), 0);
    D.camera.position.set(0, 0, 0);
    D.camera.rotation.set(-Math.atan2(cam.h - cam.look, Math.hypot(cam.side * cam.dist, cam.dist)), 0, 0);
  }, { poses, cam });
  await page.evaluate(() => { const D = window.__duck; D.ctx.world.update(0.0001, D.ctx.time, D.camera.getWorldPosition(D.camera.position.clone())); D.battle.tags.update(D.battle.ducks, D.camera.getWorldPosition(D.camera.position.clone())); D.renderer.render(D.scene, D.camera); });
  await page.screenshot({ path: `${out}/${name}.png` });
};

await stage('k1-careers-level1', [
  { duck: 'Gunner', weapon: 'mortar' }, { duck: 'Sapper', weapon: 'mine' },
  { duck: 'Scout', weapon: 'sniper' }, { duck: 'Orderly', weapon: 'medkit' },
], { dist: 4.6, h: 1.35, side: 0.45, look: 1.0, tags: true });
await stage('k2-careers-level3', [
  { duck: 'Artillerist', weapon: 'airburst', aim: 1, pitch: 0.5 }, { duck: 'Saboteur', weapon: 'shotgun', aim: 1, pitch: 0.05 },
  { duck: 'Infiltrator', weapon: 'homing' }, { duck: 'Surgeon', weapon: 'medidart', aim: 1, pitch: 0.1 },
], { dist: 4.6, h: 1.35, side: 0.45, look: 1.0, tags: true });
await stage('k3-recruit-and-elites', [
  { duck: 'Recruit', weapon: 'grenade' }, { duck: 'Commando', weapon: 'jetpack' },
  { duck: 'Hero', salute: 2 }, { duck: 'Legend', weapon: 'bazooka' },
], { dist: 4.6, h: 1.35, side: 0.45, look: 1.0, tags: true });
await stage('k4-backs', [
  { duck: 'Artillerist', yaw: Math.PI }, { duck: 'Saboteur', yaw: Math.PI },
  { duck: 'Infiltrator', yaw: Math.PI }, { duck: 'Surgeon', yaw: Math.PI },
], { dist: 4.4, h: 1.5, side: 0.35, look: 1.0 });
await stage('k5-closeup-elites', [
  { duck: 'Commando', yaw: 0.3 }, { duck: 'Hero', yaw: 0 }, { duck: 'Legend', yaw: -0.3 },
], { dist: 2.6, h: 1.55, side: 0.25, look: 1.45, gap: 0.95 });
await stage('k6-abilities', [
  { duck: 'Infiltrator', camo: true, weapon: 'sniper', aim: 1, pitch: 0.02 }, { duck: 'Scout', weapon: 'camo' },
  { duck: 'Commando', chute: true, lift: 3.2, state: 'air', jumping: true, weapon: 'bazooka' }, { duck: 'Saboteur', weapon: 'sandbags' },
], { dist: 8.6, h: 2.8, side: 0.4, look: 3.3 });

// first person with the hand-held class kit
await page.evaluate(() => {
  const D = window.__duck, b = D.battle, P = D.player;
  for (const k in D.ctx.hud) D.ctx.hud[k].panel.mesh.visible = window.__hudVis[k];
  P.inBattle = true; b.tags.mesh.visible = true; P.crosshair.visible = true;
  if (b.chute) b.chute.visible = false;
  // spread the squad out in a row behind the camera so nobody stands inside anybody else
  const base = window.__base;
  b.ducks.forEach((d, i) => {
    d.mesh.visible = d.alive; d.chute = false; d.state = 'idle'; if (d.camo) b.setCamo(d, false);
    if (d.team !== b.teams[0]) return;
    const x = base.x + (i - 6) * 1.6, z = base.z - 3;
    d.pos.set(x, b.W.supportHeight(x, z, base.h + 3), z); d.yaw = 0;
  });
  window.__fpSpot = { x: base.x, z: base.z + 1.5 };
  b.phase = 'act'; b.timer = Infinity; b.fired = false; b.moved = 0; b.turnTeam = 0;
});
for (const [duck, w, pitch] of [['Saboteur', 'tnt', -0.15], ['Surgeon', 'medidart', -0.05], ['Saboteur', 'shotgun', -0.05], ['Commando', 'jetpack', -0.2]]) {
  await page.evaluate(({ duck, w, pitch }) => {
    const D = window.__duck, b = D.battle, d = b.teams[0].ducks.find(m => m.info.name === duck), sp = window.__fpSpot;
    for (const o of b.teams[0].ducks) if (o !== d && Math.hypot(o.pos.x - sp.x, o.pos.z - sp.z) < 1) o.pos.z -= 3;
    d.pos.set(sp.x, b.W.supportHeight(sp.x, sp.z, window.__base.h + 3), sp.z); d.yaw = 0.5;
    b.setActive(d); D.player.inhabit(d, { fade: false }); D.player.yaw = 0.5; b.setWeapon(w); D.player.pitch = pitch;
    if (D.ctx.hud.banner) D.ctx.hud.banner.t = 0;
  }, { duck, w, pitch });
  await advance(page, 0.6, 1 / 30);
  await page.screenshot({ path: `${out}/k7-fp-${w}.png` });
}
console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
await T.close();
