// Procedurally drawn textures (no image downloads needed).
import * as THREE from 'three';
import { makePeriodicNoise, mulberry32 } from './rng.js';
import { ctx } from './ctx.js';

export const FONT_DISPLAY = '"Stardos Stencil", "Arial Black", Impact, sans-serif';
export const FONT_BODY = '"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif';
export const FONT_MONO = '"Share Tech Mono", "Consolas", monospace';

export async function loadFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const loads = [
    document.fonts.load('700 40px "Stardos Stencil"'),
    document.fonts.load('400 40px "Stardos Stencil"'),
    document.fonts.load('400 30px "Barlow Semi Condensed"'),
    document.fonts.load('600 30px "Barlow Semi Condensed"'),
    document.fonts.load('400 30px "Share Tech Mono"'),
  ];
  await Promise.race([Promise.allSettled(loads), new Promise(r => setTimeout(r, 2500))]);
  ctx.fontsReady = true;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function periodicFbm(noise, x, y, basePeriod, octaves) {
  let sum = 0, amp = 1, norm = 0, p = basePeriod, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f, p);
    norm += amp; amp *= 0.5; f *= 2; p *= 2;
  }
  return sum / norm;
}

function finishTexture(tex, { repeat = true, anisotropy = 4, srgb = false } = {}) {
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  tex.anisotropy = Math.min(anisotropy, ctx.renderer ? ctx.renderer.capabilities.getMaxAnisotropy() : 1);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// R = fine ground speckle (grass blades / grit), G = macro blotches, B = rock cracks.
export function makeDetailTexture(size = 256) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const n1 = makePeriodicNoise(11), n2 = makePeriodicNoise(23), n3 = makePeriodicNoise(37);
  const rnd = mulberry32(99);
  const fine = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    fine[y * size + x] = 0.35 + 0.3 * periodicFbm(n1, u * 32, v * 32, 32, 3) + (rnd() - 0.5) * 0.22;
  }
  // grass blade strokes: short bright/dark streaks
  for (let k = 0; k < size * size / 18; k++) {
    const x0 = rnd() * size, y0 = rnd() * size, len = 2 + rnd() * 5, a = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
    const val = rnd() < 0.5 ? 0.18 : -0.16;
    for (let s = 0; s < len; s++) {
      const x = Math.floor(x0 + Math.cos(a) * s + size) % size, y = Math.floor(y0 + Math.sin(a) * s + size) % size;
      fine[y * size + x] += val * (1 - s / len);
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    const macro = periodicFbm(n2, u * 4, v * 4, 4, 4);
    const r = 1 - Math.abs(periodicFbm(n3, u * 8, v * 8, 8, 4) * 2 - 1);
    const cracks = 0.62 - Math.pow(r, 7) * 0.5 + (periodicFbm(n1, u * 16 + 3, v * 16 + 7, 16, 3) - 0.5) * 0.35;
    img.data[i] = Math.max(0, Math.min(255, fine[y * size + x] * 255 + 32));
    img.data[i + 1] = Math.max(0, Math.min(255, macro * 255));
    img.data[i + 2] = Math.max(0, Math.min(255, cracks * 255));
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c), { anisotropy: 8 });
}

// Tileable two-channel noise used for water ripples.
export function makeNoiseTexture(size = 256) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const n1 = makePeriodicNoise(5), n2 = makePeriodicNoise(17);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    img.data[i] = periodicFbm(n1, u * 8, v * 8, 8, 4) * 255;
    img.data[i + 1] = periodicFbm(n2, u * 8, v * 8, 8, 4) * 255;
    img.data[i + 2] = periodicFbm(n1, u * 16 + 5, v * 16 + 9, 16, 3) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c), { anisotropy: 4 });
}

export function makeCloudTexture(size = 256) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const n = makePeriodicNoise(71);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    const f = periodicFbm(n, u * 6, v * 6, 6, 5);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, (f - 0.2) * 1.6 * 255));
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c), { anisotropy: 2 });
}

// Atlas of 8 white particle sprites (4 x 2 cells), tinted per particle.
export const PCELL = { smoke: 0, glow: 1, spark: 2, feather: 3, chunk: 4, ring: 5, drop: 6, star: 7 };
export function makeParticleAtlas() {
  const S = 128;
  const c = canvas(S * 4, S * 2);
  const g = c.getContext('2d');
  const rnd = mulberry32(7);
  const cell = (idx) => [(idx % 4) * S, Math.floor(idx / 4) * S];
  // 0 smoke: lumpy soft blob
  {
    const [ox, oy] = cell(0);
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 26;
      const x = ox + S / 2 + Math.cos(a) * d, y = oy + S / 2 + Math.sin(a) * d, r = 22 + rnd() * 20;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.32)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(ox, oy, S, S);
    }
  }
  // 1 glow
  {
    const [ox, oy] = cell(1);
    const gr = g.createRadialGradient(ox + S / 2, oy + S / 2, 0, ox + S / 2, oy + S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(ox, oy, S, S);
  }
  // 2 spark: hot dot
  {
    const [ox, oy] = cell(2);
    const gr = g.createRadialGradient(ox + S / 2, oy + S / 2, 0, ox + S / 2, oy + S / 2, S / 4);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(ox, oy, S, S);
  }
  // 3 feather
  {
    const [ox, oy] = cell(3);
    g.save(); g.translate(ox + S / 2, oy + S / 2); g.rotate(0.5);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.ellipse(0, 0, 14, 48, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(200,200,200,1)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -50); g.lineTo(0, 56); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1.5;
    for (let s = -40; s < 40; s += 7) { g.beginPath(); g.moveTo(0, s); g.lineTo(-13, s - 9); g.moveTo(0, s); g.lineTo(13, s - 9); g.stroke(); }
    g.restore();
  }
  // 4 chunk: jagged clod
  {
    const [ox, oy] = cell(4);
    g.save(); g.translate(ox + S / 2, oy + S / 2);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, r = 26 + rnd() * 22; k ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath(); g.arc(8, 10, 18, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // 5 ring
  {
    const [ox, oy] = cell(5);
    const gr = g.createRadialGradient(ox + S / 2, oy + S / 2, S * 0.3, ox + S / 2, oy + S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.85)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(ox, oy, S, S);
  }
  // 6 droplet
  {
    const [ox, oy] = cell(6);
    const gr = g.createRadialGradient(ox + S / 2 - 6, oy + S / 2 - 6, 2, ox + S / 2, oy + S / 2, S / 3);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(ox, oy, S, S);
  }
  // 7 star sparkle
  {
    const [ox, oy] = cell(7);
    g.save(); g.translate(ox + S / 2, oy + S / 2);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r = k % 2 ? 9 : 58; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeBlobTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(0.55, 'rgba(0,0,0,0.32)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Team flag cloth texture.
export function makeFlagTexture(color, accent, emblem = 'bill') {
  const c = canvas(128, 80);
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 128, 80);
  g.fillStyle = accent; g.fillRect(0, 30, 128, 20);
  g.beginPath(); g.arc(64, 40, 20, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  g.lineWidth = 4; g.strokeStyle = accent; g.stroke();
  // little duck head emblem
  g.fillStyle = accent;
  g.beginPath(); g.arc(60, 37, 8, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(66, 36); g.lineTo(78, 38); g.lineTo(66, 42); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
