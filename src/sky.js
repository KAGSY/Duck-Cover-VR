// Sky dome, lighting presets per time of day, distant hills and water.
import * as THREE from 'three';
import { makeNoise2D, fbm } from './rng.js';
import { HALF } from './terrain.js';
import { ctx } from './ctx.js';

const C = (s) => new THREE.Color(s);

// Time-of-day looks. Angles in degrees.
export const LOOKS = {
  morning: {
    sunElev: 20, sunAz: 115, zenith: '#5b8fcf', horizon: '#e7d6bb', ground: '#6f7466',
    sun: '#ffe1b3', sunI: 2.9, hemiSky: '#c4d8ef', hemiGround: '#6a6650', hemiI: 1.55,
    fog: [75, 360], cloud: 0.42, waterDeep: '#1d4656', waterShallow: '#5b8a80', sunDisc: 1,
  },
  noon: {
    sunElev: 58, sunAz: 160, zenith: '#3f7fd0', horizon: '#c9dcee', ground: '#6f7466',
    sun: '#fff5e3', sunI: 3.0, hemiSky: '#bcd6f2', hemiGround: '#6b6a55', hemiI: 1.45,
    fog: [90, 420], cloud: 0.36, waterDeep: '#1b4a62', waterShallow: '#4f8f8a', sunDisc: 1,
  },
  afternoon: {
    sunElev: 34, sunAz: 225, zenith: '#4a82c8', horizon: '#e0dccb', ground: '#6f7466',
    sun: '#ffeccb', sunI: 3.0, hemiSky: '#c2d6ec', hemiGround: '#6e6a52', hemiI: 1.5,
    fog: [85, 400], cloud: 0.4, waterDeep: '#1d4a5c', waterShallow: '#58907f', sunDisc: 1,
  },
  dusk: {
    sunElev: 9, sunAz: 255, zenith: '#38558e', horizon: '#f0a66a', ground: '#5d5650',
    sun: '#ffb070', sunI: 2.5, hemiSky: '#9fb2d4', hemiGround: '#5f5048', hemiI: 1.4,
    fog: [65, 300], cloud: 0.5, waterDeep: '#1f3248', waterShallow: '#6b6f72', sunDisc: 1,
  },
  sunset: {
    sunElev: 5, sunAz: 270, zenith: '#2f3f78', horizon: '#ff9259', ground: '#56484a',
    sun: '#ff9a55', sunI: 2.3, hemiSky: '#a49ccb', hemiGround: '#5a4742', hemiI: 1.35,
    fog: [60, 290], cloud: 0.55, waterDeep: '#22304a', waterShallow: '#79686a', sunDisc: 1,
  },
  overcast: {
    sunElev: 40, sunAz: 200, zenith: '#8e9aa6', horizon: '#c9d0d6', ground: '#7a7f84',
    sun: '#f1f3f5', sunI: 1.25, hemiSky: '#dfe5ea', hemiGround: '#8a8c88', hemiI: 2.5,
    fog: [55, 260], cloud: 0.85, waterDeep: '#3a5260', waterShallow: '#8aa3a8', sunDisc: 0,
  },
  blizzard: {
    sunElev: 35, sunAz: 200, zenith: '#b7c0c8', horizon: '#d6dce1', ground: '#c1c7cc',
    sun: '#f4f6f8', sunI: 0.9, hemiSky: '#e8edf1', hemiGround: '#a6adb3', hemiI: 2.75,
    fog: [12, 95], cloud: 0.95, waterDeep: '#5b7584', waterShallow: '#a6bcc4', sunDisc: 0,
  },
};

export function sunDirection(look) {
  const el = look.sunElev * Math.PI / 180, az = look.sunAz * Math.PI / 180;
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
}

