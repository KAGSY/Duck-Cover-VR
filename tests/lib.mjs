// Shared test helpers: launch page, boot game, stepping and screenshots.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
export async function launch({ port = 8771, w = 800, h = 450, file = 'duck-and-cover.html', xr = false } = {}) {
  const srv = await serve(port);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' || (m.type() === 'warning' && !/GPU stall|GL Driver|Automatic fallback|SwiftShader|ReadPixels/.test(t))) errors.push(`[${m.type()}] ${t}`); if (t.startsWith('[T]')) console.log(t); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js', r => r.fulfill({ path: '/home/claude/duck/node_modules/three/build/three.module.min.js', contentType: 'text/javascript' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  if (xr) await page.addInitScript({ path: '/home/claude/duck/node_modules/iwer/build/iwer.min.js' });
  await page.goto(`http://localhost:${port}/${file}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90000 });
  // headless Chromium slows screenshots to a crawl while the pointer is locked
  await page.evaluate(() => { window.__duck.input.lockUnsupported = true; window.__duck.input.noLock = true; });
  return { browser, page, errors, srv, async close() { await browser.close(); srv.close(); } };
}
// run n frames at fixed dt without rendering, then render one frame
export async function advance(page, seconds, dt = 1 / 30, render = true) {
  await page.evaluate(({ seconds, dt, render }) => {
    const D = window.__duck; D.stop();
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) D.step(dt, true);
    if (render) D.step(0.0001, false);
  }, { seconds, dt, render });
}
export async function shot(page, path) { await page.evaluate(() => window.__duck.step(0.0001, false)); await page.screenshot({ path }); }
