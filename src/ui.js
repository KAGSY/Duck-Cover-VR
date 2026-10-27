// Canvas-drawn 3D panels with laser-pointer (VR) and mouse interaction, plus the HUD pieces.
import * as THREE from 'three';
import { ctx, clamp, lerp, emit } from './ctx.js';
import { FONT_DISPLAY, FONT_BODY, FONT_MONO } from './textures.js';
import { Ribbon } from './fx.js';
import { roundRect } from './duck.js';

export const C = {
  bg: 'rgba(15,24,21,0.94)', bg2: '#1c2b25', line: 'rgba(239,231,207,0.18)', text: '#efe7cf', dim: 'rgba(239,231,207,0.62)',
  accent: '#f2c230', accentDark: '#1a1406', good: '#7bc96f', bad: '#e2553a', info: '#8fc3d6', mallard: '#2f7d55',
};

// ------------------------------------------------------------------ Panel
export class Panel {
  constructor({ w = 1024, h = 640, meters = 1.2, name = 'panel', interactive = true, depthTest = true, order = 60 }) {
    this.w = w; this.h = h; this.meters = meters; this.interactive = interactive;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(meters, meters * h / w);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest, depthWrite: false, fog: false, toneMapped: false }));
    this.mesh.name = name;
    this.mesh.renderOrder = order;
    this.mesh.userData.panel = this;
    this.screen = null; this.state = {};
    this.hover = null; this.rects = []; this.dirty = true;
    this.refresh = 0; this.refreshT = 0;
  }
  setScreen(screen, state = {}) {
    this.screen = screen; this.state = state; this.hover = null; this.dirty = true;
    this.refresh = screen?.refresh || 0;
    return this;
  }
  redraw() {
    const p = new Painter(this);
    this.rects = [];
    this.g.clearRect(0, 0, this.w, this.h);
    if (this.screen) this.screen.render(p, this.state, this);
    this.tex.needsUpdate = true;
    this.dirty = false;
  }
  update(dt) {
    if (this.refresh > 0) { this.refreshT -= dt; if (this.refreshT <= 0) { this.refreshT = this.refresh; this.dirty = true; } }
    if (this.dirty && this.mesh.visible) this.redraw();
  }
  toPx(uv) { return { x: uv.x * this.w, y: (1 - uv.y) * this.h }; }
  pick(uv) {
    const { x, y } = this.toPx(uv);
    for (let i = this.rects.length - 1; i >= 0; i--) {
      const r = this.rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h && (!r.test || r.test(x, y))) return r;
    }
    return null;
  }
  setHover(id) { if (id !== this.hover) { this.hover = id; this.dirty = true; if (id) ctx.audio?.play('uiHover'); return true; } return false; }
  click(uv) {
    const r = this.pick(uv);
    if (!r || r.enabled === false) { if (r) ctx.audio?.play('deny'); return false; }
    ctx.audio?.play(r.back ? 'uiBack' : 'ui');
    this.dirty = true;
    r.onClick?.();
    return true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tex.dispose(); }
}

