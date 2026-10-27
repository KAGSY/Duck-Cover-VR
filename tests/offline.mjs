// The offline build boots, renders the menu and starts a battle.
import { launch, advance } from './lib.mjs';
const T = await launch({ port: 8782, w: 800, h: 450, file: 'offline/' });
const { page, errors } = T;
await page.evaluate(() => document.getElementById('play').click());
await page.evaluate(() => { const D = window.__duck; D.stop(); D.ctx.save.campaign = D.newCampaign(); D.app.startMission(D.MISSIONS[8]); });
await advance(page, 5, 1 / 20, false);
await advance(page, 0.05);
await page.screenshot({ path: '/tmp/claude-0/shots/o1-offline.png' });
console.log(await page.evaluate(() => JSON.stringify({ state: window.__duck.state, phase: window.__duck.battle.phase })));
console.log('ERRORS', errors.length, errors.slice(0, 8).join('\n'));
await T.close();
