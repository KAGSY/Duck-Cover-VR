// Same view at each graphics tier (checks the upgrade path renders).
import { launch, advance } from './lib.mjs';
const out = process.argv[2] || '/tmp/claude-0/shots';
const T = await launch({ port: 8778, w: 1000, h: 560 });
const { page, errors } = T;
await page.evaluate(() => document.getElementById('play').click());
for (const tier of (process.env.TIERS || 'low,high').split(',')) {
  const info = await page.evaluate(async (tier) => {
    const D = window.__duck; D.stop(); D.ctx.settings.quality = tier;
    D.ctx.save.campaign = D.newCampaign(); D.app.startMission(D.MISSIONS[2]);
    for (let i = 0; i < 100; i++) D.step(1 / 20, true);
    const b = D.battle, me = D.player.duck; const e = b.ducks.find(d => d.team !== me.team);
    D.player.yaw = Math.atan2(e.pos.x - me.pos.x, e.pos.z - me.pos.z) + 0.6; D.player.pitch = -0.08;
    D.step(0.016, false); D.step(0.016, false);
    const r = D.renderer.info.render; return { tier: D.ctx.quality.id, calls: r.calls, tris: r.triangles, shadows: D.renderer.shadowMap.enabled };
  }, tier);
  console.log(JSON.stringify(info));
  await page.screenshot({ path: `${out}/t-${tier}.png` });
}
console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
await T.close();
