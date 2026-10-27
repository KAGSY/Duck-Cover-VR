// All sound is synthesised with WebAudio: no downloads, works offline.
import { ctx as G, clamp } from './ctx.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const N = { G2: 43, A2: 45, B2: 47, C3: 48, D3: 50, E3: 52, G3: 55, A3: 57, B3: 59, C4: 60, D4: 62, E4: 64, Fs4: 66, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, Fs5: 78, G5: 79 };

export class AudioEngine {
  constructor() { this.ac = null; this.loops = new Set(); this.musicOn = false; this.hrtf = false; }

  init(hrtf = false) {
    this.hrtf = hrtf;
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ac = new AC(); } catch (e) { this.ac = null; return; }
    const a = this.ac;
    this.comp = a.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 6; this.comp.attack.value = 0.003; this.comp.release.value = 0.25;
    this.master = a.createGain(); this.master.connect(this.comp); this.comp.connect(a.destination);
    this.sfx = a.createGain(); this.sfx.connect(this.master);
    this.music = a.createGain(); this.music.connect(this.master);
    this.amb = a.createGain(); this.amb.connect(this.master);
    const len = a.sampleRate * 2;
    this.noiseBuf = a.createBuffer(1, len, a.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // brown-ish noise for rumbles/wind
    this.brownBuf = a.createBuffer(1, len, a.sampleRate);
    const b = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.applyVolumes();
  }

  get ready() { return !!this.ac && this.ac.state === 'running'; }
  get now() { return this.ac.currentTime; }

  applyVolumes() {
    if (!this.ac) return;
    const s = G.settings || {};
    this.master.gain.value = s.master ?? 0.8;
    this.sfx.gain.value = s.sfx ?? 0.9;
    this.music.gain.value = (s.music ?? 0.5) * 0.55;
    this.amb.gain.value = (s.sfx ?? 0.9) * 0.6;
  }

  setListener(pos, fwd, up) {
    if (!this.ac) return;
    const L = this.ac.listener;
    if (L.positionX) {
      const t = this.ac.currentTime;
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // Output node for a one-shot: spatial when pos is given.
  out(pos, vol = 1, bus = this.sfx) {
    const g = this.ac.createGain();
    g.gain.value = vol;
    if (pos) {
      const p = this.ac.createPanner();
      p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 0.85; p.maxDistance = 500;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); p.connect(bus);
      g._panner = p;
    } else g.connect(bus);
    return g;
  }
  movePanner(g, pos) {
    const p = g._panner; if (!p) return;
    if (p.positionX) { const t = this.ac.currentTime; p.positionX.setTargetAtTime(pos.x, t, 0.03); p.positionY.setTargetAtTime(pos.y, t, 0.03); p.positionZ.setTargetAtTime(pos.z, t, 0.03); }
    else p.setPosition(pos.x, pos.y, pos.z);
  }

  noise(brown = false) {
    const s = this.ac.createBufferSource();
    s.buffer = brown ? this.brownBuf : this.noiseBuf;
    s.loop = true;
    return s;
  }
  env(g, t, a, peak, d, end = 0.0001) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(end, t + a + d);
  }
  tone(type, f0, f1, dur, out, t, vol = 0.5, attack = 0.005) {
    const o = this.ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ac.createGain();
    this.env(g, t, attack, vol, dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + attack + dur + 0.05);
    return o;
  }
  burst(out, t, { type = 'lowpass', f0 = 2000, f1 = 300, q = 0.7, dur = 0.5, vol = 0.8, attack = 0.004, brown = false }) {
    const s = this.noise(brown);
    const f = this.ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ac.createGain();
    this.env(g, t, attack, vol, dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + attack + dur + 0.05);
  }

