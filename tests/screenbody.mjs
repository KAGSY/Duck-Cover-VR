// Standard (screen) mode: your duck's body below the camera, timed turns with no distance limit.
import { launch, advance } from './lib.mjs';
const out = process.argv[2] || '/tmp/claude-0/shots';
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const T = await launch({ port: 8784, w: 1100, h: 620 });
const { page, errors } = T;
let fails = 0;
const check = (cond, msg) => { console.log(cond ? 'ok  ' : 'FAIL', msg); if (!cond) fails++; };
const render = async (name) => { await advance(page, 0.0001, 1 / 30); await page.screenshot({ path: `${out}/${name}.png` }); };

await page.click('#play');
await page.evaluate(() => { const D = window.__duck; D.stop(); D.ctx.save.campaign = D.newCampaign(); D.ctx.save.campaign.unlocked = 12; D.ctx.settings.turnTime = 90; D.app.startMission(D.MISSIONS[1]); });
await advance(page, 5, 1 / 20, false);
const st = await page.evaluate(() => { const D = window.__duck, d = D.player.duck; return { phase: D.battle.phase, human: D.battle.isHumanTurn(), visible: d.mesh.visible, screenBody: d.screenBody, headHidden: d.headHidden, viewmodel: D.player.handWeapon.visible, weaponShown: !!d.weaponMesh?.visible, timer: D.battle.timer }; });
console.log('start', JSON.stringify(st));
check(st.phase === 'act' && st.human, 'your turn');
check(st.visible && st.screenBody && st.headHidden, 'your body is shown on screen, head hidden');
check(!st.viewmodel && st.weaponShown, 'your duck holds the weapon (no floating viewmodel)');

// face open ground (the direction with the most room), look ahead, then down at yourself
await page.evaluate(() => {
  const D = window.__duck, d = D.player.duck, T = D.battle.terrain;
  let best = 0, bestScore = -1;
  for (let a = 0; a < 6.28; a += 0.26) {
    let sc = 0; for (let r = 2; r <= 30; r += 2) { const x = d.pos.x + Math.sin(a) * r, z = d.pos.z + Math.cos(a) * r; if (Math.abs(x) < 70 && Math.abs(z) < 70 && T.heightAt(x, z) > 0.5 && !D.battle.W.pointInSolid(x, T.heightAt(x, z) + 0.5, z, 0.5)) sc++; else break; }
    if (sc > bestScore) { bestScore = sc; best = a; }
  }
  D.player.yaw = best; D.player.pitch = -0.05;
});
await advance(page, 0.6, 1 / 30);
await render('s1-ahead-bazooka');
await page.evaluate(() => { window.__duck.player.pitch = -1.25; });
await advance(page, 0.3, 1 / 30);
await render('s2-look-down');

// mouse look: steady response, spikes ignored, eye fixed while aiming, drag-to-look when capture is blocked
const look = await page.evaluate(() => {
  const D = window.__duck, P = D.player, el = D.renderer.domElement, inp = D.input;
  const mv = (x, y) => el.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y, bubbles: true }));
  inp.mouse.locked = true; inp.skipMoves = 0; P.pitch = 0;
  const y0 = P.yaw;
  for (let i = 0; i < 10; i++) mv(20, -5);
  D.step(1 / 60, true);
  const turn = P.yaw - y0, tilt = P.pitch;
  const y1 = P.yaw; mv(5000, 0); D.step(1 / 60, true);
  const spike = P.yaw - y1;
  const eyes = [];
  for (const p of [-0.45, 0, 0.6, 1.2]) { P.pitch = p; D.step(1 / 60, true); eyes.push(D.camera.position.y.toFixed(3) + ',' + D.camera.position.z.toFixed(3)); }
  P.pitch = -1.3; D.step(1 / 60, true);
  const peer = D.camera.position.z;
  inp.mouse.locked = false; inp.lockUnsupported = true; P.pitch = 0;
  const y2 = P.yaw;
  el.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
  for (let i = 0; i < 5; i++) mv(-20, 0);
  window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
  D.step(1 / 60, true);
  const drag = P.yaw - y2;
  return { turn, tilt, spike, eyes, peer, drag };
});
console.log('look', JSON.stringify(look));
check(Math.abs(look.turn + 0.44) < 0.01 && Math.abs(look.tilt - 0.11) < 0.01, 'mouse turns and tilts the view at the set speed');
check(Math.abs(look.spike) < 1e-6, 'a stray mouse jump is ignored');
check(new Set(look.eyes).size === 1, 'the eye stays put while you aim up and down');
check(look.peer < -0.2, 'looking far down tips your head forward to see your body');
check(look.drag > 0.2, 'drag-to-look works when the mouse cannot be captured');