// ------------------------------------------------------------------ Painter (immediate mode)
export class Painter {
  constructor(panel) { this.p = panel; this.g = panel.g; this.W = panel.w; this.H = panel.h; }
  font(size, kind = 'body', weight = 400) {
    const fam = kind === 'display' ? FONT_DISPLAY : kind === 'mono' ? FONT_MONO : FONT_BODY;
    return `${weight} ${size}px ${fam}`;
  }
  bg({ x = 0, y = 0, w = this.W, h = this.H, r = 26, fill = C.bg, border = C.accent, bw = 3 } = {}) {
    const g = this.g;
    g.fillStyle = fill; roundRect(g, x + bw, y + bw, w - bw * 2, h - bw * 2, r); g.fill();
    if (border) { g.lineWidth = bw; g.strokeStyle = border; roundRect(g, x + bw, y + bw, w - bw * 2, h - bw * 2, r); g.stroke(); }
  }
  box(x, y, w, h, { fill = C.bg2, border = null, r = 14, bw = 2 } = {}) {
    const g = this.g;
    g.fillStyle = fill; roundRect(g, x, y, w, h, r); g.fill();
    if (border) { g.lineWidth = bw; g.strokeStyle = border; roundRect(g, x, y, w, h, r); g.stroke(); }
  }
  text(str, x, y, { size = 28, color = C.text, kind = 'body', weight = 400, align = 'left', baseline = 'alphabetic', maxW = 0, lineH = 1.3, maxLines = 99 } = {}) {
    const g = this.g;
    g.font = this.font(size, kind, weight); g.fillStyle = color; g.textAlign = align; g.textBaseline = baseline;
    if (!maxW) { g.fillText(str, x, y); return size * lineH; }
    const words = String(str).split(' ');
    let line = '', yy = y, lines = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(test).width > maxW && line) {
        g.fillText(line, x, yy); yy += size * lineH; lines++;
        if (lines >= maxLines) return yy - y;
        line = words[i];
      } else line = test;
    }
    if (line) { g.fillText(line, x, yy); yy += size * lineH; }
    return yy - y;
  }
  measure(str, size = 28, kind = 'body', weight = 400) { this.g.font = this.font(size, kind, weight); return this.g.measureText(str).width; }
  title(str, x, y, size = 56, color = C.accent) { return this.text(str, x, y, { size, color, kind: 'display', weight: 700 }); }
  eyebrow(str, x, y, color = C.dim) {
    const g = this.g;
    g.save(); g.font = this.font(20, 'mono'); g.fillStyle = color; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    let cx = x;
    for (const ch of str.toUpperCase()) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + 2.2; }
    g.restore();
  }
  rule(x, y, w, color = C.line) { this.g.fillStyle = color; this.g.fillRect(x, y, w, 2); }
  bar(x, y, w, h, frac, color = C.good, back = 'rgba(255,255,255,0.12)') {
    const g = this.g;
    g.fillStyle = back; roundRect(g, x, y, w, h, h / 2); g.fill();
    if (frac > 0) { g.fillStyle = color; roundRect(g, x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2); g.fill(); }
  }
  button(id, x, y, w, h, label, onClick, { enabled = true, primary = false, selected = false, sub = null, size = 30, back = false, align = 'center' } = {}) {
    const g = this.g, hover = this.p.hover === id && enabled;
    let fill = primary ? C.accent : 'rgba(239,231,207,0.06)', fg = primary ? C.accentDark : C.text, border = primary ? C.accent : 'rgba(239,231,207,0.28)';
    if (selected) { fill = 'rgba(242,194,48,0.18)'; border = C.accent; fg = C.text; }
    if (hover) { fill = primary ? '#ffd955' : 'rgba(242,194,48,0.92)'; fg = C.accentDark; border = '#ffd955'; }
    if (!enabled) { fill = 'rgba(239,231,207,0.03)'; fg = 'rgba(239,231,207,0.3)'; border = 'rgba(239,231,207,0.1)'; }
    g.fillStyle = fill; roundRect(g, x, y, w, h, 12); g.fill();
    g.lineWidth = 2.5; g.strokeStyle = border; roundRect(g, x, y, w, h, 12); g.stroke();
    const tx = align === 'left' ? x + 22 : x + w / 2;
    if (sub) {
      this.text(label, tx, y + h / 2 - 4, { size, color: fg, weight: 600, align });
      this.text(sub, tx, y + h / 2 + size * 0.75, { size: size * 0.62, color: !enabled ? 'rgba(239,231,207,0.25)' : (hover || primary) ? 'rgba(26,20,6,0.75)' : C.dim, align });
    } else this.text(label, tx, y + h / 2 + size * 0.35, { size, color: fg, weight: 600, align });
    this.p.rects.push({ id, x, y, w, h, onClick, enabled, back });
  }
  // invisible hit area; test(x, y) narrows it to an irregular shape inside the box
  hotspot(id, x, y, w, h, onClick, enabled = true, test = null) { this.p.rects.push({ id, x, y, w, h, onClick, enabled, test }); }
  image(img, x, y, w, h) { this.g.drawImage(img, x, y, w, h); }
}

// ------------------------------------------------------------------ UI manager
export class UI {
  constructor(scene, camera, input) {
    this.scene = scene; this.camera = camera; this.input = input;
    this.panels = new Set();
    this.ray = new THREE.Raycaster();
    this.lasers = {};
    for (const h of ['left', 'right']) {
      const r = new Ribbon(2, 0.006, '#f2c230', { opacity: 0.85 });
      r.fade = true;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe680', depthTest: false, fog: false }));
      dot.renderOrder = 200; dot.visible = false;
      scene.add(r.mesh, dot);
      this.lasers[h] = { ribbon: r, dot };
    }
    this.capture = { left: false, right: false, mouse: false };
    this.menuMode = false; // show lasers even when not pointing at panels
  }
  add(panel) { this.panels.add(panel); return panel; }
  remove(panel) { this.panels.delete(panel); }

  interactiveMeshes() {
    const list = [];
    for (const p of this.panels) if (p.interactive && p.mesh.visible && isVisible(p.mesh)) list.push(p.mesh);
    return list;
  }

