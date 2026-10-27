// Campaign flow: tutorial hints, victory, results, promotion, save; skirmish hot-seat handoff.
import { launch, advance } from './lib.mjs';
const out = process.argv[2] || '/tmp/claude-0/shots';
const T = await launch({ port: 8779, w: 1100, h: 620 });
const { page, errors } = T;
await page.evaluate(() => document.getElementById('play').click());
await page.evaluate(() => { const D = window.__duck; D.stop(); localStorage.clear(); D.ctx.save.campaign = D.newCampaign(); D.app.startMission(D.MISSIONS[0]); });
await advance(page, 5, 1 / 20, false);
await advance(page, 0.05);
await page.screenshot({ path: `${out}/f1-tutorial.png` });
console.log('hint:', await page.evaluate(() => window.__duck.ctx.hud.hint.text));
// knock down all three dummies
await page.evaluate(() => { const D = window.__duck, b = D.battle; for (const s of b.world.structures.items) if (s.objective === 'target') b.world.structures.destroy(s); b.checkEnd(); });
await advance(page, 5, 1 / 20, false);
await page.waitForTimeout(3800);
await advance(page, 0.2);
await page.screenshot({ path: `${out}/f2-results.png` });
const save = await page.evaluate(() => JSON.parse(localStorage.getItem('duck-and-cover.save.v1')));
console.log('saved campaign:', JSON.stringify({ unlocked: save.campaign.unlocked, completed: save.campaign.completed, flawless: save.campaign.flawless, points: save.campaign.points, ranks: save.campaign.roster.map(r => r.rank) }));
if (save.campaign.points !== 2) { console.log('FAIL expected 2 promotion points after a flawless first win'); process.exitCode = 1; }
// promote ducks → barracks
await page.evaluate(() => { const D = window.__duck; const p = D.scene.getObjectByName('menu').userData.panel; const r = p.rects.find(r => r.id === 'promo'); r.onClick(); });
await advance(page, 3, 1 / 20, false); await advance(page, 0.05);
console.log('state after results:', await page.evaluate(() => window.__duck.state), await page.evaluate(() => !!window.__duck.scene.getObjectByName('menu').userData.panel.rects.find(r => r.id === 'car0')));
await page.screenshot({ path: `${out}/f3-after-results.png` });
// the barracks Done button leads to the campaign map, with the region just won stamped
await page.evaluate(() => { const D = window.__duck; const p = D.scene.getObjectByName('menu').userData.panel; p.rects.find(r => r.id === 'back').onClick(); D.step(0.016, false); D.step(0.016, false); });
await page.screenshot({ path: `${out}/f3b-map-captured.png` });
// skirmish hot-seat
await page.evaluate(() => { const D = window.__duck; D.app.startSkirmish({ biome: 'farm', enemy: 'eider', size: 2, rank: 2, hotseat: true, difficulty: 'veteran' }); });
await advance(page, 5, 1 / 20, false);
console.log('skirmish:', await page.evaluate(() => { const b = window.__duck.battle; return JSON.stringify({ phase: b.phase, team: b.team.name, controls: b.teams.map(t => t.control) }); }));
await page.evaluate(() => window.__duck.battle.skipTurn());
await advance(page, 3, 1 / 20, false); await advance(page, 0.05);
console.log('handoff:', await page.evaluate(() => JSON.stringify({ paused: window.__duck.paused, screen: window.__duck.scene.getObjectByName('menu').visible, team: window.__duck.battle.team.name })));
await page.screenshot({ path: `${out}/f4-handoff.png` });
await page.evaluate(() => { const D = window.__duck; const p = D.scene.getObjectByName('menu').userData.panel; p.rects.find(r => r.id === 'ready').onClick(); });
await advance(page, 2, 1 / 20, false); await advance(page, 0.05);
console.log('after ready:', await page.evaluate(() => JSON.stringify({ paused: window.__duck.paused, me: window.__duck.player.duck.name, team: window.__duck.player.duck.team.name })));
await page.screenshot({ path: `${out}/f5-eider-turn.png` });
console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
await T.close();
