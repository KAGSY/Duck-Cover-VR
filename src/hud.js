// In-battle HUD: wrist map, turn banner, toasts, tutorial hints, weapon label.
import * as THREE from 'three';
import { ctx, clamp, on } from './ctx.js';
import { Panel, C } from './ui.js';
import { WEAPONS } from './weapons.js';
import { HALF, MAP_SIZE } from './terrain.js';
import { roundRect } from './duck.js';
import { classTitle, classColor } from './classes.js';

// ------------------------------------------------------------------ Wrist map
export class WristHUD {
  constructor() {
    this.panel = new Panel({ w: 512, h: 512, meters: 0.2, name: 'wrist', interactive: false, order: 70 });
    this.panel.refresh = 0.12;
    this.panel.setScreen({ render: (p) => this.render(p) });
    this.panel.refresh = 0.12;
  }
  render(p) {
    const b = ctx.battle, g = p.g, W = 512;
    p.bg({ r: 30, fill: 'rgba(12,20,17,0.92)', border: 'rgba(242,194,48,0.85)', bw: 4 });
    if (!b) return;
    const team = b.team, d = b.active, mine = ctx.player?.duck;
    const human = b.isHumanTurn();
    // header
    const tc = team ? team.tagColor : C.text;
    g.fillStyle = tc; g.fillRect(22, 22, 10, 50);
    p.text(b.phase === 'over' ? 'BATTLE OVER' : human ? 'YOUR TURN' : (team ? team.faction.short.toUpperCase() : ''), 44, 50, { size: 30, kind: 'display', weight: 700, color: human ? C.accent : C.text });
    p.text(d ? d.name : '', 44, 74, { size: 21, color: C.dim });
    if (d) { const nw = g.measureText(d.name).width; p.text(classTitle(d.rank || 1, d.branch).toUpperCase(), 52 + nw, 74, { size: 17, weight: 700, color: classColor(d.rank || 1, d.branch) }); }
    const t = b.timer;
    p.text(t === Infinity || b.phase !== 'act' ? '--' : String(Math.max(0, Math.ceil(t))), W - 26, 66, { size: 46, kind: 'mono', align: 'right', color: t < 10 && b.phase === 'act' ? C.bad : C.text });
    // minimap, heading-up, centred on the viewer
    const mx = 22, my = 92, mw = W - 44, mh = 270;
    g.save();
    roundRect(g, mx, my, mw, mh, 16); g.clip();
    g.fillStyle = '#2a4a52'; g.fillRect(mx, my, mw, mh);
    const T = ctx.world?.terrain;
    const cam = ctx.camera;
    cam.getWorldPosition(_v); cam.getWorldDirection(_d);
    const heading = Math.atan2(_d.x, _d.z);
    const span = 120; // metres across the map width
    const scale = mw / span;
    const cx = mx + mw / 2, cy = my + mh * 0.6;
    g.translate(cx, cy);
    g.rotate(Math.PI + heading); // forward (heading) points up
    if (T) {
      if (T.minimapDirty || !T.mini) T.drawMinimap(192);
      const s = MAP_SIZE * scale;
      g.drawImage(T.mini, (-HALF - _v.x) * scale, (-HALF - _v.z) * scale, s, s);
    }
    // objectives
    const obj = b.mission.objective;
    if (ctx.world?.zone) { const z = ctx.world.zone; g.strokeStyle = C.accent; g.lineWidth = 3; g.beginPath(); g.arc((z.x - _v.x) * scale, (z.z - _v.z) * scale, z.r * scale, 0, 6.29); g.stroke(); }
    if (ctx.world?.captive) { const c = ctx.world.captive; g.fillStyle = C.accent; g.fillRect((c.x - _v.x) * scale - 6, (c.z - _v.z) * scale - 6, 12, 12); }
    for (const s of ctx.world?.structures.items || []) {
      if (!s.alive || s.objective !== 'target') continue;
      const x = (s.x - _v.x) * scale, y = (s.z - _v.z) * scale;
      g.strokeStyle = C.bad; g.lineWidth = 4; g.beginPath(); g.moveTo(x - 7, y - 7); g.lineTo(x + 7, y + 7); g.moveTo(x + 7, y - 7); g.lineTo(x - 7, y + 7); g.stroke();
    }
    for (const c of b.crates) { g.fillStyle = c.kind === 'health' ? '#e8f5e8' : '#d9c27a'; g.fillRect((c.x - _v.x) * scale - 4, (c.z - _v.z) * scale - 4, 8, 8); }
    for (const m of b.mines) { if (m.hidden && !m.mesh.visible) continue; g.fillStyle = C.bad; g.beginPath(); g.arc((m.x - _v.x) * scale, (m.z - _v.z) * scale, 3, 0, 6.29); g.fill(); }
    for (const du of b.ducks) {
      if (!du.alive || (du.camo && du.team.control === 'ai')) continue;
      const x = (du.pos.x - _v.x) * scale, y = (du.pos.z - _v.z) * scale;
      g.fillStyle = du.team.tagColor; g.beginPath(); g.arc(x, y, du === d ? 8 : 6, 0, 6.29); g.fill();
      g.strokeStyle = '#0c1411'; g.lineWidth = 2; g.stroke();
      if (du.commander) { g.fillStyle = C.accent; g.beginPath(); g.arc(x, y, 3, 0, 6.29); g.fill(); }
      if (du === d) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 12, 0, 6.29); g.stroke(); }
    }
    for (const pr of b.projectiles) { g.fillStyle = '#ffe680'; g.beginPath(); g.arc((pr.x - _v.x) * scale, (pr.z - _v.z) * scale, 3, 0, 6.29); g.fill(); }
    g.restore();
    // viewer marker (always pointing up)
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(cx, cy - 12); g.lineTo(cx - 8, cy + 8); g.lineTo(cx + 8, cy + 8); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - 70, my); g.moveTo(cx, cy); g.lineTo(cx + 70, my); g.stroke();
    // bottom row: weapon, time left, wind
    const by = 384;
    const w = d ? d.weapon : null;
    if (w && human && mine === d) {
      p.text(WEAPONS[w].name.toUpperCase(), 26, by + 26, { size: 27, kind: 'display', weight: 700 });
      const a = d.ammo[w];
      p.text(a === Infinity ? 'unlimited' : `${a} left`, 26, by + 56, { size: 22, color: C.dim });
      p.text('TIME', 26, by + 96, { size: 18, kind: 'mono', color: C.dim });
      p.bar(90, by + 82, 210, 16, b.turnTime > 0 && b.timer !== Infinity ? b.timer / b.turnTime : 1, b.timer < 10 ? C.bad : C.info);
    } else if (d) {
      p.text(`${d.name}`, 26, by + 26, { size: 25, weight: 600 });
      p.bar(26, by + 42, 270, 14, d.hp / d.maxHp, d.hp / d.maxHp > 0.5 ? C.good : d.hp / d.maxHp > 0.25 ? C.accent : C.bad);
      p.text(human ? '' : 'Watching the enemy…', 26, by + 92, { size: 21, color: C.dim });
    }
    // wind arrow relative to heading
    const wx = 410, wy = by + 52;
    g.strokeStyle = 'rgba(239,231,207,0.25)'; g.lineWidth = 2; g.beginPath(); g.arc(wx, wy, 44, 0, 6.29); g.stroke();
    if (b.windStrength > 0) {
      const wa = Math.atan2(b.wind.x, b.wind.z) - heading;
      g.save(); g.translate(wx, wy); g.rotate(-wa);
      const len = 14 + b.windStrength * 3.4;
      g.fillStyle = b.windStrength > 5 ? C.bad : b.windStrength > 2 ? C.accent : C.good;
      g.beginPath(); g.moveTo(0, -len); g.lineTo(-10, -len + 16); g.lineTo(-3, -len + 16); g.lineTo(-3, len * 0.6); g.lineTo(3, len * 0.6); g.lineTo(3, -len + 16); g.lineTo(10, -len + 16); g.closePath(); g.fill();
      g.restore();
    } else p.text('calm', wx, wy + 8, { size: 20, color: C.dim, align: 'center' });
    p.text(`WIND ${b.windStrength}`, wx, by + 118, { size: 18, kind: 'mono', align: 'center', color: C.dim });
    // objective line
    p.text(obj?.text || '', 26, 492, { size: 20, color: C.dim, maxW: 460, maxLines: 1 });
  }
}
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

