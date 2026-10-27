// WebXR emulation test (IWER, Quest 1 profile): enter VR, menus, teleport, turn, fire.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const out = process.argv[2] || '/tmp/claude-0/shots';
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const srv = await serve(8775);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
const errors = [];
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || (m.type() === 'warning' && !/GPU stall|GL Driver|Automatic fallback|SwiftShader|ReadPixels/.test(t))) errors.push(`[${m.type()}] ${t}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js', r => r.fulfill({ path: '/home/claude/duck/node_modules/three/build/three.module.min.js', contentType: 'text/javascript' }));
await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.addInitScript({ path: '/home/claude/duck/node_modules/iwer/build/iwer.min.js' });
await page.addInitScript(() => { const d = new IWER.XRDevice(IWER.oculusQuest1); d.installRuntime({ forceInstall: true }); d.position.set(0, 1.72, 0); window.__xr = d; });
await page.goto('http://localhost:8775/duck-and-cover.html');
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90000 });
await page.waitForFunction(() => !document.getElementById('enter-vr').disabled, null, { timeout: 20000 }).catch(() => errors.push('enter-vr never enabled'));
await page.click('#enter-vr');
await page.waitForFunction(() => window.__duck.ctx.isXR, null, { timeout: 20000 }).catch(() => errors.push('XR session did not start'));
// helpers inside the page: point a controller at a world point, set stick/buttons, step
await page.evaluate(() => {
  const X = window.__xr;
  window.__q = (dx, dy, dz) => { // quaternion rotating -Z onto d
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const fx = 0, fy = 0, fz = -1;
    let cx = fy * dz - fz * dy, cy = fz * dx - fx * dz, cz = fx * dy - fy * dx; const dot = fx * dx + fy * dy + fz * dz;
    const w = 1 + dot; const n = Math.hypot(cx, cy, cz, w) || 1; return [cx / n, cy / n, cz / n, w / n];
  };
  window.__aim = (hand, px, py, pz, tx, ty, tz) => { const c = X.controllers[hand]; c.position.set(px, py, pz); const q = window.__q(tx - px, ty - py, tz - pz); c.quaternion.set(q[0], q[1], q[2], q[3]); };
  window.__aim('left', -0.25, 1.15, -0.3, -0.25, 1.15, -2);
  window.__aim('right', 0.25, 1.15, -0.3, 0.25, 1.15, -2);
});
// let XR run a bit (real rAF loop drives XR frames)
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/v1-vr-menu.png` });
const s1 = await page.evaluate(() => { const D = window.__duck; return { isXR: D.ctx.isXR, state: D.state, hands: Object.values(D.input.hands).map(h => `${h.name}:${h.connected}`), height: D.player.heightOffset.toFixed(2), camY: D.camera.position.y.toFixed(2), menuVisible: D.scene.getObjectByName('menu')?.visible, calls: D.renderer.info.render.calls }; });
console.log('menu', JSON.stringify(s1));
// point right laser at the menu panel's first button and click
const target = await page.evaluate(() => { const D = window.__duck; const m = D.scene.getObjectByName('menu'); m.updateMatrixWorld(); D.rig.updateMatrixWorld(); const v = m.localToWorld(m.position.clone().set(-0.3, 0.11, 0)); D.rig.worldToLocal(v); return { x: v.x, y: v.y, z: v.z }; });
await page.evaluate((t) => { window.__aim('right', 0.25, 1.15, -0.3, t.x, t.y, t.z); }, target);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/v2-laser.png` });
await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 1));
await page.waitForTimeout(700);
await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 0));
await page.waitForTimeout(1200);
const s2 = await page.evaluate(() => { const D = window.__duck; return { campaign: !!D.ctx.save.campaign, title: D.scene.getObjectByName('menu')?.userData.panel.screen === undefined }; });
console.log('after click', JSON.stringify(s2));
await page.screenshot({ path: `${out}/v3-after-click.png` });
// the campaign map in the headset: point the laser at Pollard's Mill and pull the trigger
const onMap = await page.evaluate(() => {
  const D = window.__duck, m = D.scene.getObjectByName('menu'), p = m.userData.panel;
  if (!D.campaignMap.ready) return null;
  const c = D.campaignMap.centres[3], px = 26 + c.x, py = 28 + c.y;
  m.updateMatrixWorld(); D.rig.updateMatrixWorld();
  const v = m.localToWorld(new D.camera.position.constructor((px / p.w - 0.5) * p.meters, (0.5 - py / p.h) * p.meters * p.h / p.w, 0));
  D.rig.worldToLocal(v);
  return { x: v.x, y: v.y, z: v.z, sel: p.state.sel ?? null };
});
console.log('map target', JSON.stringify(onMap));
if (onMap) {
  await page.evaluate((t) => { window.__aim('right', 0.25, 1.15, -0.3, t.x, t.y, t.z); }, onMap);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 1));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 0));
  await page.waitForTimeout(1200);
  const sel = await page.evaluate(() => window.__duck.scene.getObjectByName('menu').userData.panel.state.sel);
  console.log('map pick by laser', sel === 3 ? 'ok (Pollard\'s Mill)' : 'FAIL ' + sel);
  await page.screenshot({ path: `${out}/v3b-vr-map.png` });
}
// start mission 2 directly
await page.evaluate(() => { const D = window.__duck; D.ctx.save.campaign = D.newCampaign(); D.ctx.save.campaign.unlocked = 12; D.app.startMission(D.MISSIONS[1]); });
await page.waitForFunction(() => window.__duck.state === 'battle' && window.__duck.battle.phase === 'act', null, { timeout: 90000 });
await page.evaluate(() => window.__aim('right', 0.25, 1.15, -0.3, 0.25, 1.4, -2));
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/v4-battle.png` });
const s3 = await page.evaluate(() => { const D = window.__duck, b = D.battle, d = D.player.duck; const h = new D.camera.position.constructor(); D.camera.getWorldPosition(h); return { phase: b.phase, active: b.active?.name, me: d?.name, duck: [d.pos.x.toFixed(2), d.pos.y.toFixed(2), d.pos.z.toFixed(2)], head: [h.x.toFixed(2), h.y.toFixed(2), h.z.toFixed(2)], hOff: D.player.heightOffset.toFixed(2), time: b.timer.toFixed(1), weapon: d.weapon, fade: D.player.fadeV.toFixed(2), tether: D.player.tether.toFixed(2) }; });
console.log('battle', JSON.stringify(s3));
// raise the left hand to look at the wrist map
await page.evaluate(() => { window.__aim('left', -0.08, 1.5, -0.32, -0.08, 2.5, -0.5); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/v4b-wrist.png` });
console.log('vr battle draws', await page.evaluate(() => JSON.stringify({ calls: window.__duck.renderer.info.render.calls, tris: window.__duck.renderer.info.render.triangles })));
await page.evaluate(() => { window.__aim('left', -0.25, 1.15, -0.3, -0.25, 1.15, -2); });
// teleport: push left stick forward, aim the left hand down-forward, release
await page.evaluate(() => { window.__aim('left', -0.25, 1.15, -0.3, -0.25, 0.9, -1.4); window.__xr.controllers.left.updateAxes('thumbstick', 0, -1); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/v5-teleport-aim.png` });
const tp = await page.evaluate(() => { const P = window.__duck.player; return { active: P.tp.active, ok: P.tp.ok, reason: P.tp.reason, x: P.tp.x?.toFixed(1), z: P.tp.z?.toFixed(1) }; });
console.log('teleport aim', JSON.stringify(tp));
await page.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, 0));
await page.waitForTimeout(2000);
const s4 = await page.evaluate(() => { const D = window.__duck, b = D.battle, d = D.player.duck; return { duck: [d.pos.x.toFixed(2), d.pos.z.toFixed(2)], time: b.timer.toFixed(1), moved: b.moved.toFixed(1) }; });
console.log('after hop', JSON.stringify(s4));
// snap turn right
const yaw0 = await page.evaluate(() => window.__duck.rig.rotation.y);
await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 1, 0));
await page.waitForTimeout(400);
await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, 0));
await page.waitForTimeout(400);
const yaw1 = await page.evaluate(() => window.__duck.rig.rotation.y);
console.log('snap turn delta (deg)', ((yaw1 - yaw0) * 180 / Math.PI).toFixed(1));
// weapon cycle: flick right stick up
await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, -1));
await page.waitForTimeout(300);
await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, 0));
await page.waitForTimeout(300);
console.log('weapon now', await page.evaluate(() => window.__duck.player.duck.weapon));
await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, 1));
await page.waitForTimeout(300);
await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, 0));
await page.waitForTimeout(300);
console.log('weapon back', await page.evaluate(() => window.__duck.player.duck.weapon));
// fire: aim right hand up toward enemies, hold trigger 1 s, release
await page.evaluate(() => { const D = window.__duck, b = D.battle, d = D.player.duck; const e = b.ducks.find(x => x.team !== d.team); const rigYaw = D.rig.rotation.y; const wx = e.pos.x - d.pos.x, wz = e.pos.z - d.pos.z; const l = Math.hypot(wx, wz); /* convert world dir into rig-local dir */ const c = Math.cos(-rigYaw), s = Math.sin(-rigYaw); const lx = (wx * c + wz * s) / l, lz = (-wx * s + wz * c) / l; window.__aim('right', 0.25, 1.15, -0.3, 0.25 + lx, 1.15 + 0.55, -0.3 + lz); });
await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 1));
await page.waitForTimeout(1300);
await page.screenshot({ path: `${out}/v6-charging.png` });
await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 0));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/v7-fired.png` });
console.log('after fire', await page.evaluate(() => { const b = window.__duck.battle; return JSON.stringify({ phase: b.phase, fired: b.fired, proj: b.projectiles.length }); }));
// pause with Y
await page.evaluate(() => window.__xr.controllers.left.updateButtonValue('y-button', 1));
await page.waitForTimeout(300);
await page.evaluate(() => window.__xr.controllers.left.updateButtonValue('y-button', 0));
await page.waitForTimeout(800);
console.log('paused', await page.evaluate(() => window.__duck.paused));
await page.screenshot({ path: `${out}/v8-pause.png` });
fs.writeFileSync(`${out}/vr-errors.txt`, errors.join('\n'));
console.log('ERRORS', errors.length); console.log(errors.slice(0, 20).join('\n'));
await browser.close(); srv.close();
