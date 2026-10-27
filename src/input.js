// Unified input: Quest Touch controllers (WebXR gamepads) plus mouse and keyboard.
import * as THREE from 'three';
import { ctx } from './ctx.js';

const BTN = { trigger: 0, grip: 1, stick: 3, a: 4, b: 5 };

class Hand {
  constructor(name) {
    this.name = name;
    this.controller = null; this.grip = null;
    this.source = null; this.gamepad = null; this.connected = false;
    this.now = { trigger: false, grip: false, stick: false, a: false, b: false };
    this.prev = { ...this.now };
    this.triggerValue = 0;
    this.axes = new THREE.Vector2();
    this.vel = new THREE.Vector3();
    this.lastPos = new THREE.Vector3();
    this.hist = [];
    this.flickY = 0; this.flickX = 0;
  }
  pressed(b) { return this.now[b] && !this.prev[b]; }
  released(b) { return !this.now[b] && this.prev[b]; }
  held(b) { return this.now[b]; }
  pulse(intensity = 0.5, ms = 40) {
    const h = this.gamepad?.hapticActuators?.[0];
    try { if (h?.pulse) h.pulse(intensity, ms); else this.gamepad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity }); } catch (e) {}
  }
}

export class Input {
  constructor(renderer, rig) {
    this.renderer = renderer;
    this.hands = { left: new Hand('left'), right: new Hand('right') };
    this.keys = new Set(); this.keysPressed = new Set();
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, buttons: [false, false, false], prevButtons: [false, false, false], wheel: 0, locked: false, inside: false };
    // XR controllers
    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i), g = renderer.xr.getControllerGrip(i);
      rig.add(c); rig.add(g);
      c.addEventListener('connected', (e) => {
        const hand = this.hands[e.data.handedness === 'left' ? 'left' : 'right'];
        hand.controller = c; hand.grip = g; hand.source = e.data; hand.gamepad = e.data.gamepad; hand.connected = true;
        c.userData.hand = hand.name; g.userData.hand = hand.name;
        this.onConnect?.(hand);
      });
      c.addEventListener('disconnected', (e) => {
        for (const h of Object.values(this.hands)) if (h.controller === c) { h.connected = false; h.gamepad = null; this.onDisconnect?.(h); }
      });
    }
    // keyboard + mouse
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.keysPressed.add(e.code);
      if (['Tab', 'Space'].includes(e.code) && ctx.state === 'battle') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const el = renderer.domElement;
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      // look: pointer lock; where the browser blocks mouse capture, drag with any button
      const mx = e.movementX || 0, my = e.movementY || 0;
      if (this.mouse.locked) {
        // skip the jump some browsers report as the lock engages, and stray spikes (a known Chrome/Windows glitch)
        if (this.skipMoves > 0) { this.skipMoves--; return; }
        if (Math.abs(mx) > 350 || Math.abs(my) > 350) return;
        this.mouse.dx += mx; this.mouse.dy += my;
      } else if (this.mouse.buttons[2] || this.mouse.buttons[1] || (this.lockUnsupported && this.mouse.buttons[0])) {
        this.mouse.dx += mx; this.mouse.dy += my;
      }
      this.mouse.inside = true;
    });
    el.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    el.addEventListener('mousedown', (e) => { this.mouse.buttons[e.button] = true; });
    window.addEventListener('mouseup', (e) => { this.mouse.buttons[e.button] = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === el;
      if (this.mouse.locked) { this.lockWorks = true; this.lockUnsupported = false; this.skipMoves = 1; }
      if (!this.mouse.locked) this.onUnlock?.();
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed(); });
  }

  // Capture the mouse for looking around. Safe to call often: it is throttled, asks for raw (unaccelerated)
  // movement where supported, and is retried on the next click if the browser refuses.
  lockPointer() {
    const el = this.renderer.domElement;
    if (this.noLock) return;
    if (!el.requestPointerLock) { this.lockFailed(); return; }
    if (document.pointerLockElement === el) return;
    const now = performance.now();
    if (now - (this.lastLockTry || -1e9) < 350) return;
    this.lastLockTry = now;
    const plain = () => { try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => this.lockFailed()); } catch (e) { this.lockFailed(); } };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch((e) => { if (e && e.name === 'NotSupportedError') plain(); else this.lockFailed(); });
    } catch (e) { plain(); }
  }
  lockFailed() {
    if (this.mouse.locked) return;
    const first = !this.lockUnsupported;
    this.lockUnsupported = true; // until a lock succeeds: drag to look meanwhile
    if (first && !this.lockWorks) this.onLockFailed?.();
  }
  // true when the mouse is driving the game (locked, or lock unavailable)
  get aiming() { return this.mouse.locked || !!this.lockUnsupported; }
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

  mousePressed(b = 0) { return this.mouse.buttons[b] && !this.mouse.prevButtons[b]; }
  mouseReleased(b = 0) { return !this.mouse.buttons[b] && this.mouse.prevButtons[b]; }
  keyPressed(code) { return this.keysPressed.has(code); }
  key(code) { return this.keys.has(code); }

  // Called at the start of each frame.
  update(dt) {
    for (const h of Object.values(this.hands)) {
      h.prev = { ...h.now };
      const gp = h.connected ? (h.source?.gamepad || h.gamepad) : null;
      if (gp) {
        h.gamepad = gp;
        const b = gp.buttons;
        h.triggerValue = b[BTN.trigger]?.value ?? 0;
        h.now.trigger = h.triggerValue > 0.55 || (h.prev.trigger && h.triggerValue > 0.35);
        h.now.grip = !!(b[BTN.grip]?.pressed);
        h.now.stick = !!(b[BTN.stick]?.pressed);
        h.now.a = !!(b[BTN.a]?.pressed);
        h.now.b = !!(b[BTN.b]?.pressed);
        const ax = gp.axes;
        if (ax.length >= 4) h.axes.set(ax[2], ax[3]); else if (ax.length >= 2) h.axes.set(ax[0], ax[1]);
      } else {
        for (const k in h.now) h.now[k] = false;
        h.axes.set(0, 0); h.triggerValue = 0;
      }
      // hand velocity in world space (for throwing / slapping)
      const g = h.grip || h.controller;
      if (g && h.connected && dt > 0) {
        g.getWorldPosition(_p);
        h.hist.push({ t: ctx.time, x: _p.x, y: _p.y, z: _p.z });
        while (h.hist.length > 6) h.hist.shift();
        if (h.hist.length >= 3) {
          const a = h.hist[0], z = h.hist[h.hist.length - 1], span = Math.max(1e-3, z.t - a.t);
          h.vel.set((z.x - a.x) / span, (z.y - a.y) / span, (z.z - a.z) / span);
        }
      }
    }
  }
  // Called at the end of each frame.
  endFrame() {
    this.keysPressed.clear();
    this.mouse.prevButtons = this.mouse.buttons.slice();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }

  get main() { return ctx.settings?.hand === 'left' ? this.hands.left : this.hands.right; }
  get off() { return ctx.settings?.hand === 'left' ? this.hands.right : this.hands.left; }
}
const _p = new THREE.Vector3();