// ------------------------------------------------------------------ Turn banner
export class Banner {
  constructor() {
    this.panel = new Panel({ w: 1024, h: 210, meters: 1.1, name: 'banner', interactive: false, depthTest: false, order: 90 });
    this.title = ''; this.sub = ''; this.color = C.accent; this.t = 0;
    this.panel.setScreen({ render: (p) => {
      p.bg({ r: 24, fill: 'rgba(12,20,17,0.88)', border: this.color, bw: 4 });
      p.text(this.title, 512, 104, { size: 74, kind: 'display', weight: 700, align: 'center', color: this.color });
      p.text(this.sub, 512, 160, { size: 32, align: 'center', color: C.text });
    } });
    this.panel.mesh.visible = false;
  }
  show(title, sub = '', color = C.accent, dur = 2.4) { this.title = title; this.sub = sub; this.color = color; this.t = dur; this.panel.dirty = true; this.panel.mesh.visible = true; this.onShow?.(); }
  update(dt) {
    if (this.t <= 0) return;
    this.t -= dt;
    this.panel.mesh.material.opacity = clamp(this.t * 3, 0, 1);
    if (this.t <= 0) this.panel.mesh.visible = false;
  }
}

// ------------------------------------------------------------------ Toasts
export class Toasts {
  constructor() {
    this.panel = new Panel({ w: 1024, h: 200, meters: 0.9, name: 'toasts', interactive: false, depthTest: false, order: 89 });
    this.items = [];
    this.panel.setScreen({ render: (p) => {
      let y = 4;
      for (const it of this.items.slice(-3)) {
        const a = clamp(it.t, 0, 1);
        const col = it.kind === 'good' ? C.good : it.kind === 'bad' ? C.bad : C.info;
        p.g.globalAlpha = a;
        const w = Math.min(1000, p.measure(it.text, 30, 'body', 600) + 70);
        p.box(512 - w / 2, y, w, 56, { fill: 'rgba(12,20,17,0.85)', r: 12 });
        p.g.fillStyle = col; p.g.fillRect(512 - w / 2, y, 8, 56);
        p.text(it.text, 512 + 4, y + 38, { size: 30, weight: 600, align: 'center' });
        p.g.globalAlpha = 1;
        y += 64;
      }
    } });
    this.panel.mesh.visible = false;
  }
  push(text, kind = 'info') { this.items.push({ text, kind, t: 3.6 }); if (this.items.length > 6) this.items.shift(); this.panel.mesh.visible = true; this.panel.dirty = true; }
  update(dt) {
    if (!this.items.length) return;
    for (const it of this.items) it.t -= dt;
    const before = this.items.length;
    this.items = this.items.filter(it => it.t > 0);
    this.panel.dirty = true;
    if (!this.items.length) this.panel.mesh.visible = false;
  }
  clear() { this.items = []; this.panel.mesh.visible = false; }
}

