// VR edge cases: physical grenade throw, knockback blackout + re-anchor, inhabited duck knocked out.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const out = process.argv[2] || '/tmp/claude-0/shots';
const srv = await serve(8780);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 320 } });
const errors = [];
page.on('console', m => { const t = m.text(); if (m.type() === 'error') errors.push(t); if (t.startsWith('[T]')) console.log(t); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js', r => r.fulfill({ path: '/home/claude/duck/node_modules/three/build/three.module.min.js', contentType: 'text/javascript' }));
await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.addInitScript({ path: '/home/claude/duck/node_modules/iwer/build/iwer.min.js' });
await page.addInitScript(() => { const d = new IWER.XRDevice(IWER.oculusQuest1); d.installRuntime({ forceInstall: true }); d.position.set(0, 1.25, 0); window.__xr = d; });
await page.goto('http://localhost:8780/duck-and-cover.html');
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90000 });
await page.waitForFunction(() => !document.getElementById('enter-vr').disabled, null, { timeout: 20000 });
await page.click('#enter-vr');
await page.waitForFunction(() => window.__duck.ctx.isXR, null, { timeout: 20000 });
await page.evaluate(() => { const D = window.__duck; D.ctx.save.campaign = D.newCampaign(); D.app.startMission(D.MISSIONS[1]); });
await page.waitForFunction(() => window.__duck.state === 'battle' && window.__duck.battle.phase === 'act', null, { timeout: 90000 });
await page.waitForTimeout(1500);
console.log('seated height offset', await page.evaluate(() => window.__duck.player.heightOffset.toFixed(2)));
// select grenade and throw physically: hold trigger, move hand fast forward/up, release
await page.evaluate(() => { const b = window.__duck.battle; b.setWeapon('grenade'); });
await page.evaluate(() => { const c = window.__xr.controllers.right; c.position.set(0.3, 1.0, 0.1); c.updateButtonValue('trigger', 1); });
await page.waitForTimeout(500);
for (let i = 0; i < 6; i++) { await page.evaluate((i) => { window.__xr.controllers.right.position.set(0.3, 1.0 + i * 0.06, 0.1 - i * 0.12); }, i); await page.waitForTimeout(16); }
await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 0));
await page.waitForTimeout(300);
console.log('throw', await page.evaluate(() => { const b = window.__duck.battle; const p = b.projectiles[0]; return p ? `${p.kind} v=${Math.hypot(p.vx, p.vy, p.vz).toFixed(1)}` : 'no projectile (fired=' + b.fired + ')'; }));
await page.waitForTimeout(6000);
// knockback our duck
await page.evaluate(() => { const D = window.__duck, b = D.battle; const d = D.player.duck; b.phase = 'act'; b.fired = false; b.explode(d.pos.x + 1.5, d.pos.y + 0.3, d.pos.z, { radius: 4, dmg: 10, crater: 0.5, knock: 14 }, null); });
await page.waitForTimeout(250);
console.log('during knock', await page.evaluate(() => { const P = window.__duck.player; return JSON.stringify({ blackout: P.blackout, fade: P.fadeV.toFixed(2), state: P.duck.state }); }));
for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); console.log('t', i, await page.evaluate(() => { const D = window.__duck, d = D.player.duck, b = D.battle; return JSON.stringify({ p: [d.pos.x.toFixed(1), d.pos.y.toFixed(2), d.pos.z.toFixed(1)], v: [d.vel.x.toFixed(1), d.vel.y.toFixed(1), d.vel.z.toFixed(1)], st: d.state, sup: b.W.supportHeight(d.pos.x, d.pos.z, d.pos.y + 0.4).toFixed(2), ter: b.terrain.heightAt(d.pos.x, d.pos.z).toFixed(2), paused: D.paused, phase: b.phase, frame: D.ctx.frame }); })); }
console.log('after landing', await page.evaluate(() => { const D = window.__duck, P = D.player, d = P.duck; const h = new D.camera.position.constructor(); D.camera.getWorldPosition(h); return JSON.stringify({ blackout: P.blackout, fade: P.fadeV.toFixed(2), state: d.state, headToDuck: Math.hypot(h.x - d.pos.x, h.z - d.pos.z).toFixed(2), eyeAboveFeet: (h.y - d.pos.y).toFixed(2) }); }));
// knock out the inhabited duck
await page.evaluate(() => { const D = window.__duck, b = D.battle; b.damageDuck(D.player.duck, 999, null); });
await page.waitForTimeout(3500);
console.log('after KO', await page.evaluate(() => { const D = window.__duck; return JSON.stringify({ me: D.player.duck.name, alive: D.player.duck.alive, hidden: D.player.duck.hidden }); }));
console.log('ERRORS', errors.length, errors.slice(0, 10).join('\n'));
await browser.close(); srv.close();
