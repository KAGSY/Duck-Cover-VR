// Photo set of the humanoid ducks: menu line-up, weapon holds, gestures, close-up.
import { launch, advance } from './lib.mjs';
const out = process.argv[2] || '/tmp/claude-0/shots';
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const T = await launch({ port: 8779, w: 1100, h: 620 });
const { page, errors } = T;
await page.click('#play');
await advance(page, 2.5, 1 / 30, false);
await page.evaluate(() => { const D = window.__duck; D.app.hideMenu(); });
await advance(page, 0.9, 1 / 30);
await page.evaluate(() => { const D = window.__duck; D.rig.rotation.y = -1.25; D.camera.rotation.set(-0.08, 0, 0); D.renderer.render(D.scene, D.camera); });
await page.screenshot({ path: `${out}/d0-menu-squad.png` });

await page.evaluate(() => { const D = window.__duck; D.stop(); D.ctx.save.campaign = D.newCampaign(); D.ctx.save.campaign.unlocked = 12; D.app.startMission(D.MISSIONS[1]); });
await advance(page, 5, 1 / 20, false);

// stage: pose four ducks on flat ground in front of a photo camera
const stage = async (name, poses, cam = { dist: 4.2, h: 1.35, side: 0.55, look: 1.0 }) => {
  await page.evaluate(({ poses, cam }) => {
    const D = window.__duck, b = D.battle, P = D.player;
    P.inBattle = false; P.handWeapon.visible = false; P.crosshair.visible = false;
    for (const k in D.ctx.hud) D.ctx.hud[k].panel.mesh.visible = false;
    b.tags.mesh.visible = false;
    // everyone not in the photo stands well away
    b.ducks.forEach((d, i) => { if (i >= poses.length) d.mesh.visible = false; });
    const ducks = b.ducks.filter(d => d.alive);
    if (!window.__base) {
      const T = b.terrain, p0 = ducks[0].pos;
      let best = null, bestS = 1e9;
      for (let gx = -12; gx <= 12; gx += 2) for (let gz = -12; gz <= 12; gz += 2) {
        const x = p0.x + gx, z = p0.z + gz, h = T.heightAt(x, z);
        if (h < 0.6) continue;
        let s2 = 0; for (let k = -3; k <= 3; k++) for (const dz of [0, 3]) s2 += Math.abs(T.heightAt(x + k, z + dz) - h);
        if (s2 < bestS && !b.W.pointInSolid(x, h + 0.5, z, 3)) { bestS = s2; best = { x, z, h }; }
      }
      window.__base = new D.THREE.PerspectiveCamera().position.set(best.x, best.h, best.z);
    }
    const base = window.__base;
    const yaw0 = 0.0;
    const n = poses.length;
    poses.forEach((p, i) => {
      const d = ducks[i];
      const x = base.x + (i - (n - 1) / 2) * 1.5, z = base.z;
      d.pos.set(x, b.W.supportHeight(x, z, base.y + 3), z); d.mesh.visible = true;
      d.yaw = yaw0 + (p.yaw || 0);
      d.state = p.state || 'idle';
      d.jumping = !!p.jumping;
      d.weapon = p.weapon || 'slap';
      d.showWeapon(p.weapon && p.weapon !== 'slap' ? (b.getGeo('w_' + p.weapon, () => null) || null) : null, p.weapon);
      if (p.weapon && p.weapon !== 'slap' && !d.weaponMesh) b.active = d, b.refreshWeapon();
      if (p.weapon && p.weapon !== 'slap') { d.weapon = p.weapon; const keep = b.active; b.active = d; b.refreshWeapon(); b.active = keep; }
      d.anim.aiming = p.aim || 0; d.anim.aimPitch = p.pitch || 0;
      d.anim.cheer = p.cheer || 0; d.anim.salute = p.salute || 0; d.anim.throwT = p.throwT || 0; d.anim.slapT = p.slapT || 0;
      d.setFirstPerson(false);
    });
    for (let k = 0; k < 40; k++) for (let i = 0; i < n; i++) {
      const d = ducks[i], p = poses[i];

      if (p.throwT && k === 40 - Math.round(p.throwStop * 30)) { /* freeze mid-throw */ }
      if (p.freeze && k >= 40 - p.freeze) continue;
      d.animate(1 / 30);
    }
    const cx = base.x + cam.side * cam.dist, cz = base.z + cam.dist;
    D.rig.position.set(cx, base.y + cam.h, cz);
    D.rig.rotation.set(0, Math.atan2(cx - base.x, cz - base.z), 0);
    D.camera.position.set(0, 0, 0);
    D.camera.rotation.set(-Math.atan2(cam.h - cam.look, Math.hypot(cam.side * cam.dist, cam.dist)), 0, 0);
  }, { poses, cam });
  await page.evaluate(() => { const D = window.__duck; D.ctx.world.update(0.0001, D.ctx.time, D.camera.getWorldPosition(D.camera.position.clone())); D.renderer.render(D.scene, D.camera); });
  await page.screenshot({ path: `${out}/${name}.png` });
};
await stage('d1-launchers', [
  { weapon: 'bazooka', aim: 1, pitch: 0.25 }, { weapon: 'mortar', aim: 1, pitch: 0.8 },
  { weapon: 'cluster' }, { weapon: 'homing', aim: 1, pitch: 0.1 },
]);
await stage('d2-rifles-hand', [
  { weapon: 'rifle', aim: 1, pitch: 0.05 }, { weapon: 'sniper' },
  { weapon: 'grenade', aim: 1 }, { weapon: 'airstrike', aim: 1 },
]);
await stage('d3-gestures', [
  { salute: 3 }, { cheer: 3 }, { state: 'walk', weapon: 'bazooka' }, { weapon: 'medkit', aim: 1 },
]);
await stage('d4-action', [
  { weapon: 'grenade', throwT: 0.45, freeze: 0 }, { weapon: 'slap', slapT: 0.4 }, { state: 'air', jumping: true }, { state: 'air' },
]);
await stage('d5-closeup', [{ weapon: 'rifle' }, { salute: 3 }], { dist: 1.6, h: 1.6, side: 0.35, look: 1.45 });
await stage('d6-back', [{ weapon: 'bazooka', yaw: Math.PI * 0.8 }, { weapon: 'rifle', yaw: Math.PI }], { dist: 2.6, h: 1.4, side: -0.4, look: 1.1 });
console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
await T.close();