// ------------------------------------------------------------------ Tutorial hint
export class Hint {
  constructor() {
    this.panel = new Panel({ w: 960, h: 190, meters: 0.85, name: 'hint', interactive: false, depthTest: false, order: 88 });
    this.text = '';
    this.panel.setScreen({ render: (p) => {
      p.bg({ r: 20, fill: 'rgba(12,20,17,0.9)', border: C.info, bw: 3 });
      p.eyebrow('Sergeant says', 32, 46, C.info);
      p.text(this.text, 32, 92, { size: 31, maxW: 896, lineH: 1.28, maxLines: 3 });
    } });
    this.panel.mesh.visible = false;
  }
  show(text) { if (text === this.text && this.panel.mesh.visible) return; this.text = text; this.panel.dirty = true; this.panel.mesh.visible = !!text; }
  hide() { this.panel.mesh.visible = false; this.text = ''; }
}

// ------------------------------------------------------------------ Weapon label by the hand
export class HandLabel {
  constructor() {
    this.panel = new Panel({ w: 512, h: 150, meters: 0.16, name: 'handlabel', interactive: false, order: 71 });
    this.weapon = ''; this.ammo = ''; this.power = -1; this.hold = 0; this.t = 0;
    this.panel.setScreen({ render: (p) => {
      p.bg({ r: 18, fill: 'rgba(12,20,17,0.88)', border: 'rgba(242,194,48,0.8)', bw: 3 });
      p.text(this.weapon, 24, 56, { size: 40, kind: 'display', weight: 700 });
      p.text(this.ammo, 488, 56, { size: 30, kind: 'mono', align: 'right', color: C.dim });
      if (this.power >= 0) { p.bar(24, 86, 464, 30, this.power, this.power > 0.85 ? C.bad : C.accent); }
      else if (this.hold > 0) { p.text('Ending turn…', 24, 112, { size: 28, color: C.dim }); p.bar(230, 92, 258, 22, this.hold, C.info); }
      else p.text(this.hintText || '', 24, 112, { size: 25, color: C.dim });
    } });
    this.panel.mesh.visible = false;
  }
  set(weapon, ammo, power = -1, hold = 0, hint = '') {
    const key = `${weapon}|${ammo}|${power.toFixed(2)}|${hold.toFixed(2)}|${hint}`;
    if (key !== this.key) { this.key = key; this.weapon = weapon; this.ammo = ammo; this.power = power; this.hold = hold; this.hintText = hint; this.panel.dirty = true; }
  }
}
