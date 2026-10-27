// AI-vs-AI soak: plays whole battles with no rendering and reports outcomes.
import { launch } from './lib.mjs';
const missions = (process.env.MISSIONS || '2,4,6,7,8,10,12').split(',').map(Number);
const T = await launch({ port: 8774, w: 320, h: 180 });
const { page, errors } = T;
await page.evaluate(() => document.getElementById('play').click());
for (const m of missions) {
  const res = await page.evaluate(async (m) => {
    const D = window.__duck; D.stop();
    D.ctx.save.campaign = D.newCampaign(); D.ctx.save.campaign.unlocked = 12;
    D.app.startMission(D.MISSIONS[m - 1]);
    for (let i = 0; i < 120; i++) D.step(1 / 20, true);
    const b = D.battle;
    for (const t of b.teams) t.control = 'ai';
    if (b.phase === 'act' && !b.ai) b.ai = b.makeAI(b, b.team);
    // tally what the computer fires, to check it uses every career's kit
    const used = {};
    const fire = b.fire.bind(b);
    b.fire = (spec) => { const w = spec.weapon || b.active?.weapon; const ok = fire(spec); if (ok) used[w] = (used[w] || 0) + 1; return ok; };
    const t0 = performance.now();
    let sim = 0, turns = 0, maxThink = 0, shots = 0;
    const log = [];
    const hpOf = () => b.teams.map(t => t.ducks.map(d => Math.max(0, Math.round(d.hp))).join('/')).join(' | ');
    let lastTurn = b.turnCount;
    while (!b.result && sim < 1500) {
      const ft = performance.now();
      D.step(1 / 30, true);
      const el = performance.now() - ft; if (el > maxThink) maxThink = el;
      sim += 1 / 30;
      if (b.turnCount !== lastTurn) { lastTurn = b.turnCount; if (log.length < 60) log.push(`#${b.turnCount} ${b.team.faction.short} ${b.active?.name}: ${hpOf()}`); }
      if ((Math.round(sim * 30)) % 300 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return { mission: m, result: b.result ? `${b.result.outcome}: ${b.result.reason}` : 'TIMEOUT', turns: b.turnCount, simMin: (sim / 60).toFixed(1), wallS: ((performance.now() - t0) / 1000).toFixed(1), maxFrameMs: Math.round(maxThink), final: hpOf(), used: Object.entries(used).map(([k, v]) => k + ' ' + v).join(', '), log: log.slice(0, 14) };
  }, m);
  console.log(JSON.stringify(res, null, 1));
}
console.log('ERRORS', errors.length); console.log(errors.slice(0, 20).join('\n'));
await T.close();