  play(name, pos = null, opts = {}) {
    if (!this.ac || this.ac.state !== 'running') return;
    const t = this.ac.currentTime + 0.005;
    const vol = opts.vol ?? 1, pitch = opts.pitch ?? 1;
    const o = this.out(pos, vol);
    switch (name) {
      case 'explosion': {
        const size = clamp(opts.size ?? 1, 0.3, 2);
        this.burst(o, t, { f0: 2600, f1: 140, dur: 1.1 + size * 0.6, vol: 1.0, brown: false });
        this.burst(o, t, { f0: 600, f1: 60, dur: 1.4 + size * 0.5, vol: 0.9, brown: true });
        this.tone('sine', 90, 32, 0.7, o, t, 0.9);
        this.burst(o, t + 0.05, { type: 'bandpass', f0: 1800, f1: 600, q: 1.5, dur: 0.35, vol: 0.25 });
        break;
      }
      case 'launch':
        this.burst(o, t, { type: 'bandpass', f0: 600, f1: 2400, q: 1.2, dur: 0.45, vol: 0.7 });
        this.tone('sine', 140, 60, 0.25, o, t, 0.6);
        break;
      case 'mortar':
        this.tone('sine', 120, 45, 0.35, o, t, 0.9);
        this.burst(o, t, { f0: 1200, f1: 200, dur: 0.4, vol: 0.6 });
        break;
      case 'throw':
        this.burst(o, t, { type: 'bandpass', f0: 500, f1: 1800, q: 2, dur: 0.22, vol: 0.4 });
        break;
      case 'shot':
        this.burst(o, t, { type: 'highpass', f0: 2500, f1: 900, dur: 0.12, vol: 0.8, attack: 0.001 });
        this.tone('square', 220, 80, 0.06, o, t, 0.25, 0.001);
        break;
      case 'snipe':
        this.burst(o, t, { type: 'highpass', f0: 3000, f1: 600, dur: 0.3, vol: 1.0, attack: 0.001 });
        this.tone('sine', 160, 50, 0.3, o, t, 0.6, 0.001);
        break;
      case 'slap':
        this.burst(o, t, { type: 'bandpass', f0: 1400, f1: 700, q: 1.2, dur: 0.12, vol: 0.9, attack: 0.001 });
        break;
      case 'place': this.tone('square', 300, 300, 0.05, o, t, 0.2); this.tone('square', 600, 600, 0.05, o, t + 0.08, 0.2); break;
      case 'beep': this.tone('square', 1300 * pitch, 1300 * pitch, 0.07, o, t, 0.25); break;
      case 'radio':
        this.burst(o, t, { type: 'bandpass', f0: 1800, f1: 1600, q: 3, dur: 0.5, vol: 0.25 });
        this.tone('square', 900, 900, 0.08, o, t + 0.05, 0.15); this.tone('square', 1200, 1200, 0.08, o, t + 0.18, 0.15);
        break;
      case 'heal': [N.C5, N.E5, N.G5].forEach((n, i) => this.tone('sine', NOTE(n), NOTE(n), 0.25, o, t + i * 0.08, 0.3)); break;
      case 'pickup': [N.G4, N.B4, N.D5, N.G5].forEach((n, i) => this.tone('triangle', NOTE(n), NOTE(n), 0.18, o, t + i * 0.06, 0.35)); break;
      case 'gull': this.tone('sawtooth', 1400, 900, 0.25, o, t, 0.15); this.tone('sawtooth', 1500, 1000, 0.3, o, t + 0.3, 0.12); break;
      case 'bounce': this.tone('sine', 380 * pitch, 160, 0.08, o, t, 0.4, 0.001); this.burst(o, t, { type: 'highpass', f0: 2000, f1: 1500, dur: 0.04, vol: 0.2, attack: 0.001 }); break;
      case 'thud': this.tone('sine', 110, 50, 0.2, o, t, 0.6, 0.002); this.burst(o, t, { f0: 800, f1: 150, dur: 0.2, vol: 0.4 }); break;
      case 'splash':
        this.burst(o, t, { f0: 4000, f1: 500, dur: 0.6 * (opts.size ?? 1), vol: 0.6 });
        for (let i = 0; i < 4; i++) this.tone('sine', 500 + Math.random() * 600, 900 + Math.random() * 600, 0.06, o, t + 0.05 + i * 0.05, 0.08);
        break;
      case 'whistle': this.tone('sine', 1700, 650, opts.dur ?? 1.2, o, t, 0.18, 0.2); break;
      case 'plane': {
        const osc = this.ac.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(95, t); osc.frequency.linearRampToValueAtTime(70, t + 3.5);
        const f = this.ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
        const g = this.ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
        osc.connect(f); f.connect(g); g.connect(o); osc.start(t); osc.stop(t + 3.7);
        break;
      }
      case 'quack': this.quack(o, t, pitch, 'normal'); break;
      case 'quackHurt': this.quack(o, t, pitch, 'hurt'); break;
      case 'quackDie': this.quack(o, t, pitch, 'die'); break;
      case 'quackCheer': this.quack(o, t, pitch * 1.1, 'normal'); this.quack(o, t + 0.2, pitch * 1.2, 'normal'); break;
      case 'ui': this.tone('square', 1100, 1100, 0.035, o, t, 0.12, 0.001); break;
      case 'uiHover': this.tone('sine', 1900, 1900, 0.02, o, t, 0.05, 0.001); break;
      case 'uiBack': this.tone('square', 700, 500, 0.05, o, t, 0.12, 0.001); break;
      case 'deny': this.tone('square', 220, 180, 0.12, o, t, 0.18, 0.002); break;
      case 'swoosh': this.burst(o, t, { type: 'bandpass', f0: 400, f1: 1600, q: 1.5, dur: 0.18, vol: 0.25 }); break;
      case 'turn': [N.G4, N.C5, N.E5].forEach((n, i) => this.tone('triangle', NOTE(n), NOTE(n), 0.16, o, t + i * 0.1, 0.25)); break;
      case 'enemyTurn': [N.E4, N.C4].forEach((n, i) => this.tone('triangle', NOTE(n), NOTE(n), 0.2, o, t + i * 0.14, 0.22)); break;
      case 'tick': this.tone('square', 1500, 1500, 0.02, o, t, 0.08, 0.001); break;
      case 'victory': {
        const seq = [[N.G4, 0], [N.B4, 0.15], [N.D5, 0.3], [N.G5, 0.45], [N.D5, 0.75], [N.G5, 0.9]];
        for (const [n, dt] of seq) this.tone('square', NOTE(n), NOTE(n), dt >= 0.9 ? 0.8 : 0.16, o, t + dt, 0.18);
        break;
      }
      case 'defeat': {
        const seq = [[N.G4, 0], [N.E4, 0.3], [N.C4, 0.6], [N.G3, 0.9]];
        for (const [n, dt] of seq) this.tone('triangle', NOTE(n), NOTE(n) * 0.98, 0.32, o, t + dt, 0.25);
        break;
      }
    }
  }

