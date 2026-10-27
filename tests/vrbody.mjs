// VR full-body check (IWER, Quest 1 profile): look down at your duck body, raise your hands, crouch,
// plus spectator renders of the tracked body from outside.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const out = process.argv[2] || '/tmp/claude-0/shots';
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const srv = await serve(8776);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
const errors = [];
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || (m.type() === 'warning' && !/GPU stall|GL Driver|Automatic fallback|SwiftShader|ReadPixels/.test(t))) errors.push(`[${m.type()}] ${t}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js', r => r.fulfill({ path: '/home/claude/duck/node_modules/three/build/three.module.min.js', contentType: 'text/javascript' }));
await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.addInitScript({ path: '/home/claude/duck/node_modules/iwer/build/iwer.min.js' });
await page.addInitScript(() => { const d = new IWER.XRDevice(IWER.oculusQuest1); d.installRuntime({ forceInstall: true }); d.position.set(0, 1.72, 0); window.__xr = d; });
await page.goto('http://localhost:8776/duck-and-cover.html');
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90000 });
await page.waitForFunction(() => !document.getElementById('enter-vr').disabled, null, { timeout: 20000 });
await page.click('#enter-vr');
await page.waitForFunction(() => window.__duck.ctx.isXR, null, { timeout: 20000 });
await page.evaluate(() => {
  const X = window.__xr;
  // point a controller along direction d (tilted down by tilt radians) from position p
  window.__pose = (hand, p, d, roll = 0) => {
    const c = X.controllers[hand]; c.position.set(p[0], p[1], p[2]);
    const l = Math.hypot(...d), x = d[0] / l, y = d[1] / l, z = d[2] / l;
    // quaternion taking -Z to (x,y,z)
    let cx = -z * 0 - (-1) * y, cy = (-1) * x - 0 * z, cz = 0; const w = 1 + (-z);
    cx = y; cy = -x; // cross((0,0,-1),(x,y,z)) = (0*z - (-1)*y, (-1)*x - 0*z, 0) = (y, -x, 0)
    const n = Math.hypot(cx, cy, cz, w) || 1;
    c.quaternion.set(cx / n, cy / n, cz / n, w / n);
  };
  window.__head = (y, pitch, yaw = 0) => {
    X.position.set(0, y, 0);
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    // yaw (Y) then pitch (X): q = qy * qx
    X.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  };
});
// 0) camp: turn to the mirror beside the menu board and wave
await page.waitForTimeout(2500);
await page.evaluate(() => { window.__head(1.72, -0.12, 0.62); window.__pose('right', [-0.05, 1.75, -0.4], [-0.3, 0.9, -0.4]); window.__pose('left', [-0.42, 1.2, -0.25], [-0.6, -0.2, -1]); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/b0-mirror.png` });
console.log('mirror', await page.evaluate(() => { const D = window.__duck, m = D.scene.getObjectByName('mirror'); return JSON.stringify({ visible: m?.visible, body: !!D.player.menuBody?.vrDriven, calls: D.renderer.info.render.calls }); }));
await page.evaluate(() => { window.__head(1.72, 0, 0); });
await page.evaluate(() => { const D = window.__duck; D.ctx.save.campaign = D.newCampaign(); D.ctx.save.campaign.unlocked = 12; D.app.startMission(D.MISSIONS[1]); });
await page.waitForFunction(() => window.__duck.state === 'battle' && window.__duck.battle.phase === 'act', null, { timeout: 90000 });
const snap = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${name}.png` }); };
// spectator render: draw the scene from outside with xr off for one frame
const spectate = async (name, showHead = true) => {
  const url = await page.evaluate((showHead) => {
    const D = window.__duck, d = D.player.duck || D.player.menuBody, r = D.renderer, THREE = D.THREE;
    const W = 900, H = 450;
    const cam = new THREE.PerspectiveCamera(42, W / H, 0.05, 400);
    const yaw = d.vrs ? d.vrs.yaw : d.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    cam.position.set(d.pos.x + fx * 2.6 + fz * 1.2, d.pos.y + 1.45, d.pos.z + fz * 2.6 - fx * 1.2);
    cam.lookAt(d.pos.x, d.pos.y + 1.0, d.pos.z);
    const hh = d.headHidden;
    d.bones.neck.scale.setScalar(showHead ? 1 : 0.001);
    d.mesh.updateMatrixWorld(true);
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    const xr = r.xr.enabled; r.xr.enabled = false;
    const prev = r.getRenderTarget();
    r.setRenderTarget(rt); r.clear(); r.render(D.scene, cam);
    const buf = new Uint8Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    r.setRenderTarget(prev); r.xr.enabled = xr;
    d.bones.neck.scale.setScalar(hh ? 0.001 : 1);
    rt.dispose();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H);
    const lin = (v) => { v /= 255; return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = ((H - 1 - y) * W + x) * 4, o = (y * W + x) * 4;
      img.data[o] = lin(buf[i]); img.data[o + 1] = lin(buf[i + 1]); img.data[o + 2] = lin(buf[i + 2]); img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }, showHead);
  fs.writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
};
const report = async (label) => console.log(label, await page.evaluate(() => {
  const D = window.__duck, d = D.player.duck, V = D.camera.position.constructor;
  const w = (b) => { const v = new V(); d.bones[b].getWorldPosition(v); return v; };
  const eye = new V(); D.camera.getWorldPosition(eye);
  const f = (v) => [v.x - d.pos.x, v.y - d.pos.y, v.z - d.pos.z].map(n => n.toFixed(2)).join(',');
  return JSON.stringify({ vrDriven: d.vrDriven, visible: d.mesh.visible, eye: f(eye), neck: f(w('neck')), hips: f(w('hips')), handL: f(w('handL')), handR: f(w('handR')), footL: f(w('footL')), footR: f(w('footR')), gloves: D.player.offWing.visible, weapon: D.player.handWeapon.visible });
}));

// 1) standing, looking down at your body, bazooka in the right hand
await page.evaluate(() => { window.__head(1.72, -1.0); window.__pose('right', [0.2, 1.22, -0.38], [0, 0.15, -1]); window.__pose('left', [-0.22, 1.18, -0.3], [0.2, -0.3, -1]); });
await snap('b1-look-down');
await report('look down');
await spectate('b1s-spectator');
// 2) hands up in front of your face
await page.evaluate(() => { window.__head(1.72, -0.1); window.__pose('right', [0.14, 1.62, -0.36], [0.1, 0.6, -1]); window.__pose('left', [-0.16, 1.55, -0.34], [-0.1, 0.9, -0.6]); window.__xr.controllers.left.updateButtonValue('squeeze', 1); });
await snap('b2-hands-up');
await report('hands up');
await spectate('b2s-spectator');
// 3) crouch low, look down
await page.evaluate(() => { window.__head(1.22, -0.9); window.__pose('right', [0.22, 0.85, -0.42], [0, 0, -1]); window.__pose('left', [-0.2, 0.8, -0.35], [0, -0.2, -1]); window.__xr.controllers.left.updateButtonValue('squeeze', 0); });
await snap('b3-crouch');
await report('crouch');
await spectate('b3s-spectator');
// 4) turned head, arms out wide (T-pose-ish), pulling the trigger
await page.evaluate(() => { window.__head(1.72, -0.35, 0.6); window.__pose('right', [0.62, 1.4, -0.1], [1, 0, -0.2]); window.__pose('left', [-0.62, 1.4, -0.1], [-1, 0, -0.2]); window.__xr.controllers.right.updateButtonValue('trigger', 0.4); });
await snap('b4-arms-wide');
await report('arms wide');
await spectate('b4s-spectator');
await page.evaluate(() => { window.__xr.controllers.right.updateButtonValue('trigger', 0); });
// 5) walk with smooth locomotion and look down at stepping feet
await page.evaluate(() => { const D = window.__duck; D.ctx.settings.locomotion = 'smooth'; window.__head(1.72, -0.9); window.__pose('right', [0.2, 1.22, -0.38], [0, 0, -1]); window.__pose('left', [-0.22, 1.18, -0.3], [0, -0.3, -1]); window.__xr.controllers.left.updateAxes('thumbstick', 0, -1); });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/b5-walking.png` });
await spectate('b5s-spectator');
await page.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, 0));
await page.waitForTimeout(400);
// 6) hands-only setting brings back the gloves and hides the body
await page.evaluate(() => { const D = window.__duck; D.ctx.settings.vrBody = 'hands'; D.app.settingChanged('vrBody'); window.__head(1.72, -1.0); });
await snap('b6-hands-only');
await report('hands only');
await page.evaluate(() => { const D = window.__duck; D.ctx.settings.vrBody = 'full'; D.app.settingChanged('vrBody'); });
console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
await browser.close(); srv.close();