export function createSky(look, cloudTex, quality) {
  const geo = new THREE.SphereGeometry(500, 24, 12);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: C(look.zenith) }, uHorizon: { value: C(look.horizon) }, uGround: { value: C(look.ground) },
      uSunDir: { value: sunDirection(look) }, uSunColor: { value: C(look.sun) },
      tCloud: { value: cloudTex }, uTime: { value: 0 }, uCover: { value: look.cloud },
      uSunDisc: { value: look.sunDisc }, uClouds: { value: quality.cloudLayer ? 1 : 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
        gl_Position.z = p.w * 0.99999;
      }`,
    fragmentShader: `
      uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
      uniform sampler2D tCloud; uniform float uTime, uCover, uSunDisc, uClouds;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
        col = mix(col, uGround, smoothstep(0.0, -0.12, h));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 1400.0) * 5.0 * uSunDisc + pow(sd, 10.0) * 0.22 + pow(sd, 3.0) * 0.06);
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 0.22 + vec2(uTime * 0.0025, uTime * 0.0012);
          float c = uClouds > 0.5 ? texture2D(tCloud, uv).r : 0.5 + 0.5 * sin(uv.x * 3.0) * sin(uv.y * 2.3);
          float cov = smoothstep(1.0 - uCover, 1.0 - uCover + 0.32, c);
          vec3 cc = mix(uHorizon, vec3(1.0), 0.55) * (0.78 + 0.3 * pow(sd, 4.0));
          col = mix(col, cc, cov * smoothstep(0.0, 0.18, h) * 0.85);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.renderOrder = 1000; // drawn after opaque geometry so hidden pixels are skipped
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mesh.position.setFromMatrixPosition(camera.matrixWorld);
    mesh.updateMatrixWorld();
  };
  return mesh;
}

export function createLights(look, quality) {
  const group = new THREE.Group();
  const hemi = new THREE.HemisphereLight(C(look.hemiSky), C(look.hemiGround), look.hemiI);
  const sun = new THREE.DirectionalLight(C(look.sun), look.sunI);
  const dir = sunDirection(look);
  sun.position.copy(dir).multiplyScalar(120);
  sun.target.position.set(0, 0, 0);
  group.add(hemi, sun, sun.target);
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const s = 45;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 300 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    sun.shadow.camera.updateProjectionMatrix();
  }
  return { group, hemi, sun, dir };
}

// Keep the shadow frustum centred on the viewer, snapped to texels to avoid shimmer.
export function updateShadowFollow(lights, center) {
  const sun = lights.sun;
  if (!sun.castShadow) return;
  const size = sun.shadow.mapSize.x, span = sun.shadow.camera.right - sun.shadow.camera.left;
  const texel = span / size;
  const cx = Math.round(center.x / texel) * texel, cz = Math.round(center.z / texel) * texel;
  sun.target.position.set(cx, 0, cz);
  sun.position.copy(lights.dir).multiplyScalar(120).add(sun.target.position);
  sun.target.updateMatrixWorld();
}