// walk well past the old 14 m limit
const p0 = await page.evaluate(() => { const d = window.__duck.player.duck; return { x: d.pos.x, z: d.pos.z, t: window.__duck.battle.timer }; });
await page.evaluate(() => { window.__duck.player.pitch = -0.9; });
await page.keyboard.down('KeyW');
await advance(page, 8, 1 / 30, false);
await advance(page, 0.25, 1 / 30);
await page.screenshot({ path: `${out}/s3-walking-look-down.png` });
await page.keyboard.up('KeyW');
await advance(page, 0.3, 1 / 30, false);
const p1 = await page.evaluate(() => { const D = window.__duck, d = D.player.duck; return { x: d.pos.x, z: d.pos.z, t: D.battle.timer, moved: D.battle.moved, phase: D.battle.phase }; });
const walked = Math.hypot(p1.x - p0.x, p1.z - p0.z);
console.log('walked', walked.toFixed(1), 'm; moved total', p1.moved.toFixed(1), '; timer', p0.t.toFixed(1), '->', p1.t.toFixed(1));
check(p1.moved > 16, `walked past the old 14 m limit (${p1.moved.toFixed(1)} m)`);
check(p0.t - p1.t > 7, 'the turn clock kept running while walking');

// a teleport hop costs the time the walk would take
const hop = await page.evaluate(() => {
  const D = window.__duck, b = D.battle, d = D.player.duck;
  const a = D.player.yaw; let x = d.pos.x + Math.sin(a) * 6, z = d.pos.z + Math.cos(a) * 6;
  const c = b.checkHop(d, x, z); const t0 = b.timer; const ok = b.hop(d, x, z);
  return { ok, reason: c.reason, cost: c.time, dt: t0 - b.timer };
});
console.log('hop', JSON.stringify(hop));
check(!hop.ok || Math.abs(hop.dt - hop.cost) < 0.05, 'a hop takes walking time off the clock');

// weapons in your hands: rifle aimed, grenade held up
for (const w of ['rifle', 'grenade']) {
  await page.evaluate((w) => { const D = window.__duck, b = D.battle, d = D.player.duck; d.ammo[w] = Math.max(d.ammo[w] || 0, 2); b.setWeapon(w); D.player.pitch = -0.08; }, w);
  await advance(page, 0.7, 1 / 30);
  await render(`s4-${w}`);
}
// rifle shots meet the crosshair: fire at a point and compare
const aim = await page.evaluate(() => {
  const D = window.__duck, P = D.player, b = D.battle; b.setWeapon('rifle');
  const o = new D.THREE.PerspectiveCamera().position, dv = o.clone();
  P.aimPose(o, dv);
  const pt = P.crosshairPoint(160);
  const cam = new D.THREE.PerspectiveCamera().position; D.camera.getWorldPosition(cam);
  const toPt = pt.clone().sub(o).normalize();
  return { dot: toPt.dot(dv), muzzleFromEye: o.distanceTo(cam) };
});
console.log('aim', JSON.stringify(aim));
check(aim.dot > 0.9999, 'rifle aims from the muzzle to the crosshair point');

// running out of time ends the turn
const end = await page.evaluate(() => { const D = window.__duck, b = D.battle; b.timer = 1.5; const team = b.team; for (let i = 0; i < 90; i++) D.step(1 / 30, true); return { phase: b.phase, sameTeam: b.team === team }; });
console.log('timeout', JSON.stringify(end));
check(end.phase !== 'act' || !end.sameTeam, 'the turn ends when the clock runs out');

// hands-only setting brings back the floating weapon
const hands = await page.evaluate(() => {
  const D = window.__duck; D.ctx.settings.vrBody = 'hands'; D.app.settingChanged('vrBody');
  const d = D.player.duck; const r = { visible: d.mesh.visible, screenBody: d.screenBody };
  D.ctx.settings.vrBody = 'full'; D.app.settingChanged('vrBody');
  r.back = D.player.duck.screenBody && D.player.duck.mesh.visible;
  return r;
});
console.log('hands only', JSON.stringify(hands));
check(!hands.visible && !hands.screenBody && hands.back, 'hands-only setting hides the body, full brings it back');

console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'all passed');
await T.close();
process.exit(fails || errors.length ? 1 : 0);
