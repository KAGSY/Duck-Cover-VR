// Shared runtime context + small math helpers used across modules.
export const ctx = {
  renderer: null, scene: null, camera: null, rig: null,
  quality: null, tier: 'low', settings: null, save: null,
  audio: null, fx: null, ui: null, player: null, world: null, battle: null,
  time: 0, dt: 0, frame: 0,
  isXR: false,
  fontsReady: false,
};

const listeners = new Map();
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => off(type, fn);
}
export function off(type, fn) { listeners.get(type)?.delete(fn); }
export function emit(type, data) {
  const set = listeners.get(type);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(data); } catch (e) { console.error('[event ' + type + ']', e); }
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;
export function wrapAngle(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
export function angleDiff(a, b) { return wrapAngle(b - a); }
export function dampAngle(a, b, lambda, dt) { return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt)); }
export const fmt = (n) => Math.round(n).toString();
export function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
// Short timers that run inside the game loop (pausable with the loop).
const timers = [];
export function after(sec, fn) { const t = { at: ctx.time + sec, fn }; timers.push(t); return t; }
export function cancelTimer(t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }
export function runTimers() {
  for (let i = timers.length - 1; i >= 0; i--) {
    if (ctx.time >= timers[i].at) { const t = timers[i]; timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } }
  }
}
export function clearTimers() { timers.length = 0; }