// Rings of distant hills give the horizon depth. Fog blends them into the sky.
export function createHills(biome, color, seed) {
  const noise = makeNoise2D(seed + 999);
  const cfg = {
    marsh: { rings: [[430, 520, 4, 18], [660, 780, 10, 34]], flat: false },
    farm: { rings: [[430, 520, 6, 24], [660, 780, 14, 48]], flat: false },
    snow: { rings: [[430, 530, 14, 60], [660, 800, 40, 120]], flat: false },
    canyon: { rings: [[430, 530, 8, 40], [660, 800, 16, 70]], flat: true },
    weir: { rings: [[430, 520, 6, 26], [660, 780, 16, 52]], flat: false },
  }[biome] || { rings: [[430, 520, 6, 24]], flat: false };
  const pos = [], col = [], idx = [];
  const base = C(color), dark = base.clone().multiplyScalar(0.55), top = base.clone().lerp(new THREE.Color(1, 1, 1), biome === 'snow' ? 0.5 : 0.08);
  const segs = 120;
  for (let ri = 0; ri < cfg.rings.length; ri++) {
    const [r0, r1, hmin, hmax] = cfg.rings[ri];
    const startIdx = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const a = s / segs * Math.PI * 2;
      const nx = Math.cos(a) * 3 + ri * 10, nz = Math.sin(a) * 3;
      let h = hmin + (hmax - hmin) * (0.5 + 0.5 * fbm(noise, nx, nz, 4));
      if (cfg.flat) h = Math.round(h / 12) * 12 + 4;
      const ca = Math.cos(a), sa = Math.sin(a);
      pos.push(ca * r0, -6, sa * r0); col.push(dark.r, dark.g, dark.b);
      pos.push(ca * r1, h, sa * r1); col.push(top.r, top.g, top.b);
      pos.push(ca * (r1 + 90), -6, sa * (r1 + 90)); col.push(dark.r, dark.g, dark.b);
    }
    for (let s = 0; s < segs; s++) {
      const a = startIdx + s * 3, b = startIdx + (s + 1) * 3;
      idx.push(a, a + 1, b, b, a + 1, b + 1, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'hills';
  mesh.frustumCulled = false;
  return mesh;
}

export function createWater(terrain, look, noiseTex, quality, biome) {
  const geo = new THREE.PlaneGeometry(1800, 1800, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const deep = C(look.waterDeep), shallow = C(look.waterShallow);
  if (biome === 'snow') { deep.lerp(C('#6f8fa0'), 0.5); shallow.lerp(C('#bcd4dc'), 0.5); }
  if (biome === 'canyon') { shallow.lerp(C('#8a7a5a'), 0.35); }
  if (biome === 'marsh') { deep.lerp(C('#24382c'), 0.45); shallow.lerp(C('#5a6a46'), 0.4); }
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, tDepth: { value: null }, tNoise: { value: null },
    uDeep: { value: deep }, uShallow: { value: shallow }, uSky: { value: C(look.horizon).lerp(C(look.zenith), 0.25) },
    uSunDir: { value: sunDirection(look) }, uSunColor: { value: C(look.sun).multiplyScalar(look.sunDisc ? 1 : 0.15) },
    uMapHalf: { value: HALF }, uDetail: { value: quality.water === 'detailed' ? 1 : 0 },
  }]);
  uniforms.tDepth.value = terrain.depthTex;
  uniforms.tNoise.value = noiseTex;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime, uMapHalf, uDetail;
      uniform sampler2D tDepth, tNoise;
      uniform vec3 uDeep, uShallow, uSky, uSunDir, uSunColor;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        vec2 muv = (vWorld.xz + uMapHalf) / (2.0 * uMapHalf);
        float inside = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
        float depth = mix(1.0, texture2D(tDepth, clamp(muv, 0.0, 1.0)).r, inside) * 6.0;
        vec2 p = vWorld.xz;
        vec2 nn = texture2D(tNoise, p * 0.045 + uTime * vec2(0.011, 0.007)).xy - 0.5;
        if (uDetail > 0.5) nn += (texture2D(tNoise, p * 0.13 - uTime * vec2(0.009, 0.015)).xy - 0.5) * 0.8;
        vec3 N = normalize(vec3(nn.x * 0.55, 1.0, nn.y * 0.55));
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.05 + 0.95 * pow(1.0 - ndv, 4.0);
        vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 3.5, depth));
        vec3 col = mix(base, uSky, clamp(fres * 0.9, 0.0, 1.0));
        vec3 H = normalize(uSunDir + V);
        col += uSunColor * pow(max(dot(N, H), 0.0), 180.0) * 2.2;
        float foamN = texture2D(tNoise, p * 0.23 + vec2(uTime * 0.03, uTime * 0.01)).z;
        float band = smoothstep(0.55, 0.0, depth) * inside;
        float foam = band * smoothstep(0.42, 0.7, foamN + 0.22 * sin(uTime * 1.7 + depth * 13.0));
        col = mix(col, vec3(0.9, 0.93, 0.93), foam * 0.7);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