  quack(out, t, pitch, kind) {
    const a = this.ac;
    const osc = a.createOscillator(); osc.type = 'sawtooth';
    let dur = 0.16, f0 = 470 * pitch, f1 = 400 * pitch;
    if (kind === 'hurt') { dur = 0.3; f0 = 720 * pitch; f1 = 520 * pitch; }
    if (kind === 'die') { dur = 0.75; f0 = 620 * pitch; f1 = 190 * pitch; }
    osc.frequency.setValueAtTime(f0 * 0.85, t);
    osc.frequency.linearRampToValueAtTime(f0, t + 0.025);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (kind !== 'normal') {
      const lfo = a.createOscillator(); lfo.frequency.value = kind === 'die' ? 14 : 28;
      const lg = a.createGain(); lg.gain.value = f0 * 0.06;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    const f1n = a.createBiquadFilter(); f1n.type = 'bandpass'; f1n.frequency.value = 1150; f1n.Q.value = 5;
    const f2n = a.createBiquadFilter(); f2n.type = 'bandpass'; f2n.frequency.value = 2700; f2n.Q.value = 7;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f1n); osc.connect(f2n); f1n.connect(lp); f2n.connect(lp); lp.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  // Looping sound attached to a moving thing. Returns {move(pos), stop()}.
  loop(name, pos) {
    if (!this.ac || this.ac.state !== 'running') return { move() {}, stop() {}, set() {} };
    const a = this.ac, t = a.currentTime;
    const o = this.out(pos, 1);
    const nodes = [];
    let setFn = () => {};
    if (name === 'rocket' || name === 'homing') {
      const s = this.noise(); const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.4;
      const g = a.createGain(); g.gain.value = 0.35;
      s.connect(f); f.connect(g); g.connect(o); s.start(t); nodes.push(s);
    } else if (name === 'charge') {
      const osc = a.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 180;
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = a.createGain(); g.gain.value = 0.06;
      osc.connect(f); f.connect(g); g.connect(o); osc.start(t); nodes.push(osc);
      setFn = (v) => { osc.frequency.setTargetAtTime(180 + v * 520, a.currentTime, 0.03); };
    } else if (name === 'fuse') {
      const s = this.noise(); const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
      const g = a.createGain(); g.gain.value = 0.12;
      s.connect(f); f.connect(g); g.connect(o); s.start(t); nodes.push(s);
    }
    const h = {
      move: (p) => this.movePanner(o, p),
      set: (v) => setFn(v),
      stop: () => {
        const tt = a.currentTime;
        o.gain.setTargetAtTime(0.0001, tt, 0.05);
        for (const n of nodes) { try { n.stop(tt + 0.3); } catch (e) {} }
        this.loops.delete(h);
      },
    };
    this.loops.add(h);
    return h;
  }
  stopLoops() { for (const h of [...this.loops]) h.stop(); }

  // Ambient bed per biome.
  ambience(biome, look) {
    this.stopAmbience();
    if (!this.ac) return;
    const a = this.ac, t = a.currentTime;
    const nodes = [];
    const wind = this.noise(true);
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = look === 'blizzard' ? 900 : 420;
    const g = a.createGain(); g.gain.value = look === 'blizzard' ? 0.5 : biome === 'snow' ? 0.3 : 0.16;
    const lfo = a.createOscillator(); lfo.frequency.value = 0.07;
    const lg = a.createGain(); lg.gain.value = g.gain.value * 0.6;
    lfo.connect(lg); lg.connect(g.gain);
    wind.connect(lp); lp.connect(g); g.connect(this.amb);
    wind.start(t); lfo.start(t);
    nodes.push(wind, lfo);
    this.ambNodes = nodes;
    const birds = biome !== 'snow' && look !== 'blizzard';
    if (birds) {
      const chirp = () => {
        if (!this.ambNodes) return;
        const tt = a.currentTime;
        const o = this.out(null, 0.5, this.amb);
        const base = 2600 + Math.random() * 1600;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) this.tone('sine', base, base * (1.1 + Math.random() * 0.3), 0.07, o, tt + i * 0.11, 0.05);
        this.ambTimer = setTimeout(chirp, 2500 + Math.random() * 6000);
      };
      this.ambTimer = setTimeout(chirp, 1500);
    }
  }
  stopAmbience() {
    if (this.ambNodes) for (const n of this.ambNodes) { try { n.stop(); } catch (e) {} }
    this.ambNodes = null;
    clearTimeout(this.ambTimer);
  }

