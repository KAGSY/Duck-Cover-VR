// Particles (two instanced billboard systems), ribbons for arcs/lasers, markers.
import * as THREE from 'three';
import { PCELL } from './textures.js';
import { WATER } from './terrain.js';
import { ctx } from './ctx.js';

const VERT = `
  attribute vec3 iPos; attribute float iSize; attribute vec4 iColor; attribute float iRot; attribute float iCell;
  varying vec2 vUv; varying vec4 vColor; varying float vPDepth;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    vPDepth = -mvPosition.z;
    float c = cos(iRot), s = sin(iRot);
    vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
    mvPosition.xy += p * iSize;
    gl_Position = projectionMatrix * mvPosition;
    float cx = mod(iCell, 4.0), cy = floor(iCell / 4.0 + 0.01);
    vUv = vec2((cx + uv.x) / 4.0, 1.0 - (cy + 1.0 - uv.y) / 2.0);
    vColor = iColor;
    #include <fog_vertex>
  }`;
const FRAG_ALPHA = `
  uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(map, vUv);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;
const FRAG_ADD = `
  uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear, fogFar;
  varying vec2 vUv; varying vec4 vColor; varying float vPDepth;
  void main() {
    vec4 t = texture2D(map, vUv);
    float ff = smoothstep(fogNear, fogFar, vPDepth);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a * (1.0 - ff));
    #include <colorspace_fragment>
  }`;

class ParticleSystem {
  constructor(max, atlas, additive) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(3); this.aSize = mk(1); this.aColor = mk(4); this.aRot = mk(1); this.aCell = mk(1);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iSize', this.aSize); geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iRot', this.aRot); geo.setAttribute('iCell', this.aCell);
    geo.instanceCount = 0;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]);
    uniforms.map.value = atlas;
    this.mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: additive ? FRAG_ADD : FRAG_ALPHA,
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 31 : 30;
    // simulation state (struct of arrays)
    const F = (n = 1) => new Float32Array(max * n);
    this.p = F(3); this.v = F(3); this.life = F(); this.maxLife = F(); this.s0 = F(); this.s1 = F();
    this.c0 = F(4); this.c1 = F(4); this.rot = F(); this.rotV = F(); this.cell = F(); this.grav = F(); this.drag = F(); this.ground = new Uint8Array(max);
    this.count = 0;
  }
  spawn(o) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    this.p[i * 3] = o.x; this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx || 0; this.v[i * 3 + 1] = o.vy || 0; this.v[i * 3 + 2] = o.vz || 0;
    this.life[i] = 0; this.maxLife[i] = o.life || 1;
    this.s0[i] = o.size ?? 1; this.s1[i] = o.size1 ?? this.s0[i];
    const c0 = o.color || [1, 1, 1, 1], c1 = o.color1 || c0;
    this.c0.set(c0, i * 4); this.c1.set(c1, i * 4);
    this.rot[i] = o.rot ?? Math.random() * 6.28; this.rotV[i] = o.rotV || 0;
    this.cell[i] = o.cell || 0; this.grav[i] = o.grav || 0; this.drag[i] = o.drag || 0;
    this.ground[i] = o.ground ? 1 : 0;
    return i;
  }
  kill(i) {
    const j = --this.count;
    if (i === j) return;
    this.p.copyWithin(i * 3, j * 3, j * 3 + 3); this.v.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.c0.copyWithin(i * 4, j * 4, j * 4 + 4); this.c1.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.rot[i] = this.rot[j]; this.rotV[i] = this.rotV[j]; this.cell[i] = this.cell[j]; this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j]; this.ground[i] = this.ground[j];
  }
  update(dt, terrain) {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this.kill(i); continue; }
      const k = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.v[k] *= dr; this.v[k + 2] *= dr; this.v[k + 1] = this.v[k + 1] * dr - this.grav[i] * dt;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
      this.rot[i] += this.rotV[i] * dt;
      if (this.ground[i] && terrain) {
        const h = Math.max(terrain.heightAt(this.p[k], this.p[k + 2]), WATER - 0.05) + this.s0[i] * 0.3;
        if (this.p[k + 1] < h) { this.p[k + 1] = h; this.v[k] *= 0.4; this.v[k + 2] *= 0.4; this.v[k + 1] = Math.abs(this.v[k + 1]) * 0.25; this.rotV[i] *= 0.5; }
      }
    }
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.maxLife[i];
      this.aPos.array[i * 3] = this.p[i * 3]; this.aPos.array[i * 3 + 1] = this.p[i * 3 + 1]; this.aPos.array[i * 3 + 2] = this.p[i * 3 + 2];
      this.aSize.array[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let c = 0; c < 4; c++) this.aColor.array[i * 4 + c] = this.c0[i * 4 + c] + (this.c1[i * 4 + c] - this.c0[i * 4 + c]) * t;
      this.aRot.array[i] = this.rot[i];
      this.aCell.array[i] = this.cell[i];
    }
    this.mesh.geometry.instanceCount = n;
    for (const a of [this.aPos, this.aSize, this.aColor, this.aRot, this.aCell]) {
      a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true;
    }
  }
  clear() { this.count = 0; this.mesh.geometry.instanceCount = 0; }
}

const R = (a, b) => a + Math.random() * (b - a);
function rndDir(out, upBias = 0) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
  out[0] = r * Math.cos(th); out[1] = Math.abs(u) * (1 - upBias) + upBias; out[2] = r * Math.sin(th);
  return out;
}

export class FX {
  constructor(scene, atlas, quality) {
    const max = quality.particles;
    this.alpha = new ParticleSystem(Math.round(max * 0.65), atlas, false);
    this.add = new ParticleSystem(Math.round(max * 0.35), atlas, true);
    scene.add(this.alpha.mesh, this.add.mesh);
    this.scale = Math.min(1.4, max / 400 + 0.2);
    this.terrain = null;
    this.ambient = null;
  }
  n(base) { return Math.max(1, Math.round(base * this.scale)); }
  update(dt) {
    this.alpha.update(dt, this.terrain);
    this.add.update(dt, this.terrain);
    if (this.ambient) this.ambient(dt);
  }
  clear() { this.alpha.clear(); this.add.clear(); }

  explosion(x, y, z, radius, ground = [0.35, 0.28, 0.2], water = false) {
    const d = [0, 0, 0];
    this.add.spawn({ x, y: y + 0.4, z, size: radius * 1.6, size1: radius * 3.4, life: 0.22, cell: PCELL.glow, color: [1, 0.92, 0.7, 1], color1: [1, 0.6, 0.2, 0] });
    this.add.spawn({ x, y: y + 0.3, z, size: radius * 0.6, size1: radius * 3.2, life: 0.38, cell: PCELL.ring, color: [1, 0.95, 0.85, 0.55], color1: [1, 0.8, 0.5, 0], rot: 0 });
    for (let i = 0, n = this.n(7 + radius); i < n; i++) {
      rndDir(d, 0.3); const sp = R(2, 6);
      this.add.spawn({ x: x + d[0] * radius * 0.25, y: y + 0.4 + d[1] * 0.4, z: z + d[2] * radius * 0.25, vx: d[0] * sp, vy: d[1] * sp + 1.5, vz: d[2] * sp,
        size: radius * R(0.35, 0.55), size1: radius * R(0.9, 1.3), life: R(0.45, 0.8), cell: PCELL.smoke, color: [1, 0.62, 0.2, 0.95], color1: [0.6, 0.12, 0.02, 0], drag: 2.5, rotV: R(-1, 1) });
    }
    for (let i = 0, n = this.n(9 + radius * 1.5); i < n; i++) {
      rndDir(d, 0.4); const sp = R(1, 3.5);
      const g = R(0.14, 0.26);
      this.alpha.spawn({ x: x + d[0] * radius * 0.3, y: y + 0.5 + d[1], z: z + d[2] * radius * 0.3, vx: d[0] * sp, vy: R(1, 3), vz: d[2] * sp,
        size: radius * R(0.4, 0.7), size1: radius * R(1.4, 2.2), life: R(2.4, 4.0), cell: PCELL.smoke,
        color: water ? [0.85, 0.9, 0.92, 0.7] : [g, g * 0.95, g * 0.9, 0.72], color1: water ? [0.9, 0.92, 0.95, 0] : [g * 2, g * 2, g * 2, 0], drag: 1.2, grav: -0.35, rotV: R(-0.6, 0.6) });
    }
    if (water) {
      for (let i = 0, n = this.n(18); i < n; i++) {
        rndDir(d, 0.7); const sp = R(5, 13);
        this.alpha.spawn({ x, y: WATER + 0.1, z, vx: d[0] * sp * 0.4, vy: d[1] * sp + 4, vz: d[2] * sp * 0.4, size: R(0.25, 0.5), size1: R(0.4, 0.7), life: R(1.0, 1.8),
          cell: PCELL.drop, color: [0.85, 0.92, 0.95, 0.9], color1: [0.85, 0.92, 0.95, 0.2], grav: 9.8 });
      }
      this.alpha.spawn({ x, y: WATER + 1.5, z, vy: 2, size: radius * 0.6, size1: radius * 1.8, life: 1.2, cell: PCELL.smoke, color: [0.92, 0.96, 0.98, 0.8], color1: [0.92, 0.96, 0.98, 0] });
      this.ring(x, z, radius * 1.4, [0.9, 0.95, 0.97]);
    } else {
      for (let i = 0, n = this.n(12 + radius * 2); i < n; i++) {
        rndDir(d, 0.55); const sp = R(5, 12);
        const k = R(0.6, 1.0);
        this.alpha.spawn({ x: x + d[0] * 0.5, y: y + 0.3, z: z + d[2] * 0.5, vx: d[0] * sp * 0.7, vy: d[1] * sp + 2, vz: d[2] * sp * 0.7,
          size: R(0.18, 0.45), life: R(1.4, 2.4), cell: PCELL.chunk, color: [ground[0] * k, ground[1] * k, ground[2] * k, 1], color1: [ground[0] * k, ground[1] * k, ground[2] * k, 0.9],
          grav: 9.8, rotV: R(-8, 8), ground: true });
      }
      for (let i = 0, n = this.n(8); i < n; i++) {
        const a = i / 8 * Math.PI * 2, sp = R(6, 9);
        this.alpha.spawn({ x, y: y + 0.4, z, vx: Math.cos(a) * sp, vy: 0.4, vz: Math.sin(a) * sp, size: 1, size1: radius * 0.9, life: 1.3, cell: PCELL.smoke,
          color: [ground[0] * 1.6, ground[1] * 1.6, ground[2] * 1.6, 0.55], color1: [ground[0] * 1.8, ground[1] * 1.8, ground[2] * 1.8, 0], drag: 3 });
      }
    }
    for (let i = 0, n = this.n(10); i < n; i++) {
      rndDir(d, 0.2); const sp = R(8, 18);
      this.add.spawn({ x, y: y + 0.5, z, vx: d[0] * sp, vy: d[1] * sp, vz: d[2] * sp, size: R(0.12, 0.22), life: R(0.4, 0.9), cell: PCELL.spark, color: [1, 0.85, 0.45, 1], color1: [1, 0.35, 0.1, 0], grav: 9.8, drag: 0.5 });
    }
  }

  ring(x, z, radius, color) {
    for (let i = 0; i < this.n(14); i++) {
      const a = i / 14 * Math.PI * 2;
      this.alpha.spawn({ x: x + Math.cos(a) * 0.5, y: WATER + 0.15, z: z + Math.sin(a) * 0.5, vx: Math.cos(a) * radius, vz: Math.sin(a) * radius, size: 0.6, size1: 1.6, life: 0.9,
        cell: PCELL.smoke, color: [...color, 0.65], color1: [...color, 0], drag: 2.2 });
    }
  }

  splash(x, z, size = 1) {
    const d = [0, 0, 0];
    for (let i = 0, n = this.n(10 * size); i < n; i++) {
      rndDir(d, 0.6); const sp = R(2, 5) * size;
      this.alpha.spawn({ x, y: WATER + 0.1, z, vx: d[0] * sp * 0.5, vy: d[1] * sp + 2, vz: d[2] * sp * 0.5, size: R(0.15, 0.3) * size, life: R(0.6, 1.1), cell: PCELL.drop, color: [0.85, 0.92, 0.95, 0.9], color1: [0.85, 0.92, 0.95, 0.1], grav: 9.8 });
    }
    this.ring(x, z, 2 * size, [0.9, 0.95, 0.97]);
  }

  trail(x, y, z, kind = 'rocket') {
    if (kind === 'rocket' || kind === 'homing') {
      this.alpha.spawn({ x, y, z, vy: 0.3, size: 0.25, size1: 1.3, life: R(0.9, 1.4), cell: PCELL.smoke, color: [0.82, 0.82, 0.8, 0.5], color1: [0.9, 0.9, 0.9, 0], drag: 1, rotV: R(-1, 1) });
      this.add.spawn({ x, y, z, size: 0.45, size1: 0.1, life: 0.12, cell: PCELL.glow, color: [1, 0.7, 0.3, 0.9], color1: [1, 0.3, 0.1, 0] });
    } else if (kind === 'shell' || kind === 'cluster' || kind === 'bomb') {
      this.alpha.spawn({ x, y, z, size: 0.15, size1: 0.6, life: 0.6, cell: PCELL.smoke, color: [0.7, 0.7, 0.7, 0.3], color1: [0.8, 0.8, 0.8, 0] });
    } else if (kind === 'bullet') {
      this.add.spawn({ x, y, z, size: 0.12, size1: 0.04, life: 0.08, cell: PCELL.glow, color: [1, 0.9, 0.6, 0.8], color1: [1, 0.8, 0.4, 0] });
    }
  }

  muzzle(x, y, z, dx, dy, dz, big = true) {
    this.add.spawn({ x: x + dx * 0.2, y: y + dy * 0.2, z: z + dz * 0.2, size: big ? 0.9 : 0.4, size1: 0.2, life: 0.1, cell: PCELL.glow, color: [1, 0.85, 0.5, 1], color1: [1, 0.5, 0.2, 0] });
    for (let i = 0; i < this.n(4); i++) {
      const sp = R(1, 3);
      this.alpha.spawn({ x: x + dx * 0.3, y: y + dy * 0.3, z: z + dz * 0.3, vx: dx * sp, vy: dy * sp + 0.4, vz: dz * sp, size: 0.3, size1: big ? 1.4 : 0.6, life: R(0.6, 1.1), cell: PCELL.smoke, color: [0.8, 0.8, 0.78, 0.45], color1: [0.9, 0.9, 0.9, 0], drag: 2 });
    }
  }

  feathers(x, y, z, colors, count = 10) {
    const d = [0, 0, 0];
    for (let i = 0, n = this.n(count); i < n; i++) {
      rndDir(d, 0.5); const sp = R(1.5, 4.5);
      const c = colors[i % colors.length];
      this.alpha.spawn({ x, y: y + R(0.4, 1.2), z, vx: d[0] * sp, vy: d[1] * sp + 1.5, vz: d[2] * sp, size: R(0.16, 0.26), life: R(2.0, 3.2), cell: PCELL.feather,
        color: [c.r, c.g, c.b, 1], color1: [c.r, c.g, c.b, 0], grav: 1.4, drag: 2.2, rotV: R(-5, 5) });
    }
  }

  sparkle(x, y, z, color = [0.5, 1, 0.55], count = 12) {
    for (let i = 0, n = this.n(count); i < n; i++) {
      const a = Math.random() * 6.28, r = R(0.2, 0.7);
      this.add.spawn({ x: x + Math.cos(a) * r, y: y + R(0, 1.2), z: z + Math.sin(a) * r, vy: R(0.8, 1.8), size: R(0.15, 0.3), size1: 0.02, life: R(0.8, 1.4), cell: PCELL.star, color: [...color, 1], color1: [...color, 0], rotV: R(-2, 2) });
    }
  }

  dust(x, y, z, ground = [0.4, 0.35, 0.28], n = 6) {
    for (let i = 0; i < this.n(n); i++) {
      const a = Math.random() * 6.28, sp = R(0.8, 2);
      this.alpha.spawn({ x, y: y + 0.15, z, vx: Math.cos(a) * sp, vy: R(0.2, 0.7), vz: Math.sin(a) * sp, size: R(0.3, 0.5), size1: R(1.0, 1.6), life: R(0.7, 1.2), cell: PCELL.smoke,
        color: [ground[0] * 1.5, ground[1] * 1.5, ground[2] * 1.5, 0.45], color1: [ground[0] * 1.7, ground[1] * 1.7, ground[2] * 1.7, 0], drag: 2 });
    }
  }

  debris(x, y, z, color = [0.42, 0.3, 0.18], n = 16, leaves = false) {
    const d = [0, 0, 0];
    for (let i = 0, m = this.n(n); i < m; i++) {
      rndDir(d, 0.4); const sp = R(3, 9);
      const leaf = leaves && i % 2 === 0;
      this.alpha.spawn({ x: x + d[0], y: y + R(0.5, 2.5), z: z + d[2], vx: d[0] * sp, vy: d[1] * sp + 2, vz: d[2] * sp, size: leaf ? R(0.2, 0.35) : R(0.2, 0.55),
        life: R(1.5, 2.6), cell: leaf ? PCELL.feather : PCELL.chunk, color: leaf ? [0.25, 0.42, 0.14, 1] : [...color, 1], color1: leaf ? [0.3, 0.42, 0.15, 0] : [...color, 0.8],
        grav: leaf ? 2 : 9.8, drag: leaf ? 1.8 : 0.3, rotV: R(-6, 6), ground: !leaf });
    }
  }

  // Continuous snow for blizzard maps, spawned around a point.
  setSnow(on, centerFn) {
    if (!on) { this.ambient = null; return; }
    let acc = 0;
    this.ambient = (dt) => {
      acc += dt * 60 * this.scale;
      const c = centerFn();
      while (acc > 1) {
        acc -= 1;
        this.alpha.spawn({ x: c.x + R(-14, 14), y: c.y + R(2, 8), z: c.z + R(-14, 14), vx: R(2.5, 4.5), vy: -R(1.2, 2.2), vz: R(-1, 1), size: R(0.05, 0.09), life: 4, cell: PCELL.drop, color: [1, 1, 1, 0.9], color1: [1, 1, 1, 0.5] });
      }
    };
  }
}

// --------------------------------------------------------------- ribbons
// A strip of quads along a polyline. mode 'view' faces the camera, 'flat' lies on the ground.
export class Ribbon {
  constructor(maxPoints, width, color, { opacity = 0.9, mode = 'view', dashed = false, additive = false, depthTest = true } = {}) {
    this.max = maxPoints; this.width = width; this.mode = mode; this.dashed = dashed;
    this.color = new THREE.Color(color); this.opacity = opacity;
    const pos = new Float32Array(maxPoints * 2 * 3), col = new Float32Array(maxPoints * 2 * 4);
    const idx = [];
    for (let i = 0; i < maxPoints - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos); geo.setAttribute('color', this.col);
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
    this.mesh.visible = false;
  }
  setColor(c, opacity = this.opacity) { this.color.set(c); this.opacity = opacity; }
  // pts: flat array [x,y,z,...]; n: point count; cam: Vector3
  set(pts, n, cam) {
    n = Math.min(n, this.max);
    if (n < 2) { this.mesh.visible = false; return; }
    const P = this.pos.array, C = this.col.array, w = this.width * 0.5;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let tx = pts[b * 3] - pts[a * 3], ty = pts[b * 3 + 1] - pts[a * 3 + 1], tz = pts[b * 3 + 2] - pts[a * 3 + 2];
      let sx, sy, sz;
      if (this.mode === 'flat') { sx = -tz; sy = 0; sz = tx; }
      else {
        const vx = pts[i * 3] - cam.x, vy = pts[i * 3 + 1] - cam.y, vz = pts[i * 3 + 2] - cam.z;
        sx = ty * vz - tz * vy; sy = tz * vx - tx * vz; sz = tx * vy - ty * vx;
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      sx = sx / l * w; sy = sy / l * w; sz = sz / l * w;
      P[i * 6] = pts[i * 3] - sx; P[i * 6 + 1] = pts[i * 3 + 1] - sy; P[i * 6 + 2] = pts[i * 3 + 2] - sz;
      P[i * 6 + 3] = pts[i * 3] + sx; P[i * 6 + 4] = pts[i * 3 + 1] + sy; P[i * 6 + 5] = pts[i * 3 + 2] + sz;
      const t = i / (n - 1);
      let al = this.opacity * (this.fade ? (1 - t * 0.85) : 1);
      if (this.dashed && (i >> 1) % 2 === 1) al *= 0.15;
      for (let k = 0; k < 2; k++) { C[i * 8 + k * 4] = this.color.r; C[i * 8 + k * 4 + 1] = this.color.g; C[i * 8 + k * 4 + 2] = this.color.b; C[i * 8 + k * 4 + 3] = al; }
    }
    this.mesh.geometry.setDrawRange(0, (n - 1) * 6);
    this.pos.needsUpdate = true; this.col.needsUpdate = true;
    this.mesh.visible = true;
  }
  hide() { this.mesh.visible = false; }
}

// A flat pulsing ring that sits on the ground (targets, teleport landing).
export function makeGroundRing(color, inner = 0.6, outer = 0.8) {
  const geo = new THREE.RingGeometry(inner, outer, 32);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  mesh.renderOrder = 41;
  mesh.visible = false;
  return mesh;
}
