// Ground-level + aerial photos of each biome.
import { launch, advance } from './lib.mjs';
const out = process.argv[2] || '/tmp/claude-0/shots';
const list = (process.env.MISSIONS || '3,5,7,9,12').split(',').map(Number);
const T = await launch({ port: 8777, w: 1000, h: 560 });
const { page, errors } = T;
await page.evaluate(() => document.getElementById('play').click());
for (const m of list) {
  await page.evaluate((m) => { const D = window.__duck; D.stop(); D.ctx.save.campaign = D.newCampaign(); D.ctx.save.campaign.unlocked = 12; D.app.startMission(D.MISSIONS[m - 1]); }, m);
  await advance(page, 5, 1 / 20, false);
  // ground view toward enemies
  await page.evaluate(() => { const D = window.__duck, b = D.battle, me = D.player.duck; const e = b.ducks.find(d => d.team !== me.team) || { pos: { x: 0, z: 0 } }; D.player.yaw = Math.atan2(e.pos.x - me.pos.x, e.pos.z - me.pos.z) + 0.3; D.player.pitch = -0.05; });
  await advance(page, 0.05);
  await page.screenshot({ path: `${out}/g-${m}-ground.png` });
  await page.evaluate(() => { const D = window.__duck; D.player.inBattle = false; D.player.handWeapon.visible = false; D.rig.position.set(-60, 55, 60); D.rig.rotation.set(0, -Math.PI / 4, 0); D.camera.position.set(0, 0, 0); D.camera.rotation.set(-0.55, 0, 0); D.step(0.0001, false); });
  await page.screenshot({ path: `${out}/g-${m}-air.png` });
}
console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
await T.close();
