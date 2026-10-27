// Render every menu screen on desktop for a visual check.
import { launch } from './lib.mjs';
const out = process.argv[2] || '/tmp/claude-0/shots';
const T = await launch({ port: 8776, w: 1280, h: 720 });
const { page, errors } = T;
await page.evaluate(() => document.getElementById('play').click());
await page.evaluate(() => { const D = window.__duck; D.stop(); D.ctx.save.campaign = D.newCampaign(); D.ctx.save.campaign.unlocked = 6; D.ctx.save.campaign.completed = { 1: true, 2: true, 3: true, 4: true, 5: true }; D.ctx.save.campaign.points = 3; D.ctx.save.campaign.flawless = { 1: true, 2: true }; D.ctx.save.campaign.roster[0].rank = 2; D.ctx.save.campaign.roster[0].spec = 'sapper'; D.ctx.save.campaign.roster[1].rank = 3; D.ctx.save.campaign.roster[1].spec = 'grenadier'; });
const shots = [
  ['main', {}], ['campaign', {}], ['briefing', 'm6'], ['barracks', {}], ['settings', {}], ['howto', {}], ['skirmish', {}],
  ['confirm', { text: 'Start a new campaign? Your squad and progress will be reset.' }], ['loading', { title: 'Radar Hill', sub: 'Kittiwake Hill' }],
  ['handoff', { team: 'Teal Brigade', color: '#6fc6d9' }],
  ['results', { mode: 'campaign', missionName: 'Mission 6 · Radar Hill', summary: { won: true, reason: 'Our flag flies over Kittiwake Hill.', missionId: 6, points: { victory: 1, survival: 0, wonBefore: false, bonusBefore: false, lost: 1, total: 3 }, rows: [{ name: 'Cpl. Puddles', damage: 84, kills: 2, alive: true }, { name: 'Sgt. Waddington', damage: 40, kills: 1, alive: true }, { name: 'Pvt. Mallory', damage: 0, kills: 0, alive: false }, { name: 'Pvt. Drake', damage: 22, kills: 0, alive: true }], reward: 'Private Dabs has joined your squad as a reinforcement.' } }],
];
for (const [name, st] of shots) {
  await page.evaluate(([name, st]) => { const D = window.__duck; const s = st === 'm6' ? { mission: D.MISSIONS[5] } : st; D.app.show(name, s); D.step(0.016, false); D.step(0.016, false); }, [name, st]);
  await page.screenshot({ path: `${out}/s-${name}.png` });
}
await page.evaluate(() => { const D = window.__duck, c = D.ctx.save.campaign; D.app.show('career', { id: c.roster[1].id }); D.step(0.016, false); D.step(0.016, false); });
await page.screenshot({ path: `${out}/s-career.png` });
console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
await T.close();
