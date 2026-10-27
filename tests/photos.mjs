import { launch, advance, shot } from './lib.mjs';
const out = process.argv[2] || '/tmp/claude-0/shots';
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const mission = Number(process.env.MISSION || 2);
const T = await launch({ port: 8773 });
const { page, errors } = T;
await page.click('#play');
await page.evaluate((m) => { const D = window.__duck; D.stop(); D.ctx.save.campaign = D.newCampaign(); D.ctx.save.campaign.unlocked = 12; D.app.startMission(D.MISSIONS[m - 1]); }, mission);
await advance(page, 5, 1 / 20, false);
// look at a squadmate up close
await page.evaluate(() => { const D = window.__duck, b = D.battle, me = D.player.duck; const f = b.ducks.find(d => d.team === me.team && d !== me); D.player.yaw = Math.atan2(f.pos.x - me.pos.x, f.pos.z - me.pos.z); D.player.pitch = -0.12; });
await advance(page, 0.05);
await shot(page, `${out}/p1-squadmate.png`);
// overview from above
await page.evaluate(() => { const D = window.__duck; D.player.inBattle = false; D.rig.position.set(-20, 70, 60); D.rig.rotation.set(0, 0, 0); D.camera.position.set(0, 0, 0); D.camera.rotation.set(-0.75, 0, 0); });
await page.evaluate(() => window.__duck.step(0.0001, false));
await page.screenshot({ path: `${out}/p2-overview.png` });
// view of the enemy camp from 12 m
await page.evaluate(() => { const D = window.__duck, b = D.battle; const e = b.ducks.find(d => !d.team.isPlayer); D.rig.position.set(e.pos.x - 9, e.pos.y + 2.2, e.pos.z + 9); D.rig.rotation.set(0, -Math.PI / 4, 0); D.camera.rotation.set(-0.15, 0, 0); });
await page.evaluate(() => window.__duck.step(0.0001, false));
await page.screenshot({ path: `${out}/p3-enemy-camp.png` });
// explosion close-up
await page.evaluate(() => { const D = window.__duck, b = D.battle; const e = b.ducks.find(d => !d.team.isPlayer); const W = { radius: 4.4, dmg: 1, crater: 1.6, knock: 0 }; b.explode(e.pos.x - 3, b.terrain.heightAt(e.pos.x - 3, e.pos.z + 2) + 0.2, e.pos.z + 2, W, null); });
await advance(page, 0.12, 1 / 30);
await page.screenshot({ path: `${out}/p4-explosion.png` });
await advance(page, 1.2, 1 / 30);
await page.screenshot({ path: `${out}/p5-explosion-later.png` });
await advance(page, 5, 1 / 30);
await page.screenshot({ path: `${out}/p6-crater.png` });
console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
await T.close();