  update(dt) {
    for (const p of this.panels) p.update(dt);
    const meshes = this.interactiveMeshes();
    const camPos = this.camera.getWorldPosition(_cp);
    this.capture.left = this.capture.right = this.capture.mouse = false;
    let hovered = new Set();
    if (ctx.isXR) {
      for (const hn of ['left', 'right']) {
        const hand = this.input.hands[hn], L = this.lasers[hn];
        if (!hand.connected || !hand.controller || !meshes.length) { L.ribbon.hide(); L.dot.visible = false; continue; }
        hand.controller.getWorldPosition(_o);
        _d.set(0, 0, -1).applyQuaternion(hand.controller.getWorldQuaternion(_q));
        this.ray.set(_o, _d); this.ray.far = 6;
        const hit = this.ray.intersectObjects(meshes, false)[0];
        if (hit) {
          const panel = hit.object.userData.panel;
          const r = panel.pick(hit.uv);
          panel.setHover(r && r.enabled !== false ? r.id : null);
          hovered.add(panel);
          this.capture[hn] = true;
          L.ribbon.set([_o.x, _o.y, _o.z, hit.point.x, hit.point.y, hit.point.z], 2, camPos);
          L.dot.position.copy(hit.point); L.dot.visible = true;
          if (hand.pressed('trigger')) { panel.click(hit.uv); hand.pulse(0.3, 20); }
          else if (r && panel.lastHoverPulse !== r.id) { hand.pulse(0.12, 8); }
          panel.lastHoverPulse = r ? r.id : null;
        } else if (this.menuMode) {
          L.ribbon.set([_o.x, _o.y, _o.z, _o.x + _d.x * 1.5, _o.y + _d.y * 1.5, _o.z + _d.z * 1.5], 2, camPos);
          L.dot.visible = false;
        } else { L.ribbon.hide(); L.dot.visible = false; }
      }
    } else {
      for (const L of Object.values(this.lasers)) { L.ribbon.hide(); L.dot.visible = false; }
      const m = this.input.mouse;
      if (!m.locked && m.inside && meshes.length) {
        _v2.set(m.x, m.y);
        this.ray.setFromCamera(_v2, this.camera);
        this.ray.far = 20;
        const hit = this.ray.intersectObjects(meshes, false)[0];
        if (hit) {
          const panel = hit.object.userData.panel;
          const r = panel.pick(hit.uv);
          panel.setHover(r && r.enabled !== false ? r.id : null);
          hovered.add(panel);
          this.capture.mouse = true;
          document.body.style.cursor = r && r.enabled !== false ? 'pointer' : 'default';
          if (this.input.mousePressed(0)) panel.click(hit.uv);
        } else document.body.style.cursor = 'default';
      }
    }
    for (const p of this.panels) if (!hovered.has(p) && p.hover) p.setHover(null);
  }
}
function isVisible(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _cp = new THREE.Vector3(), _v2 = new THREE.Vector2();

// ------------------------------------------------------------------ Head-following placement for VR
// Keeps a panel in front of the viewer, following lazily on yaw.
export class Follower {
  // deadzone: how far you can look away before it follows; recentre: once following, come all the way back in front
  constructor(object, { dist = 1.6, height = 0, lag = 3, yawOffset = 0, deadzone = 0.35, recentre = false } = {}) {
    this.o = object; this.dist = dist; this.height = height; this.lag = lag; this.yawOffset = yawOffset;
    this.deadzone = deadzone; this.recentre = recentre; this.chasing = false;
    this.yaw = null; this.pos = new THREE.Vector3();
  }
  snap() { this.yaw = null; }
  update(dt, camera) {
    camera.getWorldPosition(_hp);
    camera.getWorldDirection(_hd);
    const targetYaw = Math.atan2(_hd.x, _hd.z) + this.yawOffset;
    if (this.yaw === null) this.yaw = targetYaw;
    else {
      let d = targetYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > this.deadzone) this.chasing = true;
      if (this.chasing) {
        this.yaw += d * Math.min(1, dt * this.lag);
        if (!this.recentre || Math.abs(d) < 0.08) this.chasing = false;
      }
    }
    this.o.position.set(_hp.x + Math.sin(this.yaw) * this.dist, _hp.y + this.height, _hp.z + Math.cos(this.yaw) * this.dist);
    this.o.lookAt(_hp.x, _hp.y + this.height * 0.6, _hp.z);
  }
}
const _hp = new THREE.Vector3(), _hd = new THREE.Vector3();