  // Simple march for the menus (original tune).
  startMusic() {
    if (!this.ac || this.musicOn) return;
    this.musicOn = true;
    const a = this.ac;
    const bpm = 108, s16 = 60 / bpm / 4;
    const melody = [N.G4, 0, N.G4, 0, N.B4, 0, N.D5, 0, N.D5, 0, N.B4, 0, N.G4, 0, 0, 0,
      N.A4, 0, N.A4, 0, N.C5, 0, N.E5, 0, N.D5, 0, 0, 0, 0, 0, 0, 0,
      N.G4, 0, N.B4, 0, N.D5, 0, N.G5, 0, N.E5, 0, N.D5, 0, N.B4, 0, N.G4, 0,
      N.A4, 0, N.B4, 0, N.C5, 0, N.A4, 0, N.G4, 0, 0, 0, 0, 0, 0, 0];
    const bass = [N.G2, N.D3, N.G2, N.D3, N.C3, N.G2, N.D3, N.A2, N.G2, N.D3, N.E3, N.B2, N.C3, N.D3, N.G2, N.G2];
    const snare = '1001001010111000';
    let step = 0, next = a.currentTime + 0.1;
    const tick = () => {
      if (!this.musicOn) return;
      while (next < a.currentTime + 0.2) {
        const i = step % 64;
        if (melody[i]) {
          const o = this.music;
          const osc = a.createOscillator(); osc.type = 'square'; osc.frequency.value = NOTE(melody[i]);
          const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1700;
          const g = a.createGain(); this.env(g, next, 0.01, 0.12, s16 * 1.8);
          osc.connect(f); f.connect(g); g.connect(o); osc.start(next); osc.stop(next + s16 * 2);
        }
        if (step % 4 === 0) this.tone('triangle', NOTE(bass[(step / 4) % 16]), NOTE(bass[(step / 4) % 16]), s16 * 3, this.music, next, 0.22);
        if (snare[step % 16] === '1') this.burst(this.music, next, { type: 'highpass', f0: 2200, f1: 1500, dur: 0.07, vol: 0.18, attack: 0.001 });
        if (step % 8 === 0) this.tone('sine', 90, 40, 0.15, this.music, next, 0.35, 0.002);
        step++; next += s16;
      }
      this.musicTimer = setTimeout(tick, 60);
    };
    tick();
  }
  stopMusic() { this.musicOn = false; clearTimeout(this.musicTimer); }
}
