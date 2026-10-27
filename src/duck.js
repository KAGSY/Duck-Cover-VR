// Ducks: anthropomorphic soldier ducks (a duck's head on a human-shaped body in field uniform).
// One skinned mesh per duck (a single draw call), procedural animation with IK for weapon holds,
// and a full-body mode that maps a VR player's head and hands onto their own duck.
import * as THREE from 'three';
import { GeoBuilder, M, sph, cyl, cone, box } from './models.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, smoothstep } from './ctx.js';
import { pointBone, solveTwoBone, setBoneWorldQuat } from './ik.js';
import { BRANCHES, classTitle, classColor } from './classes.js';

export const SPECIES = {
  mallard: { head: '#1f5a3a', neck: '#f2f0e8', chest: '#6b3f2a', body: '#a9a294', wing: '#76695c', speculum: '#3a4fb0', tail: '#2b2b2b', bill: '#e2b53c', feet: '#e8892b' },
  teal: { head: '#7a3a22', neck: '#7a3a22', chest: '#d9c9a6', body: '#9a9a92', wing: '#7a7a72', speculum: '#1f8a5a', tail: '#3a3a36', bill: '#3a3a3a', feet: '#8a8a78', patch: '#1f6a4a' },
  eider: { head: '#f0efe8', neck: '#b8d8a0', chest: '#f0e3cf', body: '#f1f0ea', wing: '#1d1d1d', speculum: '#ffffff', tail: '#1d1d1d', bill: '#9aa87a', feet: '#9a9a6a', cap: '#1a1a1a' },
  merganser: { head: '#1f3a2e', neck: '#f2f0e8', chest: '#b5603a', body: '#8a8a88', wing: '#3a3a3a', speculum: '#f0f0f0', tail: '#5a5a58', bill: '#c0392b', feet: '#d9532b', crest: '#1f3a2e' },
  muscovy: { head: '#1c1c22', neck: '#f1f1ee', chest: '#1c1c22', body: '#22242a', wing: '#1a2a24', speculum: '#f1f1ee', tail: '#1c1c22', bill: '#e8b0a8', feet: '#5a5a5a', face: '#b51f2a' },
};

// ---------------------------------------------------------------- skeleton
// Bind pose: standing upright, arms hanging at the sides, facing +Z. The duck's left is +X.
const PIV = {
  root: [0, 0, 0], hips: [0, 0.92, 0], spine: [0, 1.04, 0], chest: [0, 1.2, 0], neck: [0, 1.41, -0.005], head: [0, 1.5, 0.005], bib: [0, 1.38, 0.1],
  clavL: [0.05, 1.37, 0], uarmL: [0.19, 1.355, -0.005], farmL: [0.205, 1.075, -0.01], handL: [0.21, 0.835, 0.005],
  fingL: [0.215, 0.745, 0.006], indexL: [0.215, 0.745, 0.04], thumbL: [0.2, 0.805, 0.04],
  thighL: [0.095, 0.875, 0], shinL: [0.1, 0.475, 0.012], footL: [0.1, 0.085, -0.01],
};
for (const k of Object.keys(PIV)) if (k.endsWith('L')) PIV[k.slice(0, -1) + 'R'] = [-PIV[k][0], PIV[k][1], PIV[k][2]];
const PARENT = { hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', bib: 'chest' };
for (const s of 'LR') Object.assign(PARENT, {
  ['clav' + s]: 'chest', ['uarm' + s]: 'clav' + s, ['farm' + s]: 'uarm' + s, ['hand' + s]: 'farm' + s,
  ['fing' + s]: 'hand' + s, ['index' + s]: 'hand' + s, ['thumb' + s]: 'hand' + s,
  ['thigh' + s]: 'hips', ['shin' + s]: 'thigh' + s, ['foot' + s]: 'shin' + s,
});
const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'bib']; // bib: chest feathers in the collar, hidden from your own eyes
for (const s of 'LR') BONES.push('clav' + s, 'uarm' + s, 'farm' + s, 'hand' + s, 'fing' + s, 'index' + s, 'thumb' + s);
for (const s of 'LR') BONES.push('thigh' + s, 'shin' + s, 'foot' + s);
const BI = Object.fromEntries(BONES.map((n, i) => [n, i]));

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
function limb(a, b, c) {
  const A = v3(PIV[a]), Bp = v3(PIV[b]), C = v3(PIV[c]);
  return { restA: Bp.clone().sub(A).normalize(), restB: C.clone().sub(Bp).normalize(), lenA: A.distanceTo(Bp), lenB: Bp.distanceTo(C) };
}
const LIMB = {};
for (const s of 'LR') { LIMB['arm' + s] = limb('uarm' + s, 'farm' + s, 'hand' + s); LIMB['leg' + s] = limb('thigh' + s, 'shin' + s, 'foot' + s); }
const CLAV = { L: v3(PIV.uarmL).sub(v3(PIV.clavL)).normalize(), R: v3(PIV.uarmR).sub(v3(PIV.clavR)).normalize() };
const NECK_REST = v3(PIV.head).sub(v3(PIV.neck)).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
// Body measurements other modules rely on (eye height, collision, muzzle position).
export const BODY = { eye: 1.62, neck: PIV.neck[1], torso: PIV.neck[1] - PIV.hips[1], ankle: PIV.footL[1] };
// Shoulder-mounted weapons pivot here (mesh space); muzzleFor() in battle.js uses the same numbers.
export const MUZZLE = { right: 0.21, up: 1.5, fwd: 1.2 };
const PIVOT_C = new THREE.Vector3(-MUZZLE.right, MUZZLE.up - PIV.chest[1], 0); // in chest-bone space

// ---------------------------------------------------------------- hands
// Bind-pose hand frame: fingers point down, the back of the hand faces outward (+X left, -X right).
const HAND_BIND = {};
for (const [s, sd] of [['L', 1], ['R', -1]]) {
  const f = new THREE.Vector3(0, -1, 0), k = new THREE.Vector3(sd, 0, 0), c = new THREE.Vector3().crossVectors(f, k);
  HAND_BIND[s] = new THREE.Matrix4().makeBasis(f, k, c).transpose();
}
const _hb = new THREE.Matrix4(), _hf = new THREE.Vector3(), _hk = new THREE.Vector3(), _hc = new THREE.Vector3();
// World rotation for a hand bone so its fingers point along F with the back of the hand toward K.
export function handQuat(side, F, K, out = new THREE.Quaternion()) {
  _hf.copy(F).normalize();
  _hk.copy(K).addScaledVector(_hf, -K.dot(_hf));
  if (_hk.lengthSq() < 1e-8) _hk.set(0, 1, 0).addScaledVector(_hf, -_hf.y);
  _hk.normalize();
  _hc.crossVectors(_hf, _hk);
  _hb.makeBasis(_hf, _hk, _hc).multiply(HAND_BIND[side]);
  return out.setFromRotationMatrix(_hb);
}

// ---------------------------------------------------------------- uniform + geometry
const shade = (c, f) => { const k = new THREE.Color(c); k.r *= f; k.g *= f; k.b *= f; return k; };
function uniformOf(look) {
  const tunic = new THREE.Color(look.tunic || shade(look.helmet || '#5d6a3a', 1.1));
  return {
    tunic, tunicDark: shade(tunic, 0.76),
    trousers: new THREE.Color(look.trousers || shade(look.belt || '#3c4628', 1.3)),
    puttee: new THREE.Color(look.puttee || shade(look.belt || '#3c4628', 1.6)),
    glove: new THREE.Color(look.glove || '#3d3128'),
    belt: new THREE.Color(look.belt || '#3c4628'), accent: look.accent || '#e2c044',
  };
}
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sq = new THREE.Quaternion(), _ss = new THREE.Vector3();
// Matrix that stands a Y-aligned primitive between a (its +Y end) and b.
function seg(a, b, sx = 1, sz = sx) {
  _sa.set(a[0], a[1], a[2]); _sb.set(b[0], b[1], b[2]);
  const mid = _sa.clone().add(_sb).multiplyScalar(0.5);
  _sq.setFromUnitVectors(UP, _sa.clone().sub(_sb).normalize());
  return new THREE.Matrix4().compose(mid, _sq, _ss.set(sx, 1, sz));
}
const segLen = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// torso skin: hips -> spine -> chest by height
const torsoSkin = (x, y) => y < 0.97 ? [BI.hips, BI.hips, 0]
  : y < 1.1 ? [BI.hips, BI.spine, smoothstep(0.97, 1.1, y)]
    : y < 1.27 ? [BI.spine, BI.chest, smoothstep(1.1, 1.27, y)] : [BI.chest, BI.chest, 0];

// look: { species, helmet, belt, accent, tunic?, trousers?, puttee?, glove?, rank, commander }
export function buildDuckGeometry(look, seed = 1, detail = 1) {
  const sg = (n) => Math.max(4, Math.round(n * detail));
  const b = new GeoBuilder(seed);
  const s = SPECIES[look.species] || SPECIES.mallard;
  const U = uniformOf(look);
  const T = { skin: torsoSkin };
  const one = (name, extra) => ({ bone: BI[name], ...extra });

  // --- torso: a lathe shaped into a barrel-chested field jacket (seam at the back, under the pack)
  const prof = [[0.001, 0.83], [0.15, 0.835], [0.172, 0.88], [0.168, 0.95], [0.158, 1.02], [0.152, 1.07], [0.162, 1.15], [0.178, 1.24], [0.176, 1.31], [0.158, 1.37], [0.12, 1.415], [0.075, 1.44], [0.001, 1.446]];
  const lat = new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p[0], p[1])), sg(16), Math.PI);
  const pa = lat.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const y = pa.getY(i);
    const chest = smoothstep(1.08, 1.22, y) * (1 - smoothstep(1.32, 1.43, y));
    const z = pa.getZ(i);
    pa.setXYZ(i, pa.getX(i) * (1.12 + chest * 0.06), y, z * (z > 0 ? 0.82 + chest * 0.22 : 0.74));
  }
  lat.computeVertexNormals();
  b.add(lat, U.tunic, null, { ...T, jitter: 0.03, ao: 0.16 });
  lat.dispose();
  b.add(sph(0.15, sg(12), sg(8)), U.trousers, M(0, 0.845, -0.005, 0, 0, 0, 1.1, 0.6, 0.92), one('hips'));
  // belt kit
  b.add(cyl(1, 1, 0.055, sg(18), true), U.belt, M(0, 0.98, 0.004, 0, 0, 0, 0.192, 1, 0.14), one('hips'));
  b.add(box(0.058, 0.046, 0.02), U.accent, M(0, 0.98, 0.148), one('hips'));
  for (const sd of [1, -1]) b.add(box(0.066, 0.062, 0.04), U.belt, M(sd * 0.088, 0.963, 0.137, 0, sd * 0.42, 0), one('hips', { ao: 0.2 }));
  b.add(cyl(0.048, 0.048, 0.11, sg(10)), shade(U.belt, 0.8), M(-0.165, 0.915, -0.07, 0, 0, 0, 1, 1, 0.75), one('hips'));
  // cross strap, pack and bedroll
  const sp = [[0.11, 1.4, 0.075], [0.015, 1.22, 0.184], [-0.115, 1.0, 0.115]];
  for (let i = 0; i < 2; i++) b.add(box(0.036, segLen(sp[i], sp[i + 1]) + 0.012, 0.012), U.belt, seg(sp[i], sp[i + 1]), T);
  b.add(box(0.25, 0.27, 0.1), U.belt, M(0, 1.225, -0.178), one('chest', { ao: 0.25, jitter: 0.04 }));
  b.add(box(0.255, 0.075, 0.106), shade(U.belt, 0.8), M(0, 1.33, -0.178), one('chest'));
  b.add(cyl(0.045, 0.045, 0.3, sg(8)), U.tunicDark, M(0, 1.395, -0.165, 0, 0, Math.PI / 2), one('chest', { jitter: 0.05 }));
  // collar, and the duck's chest feathers in the open neck
  b.add(cyl(0.083, 0.1, 0.05, sg(12), true), U.tunicDark, M(0, 1.43, -0.005), one('chest'));
  b.add(sph(0.062, sg(10), sg(8)), s.chest, M(0, 1.375, 0.13, 0, 0, 0, 1.1, 1.25, 0.5), one('bib'));
  // tail feathers under the jacket hem
  b.add(cone(0.075, 0.17, 6), s.tail, M(0, 0.86, -0.19, -1.15, 0, 0, 1.25, 1, 0.35), one('hips', { flat: true }));
  if (look.species === 'mallard') b.add(cyl(0.011, 0.011, 0.07, sg(4)), '#1d1d1d', M(0, 0.93, -0.25, 0.75, 0, 0), one('hips'));

  // --- neck + head
  b.add(cyl(0.066, 0.075, 0.17, sg(10)), s.head, M(0, 1.47, 0), { skin: (x, y) => [BI.neck, BI.head, smoothstep(1.47, 1.53, y)] });
  if (s.neck !== s.head) b.add(cyl(0.0765, 0.0775, 0.026, sg(10), true), s.neck, M(0, 1.47, 0), one('neck'));
  const H = one('head');
  b.add(sph(0.165, sg(16), sg(12)), s.head, M(0, 1.625, 0.015, 0, 0, 0, 0.95, 1, 1.08), one('head', { jitter: 0.04 }));
  b.add(sph(0.12, sg(12), sg(8)), s.head, M(0, 1.575, 0.065, 0, 0, 0, 1.05, 0.85, 1), H);
  if (s.patch) for (const sd of [1, -1]) b.add(sph(0.075, sg(8), sg(6)), s.patch, M(sd * 0.13, 1.645, 0.045, 0, 0, 0, 0.42, 0.62, 1.3), H);
  if (s.cap) b.add(sph(0.16, sg(12), sg(6)), s.cap, M(0, 1.66, 0, 0, 0, 0, 1, 0.65, 1.12), H);
  if (s.face) for (const sd of [1, -1]) b.add(sph(0.07, sg(8), sg(6)), s.face, M(sd * 0.08, 1.595, 0.135, 0, 0, 0, 0.75, 0.9, 0.9), one('head', { flat: true, jitter: 0.2 }));
  if (s.crest) b.add(cone(0.085, 0.24, 5), s.crest, M(0, 1.66, -0.19, -2.0, 0, 0, 0.55, 1, 1), one('head', { flat: true }));
  // bill
  b.add(sph(0.1, sg(12), sg(8)), s.bill, M(0, 1.565, 0.205, 0.08, 0, 0, 0.84, 0.3, 1.5), H);
  b.add(sph(0.085, sg(10), sg(6)), shade(s.bill, 0.8), M(0, 1.535, 0.185, 0.12, 0, 0, 0.74, 0.22, 1.38), H);
  b.add(sph(0.032, sg(8), sg(6)), '#2a2420', M(0, 1.555, 0.352, 0, 0, 0, 1, 0.45, 0.55), H);
  for (const sd of [1, -1]) b.add(sph(0.009, sg(5), sg(4)), '#2a2420', M(sd * 0.03, 1.588, 0.27), H);
  // eyes
  for (const sd of [1, -1]) {
    b.add(sph(0.031, sg(8), sg(6)), '#141414', M(sd * 0.115, 1.635, 0.125), H);
    b.add(sph(0.0095, sg(5), sg(4)), '#ffffff', M(sd * 0.127, 1.644, 0.146), H);
  }
  // --- headgear, career insignia and kit (see classes.js)
  const rank = look.rank || 1, branch = rank >= 2 ? BRANCHES[look.spec] : null, elite = rank >= 5;
  const tilt = -0.1, hc = new THREE.Vector3(0, 1.675, 0), hr = new THREE.Vector3(0.195, 0.16, 0.2145);
  const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
  const domePoint = (az, el, lift = 0.004) => new THREE.Vector3(Math.sin(az) * Math.cos(el) * (hr.x + lift), Math.sin(el) * (hr.y + lift), Math.cos(az) * Math.cos(el) * (hr.z + lift)).applyQuaternion(qTilt).add(hc);
  if (elite) {
    if (rank >= 7) {
      // Legend: officer's cap with a gold band, and a cape
      b.add(cyl(0.2, 0.172, 0.085, sg(16)), '#2a2a30', M(0, 1.795, -0.01, -0.05, 0, 0, 1, 1, 1.08), H);
      b.add(cyl(0.175, 0.175, 0.045, sg(16)), '#d9b43a', M(0, 1.742, -0.005, -0.05, 0, 0, 1, 1, 1.08), H);
      b.add(cyl(0.13, 0.13, 0.014, sg(12)), '#141414', M(0, 1.722, 0.16, 0.28, 0, 0, 1, 1, 0.62), H);
      b.add(box(0.36, 0.72, 0.025), '#7a1622', M(0, 1.04, -0.255, 0.1, 0, 0), T);
    } else {
      // Commando and War Hero: a beret with a cap badge
      const beret = rank >= 6 ? '#8a1f2c' : '#3e2228';
      b.add(sph(0.175, sg(14), sg(8)), beret, M(-0.025, 1.758, -0.01, 0, 0, 0.22, 1.12, 0.36, 1.12), one('head', { jitter: 0.05 }));
      b.add(cyl(0.162, 0.162, 0.03, sg(14), true), '#241416', M(0, 1.722, -0.01, 0, 0, 0.1, 1, 1, 1.05), H);
      b.add(box(0.035, 0.04, 0.012), U.accent, M(0.07, 1.745, 0.16, -0.3, 0.35, 0), H);
    }
    if (rank >= 6) {
      // medal on the chest
      b.add(box(0.032, 0.03, 0.006), '#b8352a', M(0.075, 1.33, 0.168, -0.15, 0, 0), one('chest'));
      b.add(cyl(0.022, 0.022, 0.008, sg(10)), '#e2c044', M(0.075, 1.295, 0.17, Math.PI / 2 - 0.15, 0, 0), one('chest'));
    }
    if (look.commander) b.add(sph(0.045, sg(8), sg(6)), '#e8c23a', M(-0.03, 1.81, -0.02), H);
  } else if (look.helmet) {
    b.add(new THREE.SphereGeometry(0.195, sg(18), sg(7), 0, Math.PI * 2, 0, Math.PI / 2), look.helmet, M(hc.x, hc.y, hc.z, tilt, 0, 0, 1, 0.82, 1.1), one('head', { ao: 0.2 }));
    b.add(cyl(0.226, 0.232, 0.022, sg(20)), look.helmet, M(0, 1.679, 0.012, tilt, 0, 0, 1, 1, 1.08), H);
    for (let i = 0; i < Math.min(rank, 4); i++) {
      const a = 0.42 + i * 0.2, p = new THREE.Vector3(0, Math.sin(a) * hr.y, Math.cos(a) * hr.z + 0.004).applyQuaternion(qTilt).add(hc);
      b.add(box(0.1, 0.018, 0.014), U.accent, M(p.x, p.y, p.z, tilt - a * 1.1, 0, 0), H);
    }
    if (look.commander) b.add(sph(0.05, sg(8), sg(6)), '#e8c23a', M(0, 1.835, -0.012), H);
    if (branch?.id === 'sharpshooter') {
      // recon: leafy netting on the helmet
      const leaves = ['#5a7a32', '#3f5a25', '#7a8a40'];
      for (let i = 0; i < 9; i++) {
        const az = i * 2.4 + 0.4, el = 0.35 + (i % 3) * 0.32, p = domePoint(az, el, -0.01), n = p.clone().sub(hc).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(UP, n);
        b.add(cone(0.04, 0.1, 4), leaves[i % 3], new THREE.Matrix4().compose(p.addScaledVector(n, 0.03), q, new THREE.Vector3(1, 1, 0.45)), one('head', { flat: true }));
      }
    }
    if (branch?.id === 'medic') {
      // medic: red cross on a white disc at the front of the helmet
      const p = domePoint(0, 0.62, 0.006), n = p.clone().sub(hc).normalize(), q = new THREE.Quaternion().setFromUnitVectors(UP, n);
      const id = new THREE.Vector3(1, 1, 1);
      b.add(cyl(0.05, 0.05, 0.008, sg(12)), '#f4f2ea', new THREE.Matrix4().compose(p, q, id), H);
      const pc = p.clone().addScaledVector(n, 0.005);
      b.add(box(0.064, 0.008, 0.018), '#c8302a', new THREE.Matrix4().compose(pc, q, id), H);
      b.add(box(0.018, 0.008, 0.064), '#c8302a', new THREE.Matrix4().compose(pc, q, id), H);
    }
  }
  if (branch || elite) {
    // armband on the left sleeve in the career colour (gold for the elite ranks)
    const band = elite ? '#d9b43a' : branch.color;
    b.add(cyl(0.066, 0.064, 0.065, sg(12), true), band, M(0.198, 1.235, -0.008, 0, 0, 0.053), one('uarmL'));
    if (branch?.id === 'medic' && !elite) {
      b.add(box(0.008, 0.03, 0.01), '#c8302a', M(0.264, 1.235, -0.008, 0, 0, 0.053), one('uarmL'));
      b.add(box(0.008, 0.01, 0.03), '#c8302a', M(0.264, 1.235, -0.008, 0, 0, 0.053), one('uarmL'));
    }
  }
  if (branch?.id === 'grenadier') {
    // heavy weapons: a bandolier of shells along the strap and a spare shell on the pack
    for (let i = 0; i < 5; i++) { const t = 0.18 + i * 0.16, a = sp[0], c = sp[1]; b.add(cyl(0.012, 0.012, 0.05, 6), '#c9a43a', M(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t + 0.012, 0, 0, 0.55), T); }
    b.add(sph(0.05, 8, 6), '#3d4a2a', M(0.15, 1.2, -0.2, 0, 0, 0, 1, 1.9, 1), one('chest'));
    b.add(cone(0.04, 0.05, 8), '#b8352a', M(0.15, 1.31, -0.2), one('chest'));
  } else if (branch?.id === 'sapper') {
    // engineers: entrenching shovel strapped to the pack
    b.add(cyl(0.011, 0.011, 0.36, 6), '#7a5232', M(-0.08, 1.25, -0.236), one('chest'));
    b.add(box(0.09, 0.12, 0.012), '#5d6066', M(-0.08, 1.04, -0.236), one('chest'));
  } else if (branch?.id === 'sharpshooter') {
    // recon: binoculars on the chest
    for (const x of [-0.026, 0.026]) b.add(cyl(0.021, 0.024, 0.07, sg(8)), '#1d1f22', M(x, 1.215, 0.19, Math.PI / 2, 0, 0), one('chest'));
  } else if (branch?.id === 'medic') {
    // medics: satchel with a red cross on the left hip
    b.add(box(0.11, 0.1, 0.05), '#ecebe2', M(0.17, 0.915, 0.06, 0, -0.45, 0), one('hips'));
    b.add(box(0.012, 0.05, 0.016), '#c8302a', M(0.188, 0.918, 0.088, 0, -0.45, 0), one('hips'));
    b.add(box(0.05, 0.012, 0.016), '#c8302a', M(0.188, 0.918, 0.088, 0, -0.45, 0), one('hips'));
  }

  // --- arms
  for (const [S, sd] of [['L', 1], ['R', -1]]) {
    const P = (k) => PIV[k + S], X = (x) => sd * x;
    const sh = P('uarm'), el = P('farm'), wr = P('hand');
    b.add(sph(0.07, sg(10), sg(8)), U.tunic, M(sh[0], sh[1], sh[2]), one('uarm' + S, { jitter: 0.03 }));
    b.add(box(0.075, 0.014, 0.12), U.tunicDark, M(X(0.165), 1.428, -0.005, 0, 0, -sd * 0.2), one('clav' + S));
    for (let i = 0; i < Math.min(4, look.rank || 1); i++) b.add(box(0.02, 0.012, 0.02), U.accent, M(X(0.165), 1.436, 0.035 - i * 0.027, 0, 0, -sd * 0.2), one('clav' + S));
    b.add(cyl(0.06, 0.054, segLen(sh, el) + 0.02, sg(10)), U.tunic, seg([sh[0], sh[1] + 0.01, sh[2]], [el[0], el[1] - 0.01, el[2]]), one('uarm' + S, { jitter: 0.03 }));
    b.add(sph(0.056, sg(8), sg(6)), U.tunic, M(el[0], el[1], el[2]), one('farm' + S));
    const cuff = [wr[0] - X(0.002), wr[1] + 0.045, wr[2] - 0.003];
    const fs = (k) => ({ skin: (x, y) => [BI['farm' + S], BI['hand' + S], k(y)] });
    b.add(cyl(0.054, 0.048, segLen(el, cuff), sg(10)), U.tunic, seg(el, cuff), { ...fs((y) => smoothstep(1.0, 0.885, y) * 0.55), jitter: 0.03 });
    b.add(cyl(0.053, 0.053, 0.032, sg(10)), U.tunicDark, M(cuff[0], cuff[1], cuff[2]), fs(() => 0.55));
    // wing feathers poking out of the sleeve
    for (let i = 0; i < 3; i++) {
      const base = [X(0.235), 0.885, -0.03 + i * 0.016], tip = [base[0] + X(0.03), base[1] - 0.068, base[2] - 0.03];
      b.add(cone(0.017, segLen(tip, base), 4), i === 1 ? s.speculum : s.wing, seg(tip, base), one('hand' + S, { flat: true }));
    }
    // gloved hand: palm, three-finger mitten, index finger, thumb
    const G = U.glove, hb = one('hand' + S);
    b.add(cyl(0.047, 0.043, 0.042, sg(10)), shade(G, 0.82), M(wr[0], wr[1] + 0.008, wr[2]), hb);
    b.add(box(0.034, 0.094, 0.082), G, M(X(0.2135), 0.789, 0.01), one('hand' + S, { jitter: 0.04 }));
    b.add(cyl(0.02, 0.02, 0.08, sg(8)), G, M(X(0.2145), 0.745, 0.01, Math.PI / 2, 0, 0), hb);
    const fb = one('fing' + S), ib = one('index' + S), tb = one('thumb' + S);
    b.add(box(0.031, 0.066, 0.058), G, M(X(0.2155), 0.71, -0.002), fb);
    b.add(sph(0.03, sg(8), sg(6)), G, M(X(0.2155), 0.677, -0.002, 0, 0, 0, 0.52, 0.5, 0.97), fb);
    b.add(box(0.028, 0.07, 0.021), G, M(X(0.2155), 0.708, 0.04), ib);
    b.add(sph(0.0145, sg(6), sg(5)), G, M(X(0.2155), 0.673, 0.04), ib);
    b.add(box(0.026, 0.062, 0.024), G, M(X(0.203), 0.779, 0.056, -0.55, 0, 0), tb);
    b.add(sph(0.0135, sg(6), sg(5)), G, M(X(0.203), 0.752, 0.072), tb);
  }

  // --- legs: trousers, puttees, and big webbed duck feet
  for (const [S, sd] of [['L', 1], ['R', -1]]) {
    const hp = PIV['thigh' + S], kn = PIV['shin' + S], an = PIV['foot' + S];
    b.add(cyl(0.09, 0.07, segLen(hp, kn) + 0.03, sg(10)), U.trousers, seg([hp[0], hp[1] + 0.02, hp[2]], [kn[0], kn[1] - 0.01, kn[2]]),
      { skin: (x, y) => [BI['thigh' + S], BI.hips, smoothstep(0.83, 0.9, y) * 0.5], jitter: 0.03 });
    b.add(sph(0.07, sg(10), sg(8)), U.trousers, M(kn[0], kn[1], kn[2]), one('shin' + S));
    const pt = [kn[0], 0.285, 0.004];
    b.add(cyl(0.068, 0.06, segLen(kn, pt), sg(10)), U.trousers, seg(kn, pt), one('shin' + S));
    b.add(cyl(0.061, 0.052, 0.2, sg(10)), U.puttee, M(an[0], 0.2, -0.003), one('shin' + S, { jitter: 0.05 }));
    for (const y of [0.24, 0.17]) { const r = 0.052 + 0.009 * (y - 0.1) / 0.2 + 0.0015; b.add(cyl(r, r, 0.01, sg(10), true), shade(U.puttee, 0.72), M(an[0], y, -0.003), one('shin' + S)); }
    const fb = one('foot' + S);
    b.add(cyl(0.028, 0.034, 0.07, sg(6)), s.feet, M(an[0], 0.065, an[2]), fb);
    b.add(cone(0.115, 0.27, 3), s.feet, M(an[0], 0.022, 0.08, -Math.PI / 2, 0, 0, 1, 1, 0.2), one('foot' + S, { flat: true, jitter: 0.06 }));
    for (const a of [-0.42, 0, 0.42]) b.add(cyl(0.011, 0.015, 0.15, sg(5)), shade(s.feet, 0.84), M(an[0] + Math.sin(a) * 0.075, 0.03, 0.04 + Math.cos(a) * 0.075, Math.PI / 2, a, 0), fb);
  }
  return b.build({ skin: true });
}

function makeSkeleton() {
  const map = {}, list = [];
  for (const name of BONES) {
    const bn = new THREE.Bone(); bn.name = name;
    const p = PIV[name], par = PARENT[name];
    if (par) { const q = PIV[par]; bn.position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]); map[par].add(bn); }
    bn.userData.rest = bn.position.clone();
    map[name] = bn; list.push(bn);
  }
  map.list = list;
  return map;
}
function resetPose(B) {
  for (const bn of B.list) { bn.quaternion.identity(); bn.scale.set(1, 1, 1); bn.position.copy(bn.userData.rest); }
}

let sharedDuckMaterial = null;
export function duckMaterial(quality) {
  if (!sharedDuckMaterial) {
    sharedDuckMaterial = quality.duckMat === 'standard'
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0 })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
  }
  return sharedDuckMaterial;
}
export function resetDuckMaterial() {
  sharedDuckMaterial?.dispose(); sharedDuckMaterial = null;
  if (camoMats) { camoMats.ally.dispose(); camoMats.foe.dispose(); camoMats = null; }
}
let camoMats = null;
function camoMaterial(foe) {
  if (!sharedDuckMaterial) return null;
  if (!camoMats) {
    const mk = (op) => { const m = sharedDuckMaterial.clone(); m.transparent = true; m.opacity = op; m.depthWrite = false; return m; };
    camoMats = { ally: mk(0.42), foe: mk(0.13) };
  }
  return foe ? camoMats.foe : camoMats.ally;
}

export function buildDuckMesh(look, quality, seed) {
  const geo = buildDuckGeometry(look, seed, quality.duckDetail ?? (quality.id === 'low' ? 0.65 : 1));
  const mesh = new THREE.SkinnedMesh(geo, duckMaterial(quality));
  const sk = makeSkeleton();
  mesh.add(sk.root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(sk.list));
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.9);
  mesh.castShadow = !!quality.shadows;
  mesh.userData.bones = sk;
  return mesh;
}

// ---------------------------------------------------------------- weapon holds
// Two-handed weapons hang off the spine with their pivot at the right shoulder (MUZZLE), so the chest can
// turn into a bladed stance without spoiling the aim. z: grip distance along the aim, axis: barrel height
// above the grip, rest: pitch while not aiming, twist: chest turn, sup: left wrist under the barrel
// (weapon-model space, -Z is forward). 'hand' items sit in the right fist instead.
const HOLD = {
  bazooka: { type: 'shoulder', z: 0.27, axis: 0.1, tip: 0.95, rest: 0.22, twist: -0.35, sup: [-0.04, -0.005, -0.25] },
  cluster: { type: 'shoulder', z: 0.3, axis: 0.1, tip: 0.9, rest: 0.22, twist: -0.35, sup: [-0.04, -0.015, -0.25] },
  homing: { type: 'shoulder', z: 0.38, axis: 0.1, tip: 0.8, rest: 0.22, twist: -0.35, sup: [-0.04, -0.02, -0.22] },
  mortar: { type: 'shoulder', z: 0.4, axis: 0.12, tip: 0.62, rest: 0.5, twist: -0.35, sup: [-0.045, -0.01, -0.22] },
  rifle: { type: 'rifle', z: 0.33, axis: 0.04, tip: 0.8, rest: -0.38, twist: -0.45, sup: [-0.04, -0.055, -0.18] },
  sniper: { type: 'rifle', z: 0.3, axis: 0.04, tip: 1.05, rest: -0.38, twist: -0.45, sup: [-0.04, -0.055, -0.2] },
  // fp: where the item is held while aiming in first person, so you can see it
  grenade: { type: 'hand', rest: [-0.21, 1.0, 0.2], aim: [-0.3, 1.6, -0.12], fp: [-0.24, 1.42, 0.47] },
  mine: { type: 'hand', rest: [-0.21, 1.0, 0.2], aim: [-0.17, 0.98, 0.36], fp: [-0.2, 1.36, 0.47] },
  airstrike: { type: 'hand', rest: [-0.21, 1.0, 0.2], aim: [-0.13, 1.47, 0.16], fp: [-0.24, 1.42, 0.46] },
  medkit: { type: 'hand', rest: [-0.16, 1.06, 0.25], aim: [-0.12, 1.18, 0.3], fp: [-0.14, 1.38, 0.45], both: true },
  airburst: { type: 'shoulder', z: 0.4, axis: 0.12, tip: 0.62, rest: 0.5, twist: -0.35, sup: [-0.045, -0.01, -0.22] },
  shotgun: { type: 'rifle', z: 0.3, axis: 0.045, tip: 0.75, rest: -0.38, twist: -0.45, sup: [-0.04, -0.035, -0.2] },
  tnt: { type: 'hand', rest: [-0.21, 1.0, 0.2], aim: [-0.3, 1.6, -0.12], fp: [-0.24, 1.42, 0.47] },
  camo: { type: 'hand', rest: [-0.21, 1.0, 0.2], aim: [-0.15, 1.25, 0.34], fp: [-0.22, 1.38, 0.46] },
  sandbags: { type: 'hand', rest: [-0.21, 1.0, 0.2], aim: [-0.16, 1.05, 0.36], fp: [-0.22, 1.32, 0.46], both: true },
  medidart: { type: 'hand', pistol: true, rest: [-0.21, 1.0, 0.22], aim: [-0.16, 1.43, 0.45], fp: [-0.24, 1.38, 0.48] },
  jetpack: { type: 'hand', pistol: true, rest: [-0.21, 1.0, 0.22], aim: [-0.16, 1.2, 0.36], fp: [-0.24, 1.36, 0.46] },
  paradrop: { type: 'hand', pistol: true, rest: [-0.21, 1.0, 0.22], aim: [-0.16, 1.55, 0.4], fp: [-0.24, 1.38, 0.48] },
};
const PIVOT_S = new THREE.Vector3(-MUZZLE.right, MUZZLE.up - PIV.spine[1], 0); // pivot in spine-bone space
// Your own duck on a flat screen carries its weapon a little lower and wider, so it frames the view
// like a first-person shooter instead of filling it.
const FP = { right: 0.255, up: 1.41 };
const PIVOT_FP = new THREE.Vector3(-FP.right, FP.up - PIV.spine[1], 0.02);
const _md = new THREE.Vector3();
// Where a shot leaves a duck's held weapon for a given aim (exact for your own duck on screen).
export function heldMuzzle(duck, yaw, pitch, out) {
  const h = duck.weaponMesh ? duck.hold : null;
  const cp = Math.cos(pitch), dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
  if (h && h.type === 'hand') { duck.bones.handR.getWorldPosition(out); return out.addScaledVector(_md.set(dx, dy, dz), 0.14); }
  const fp = duck.screenBody, r = fp ? FP.right : MUZZLE.right, u = fp ? FP.up : MUZZLE.up;
  const f = h ? h.z + (h.tip || 0.8) : MUZZLE.fwd;
  const rx = -Math.cos(yaw), rz = Math.sin(yaw);
  return out.set(duck.pos.x + rx * r + dx * f, duck.pos.y + u + dy * f, duck.pos.z + rz * r + dz * f);
}
const GRIP = new THREE.Vector3(0.025, 0.01, 0.06);   // right wrist on a pistol grip (weapon space)
const GRIP_F = new THREE.Vector3(0, -0.45, -0.89).normalize(), GRIP_K = new THREE.Vector3(1, 0, 0);
const SUP_F = new THREE.Vector3(0.8, 0, -0.6).normalize(), SUP_K = new THREE.Vector3(0, -1, 0);
const SALUTE = { wrist: [-0.226, 1.574, 0.116], F: new THREE.Vector3(0.6, 0.66, 0.46), K: new THREE.Vector3(-0.513, 0.731, -0.394) };

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3(), _u = new THREE.Vector3(), _rt = new THREE.Vector3();
const _pole = new THREE.Vector3(), _sh = new THREE.Vector3(), _F = new THREE.Vector3(), _K = new THREE.Vector3(), _e = new THREE.Vector3();
const _fw = new THREE.Vector3(), _lf = new THREE.Vector3(), _dir = new THREE.Vector3(), _N = new THREE.Vector3(), _Hp = new THREE.Vector3(), _c = new THREE.Vector3();
const _headC = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _hq = new THREE.Quaternion(), _mq = new THREE.Quaternion(), _mqi = new THREE.Quaternion(), _wq = new THREE.Quaternion();

// ---------------------------------------------------------------- Duck
let duckSerial = 1;
export class Duck {
  constructor({ info, team, look, quality }) {
    this.id = duckSerial++;
    this.info = info;            // persistent roster entry {name, rank, spec, xp,...}
    this.team = team;
    this.name = info.name;
    this.maxHp = info.maxHp;
    this.hp = info.hp ?? info.maxHp;
    this.alive = true;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.state = 'idle';         // idle | walk | air | swim | dead
    this.ammo = {};
    this.weapon = 'bazooka';
    this.look = look;
    this.mesh = buildDuckMesh(look, quality, this.id * 17);
    this.mesh.userData.duck = this;
    this.bones = this.mesh.userData.bones;
    this.weaponMesh = null; this.hold = null;
    this.firstPerson = false;    // the player is looking out through this duck's eyes
    this.vrDriven = false;       // ...and in VR, its body follows the player's head and hands
    this.screenBody = false;     // ...or on a screen, its body stays visible below the camera
    this.headHidden = false;
    this.vrs = null;             // VR body state (yaw, planted feet)
    this.anim = {
      t: Math.random() * 10, walk: 0, step: 0, speed: 0, px: 0, pz: 0, spin: 0,
      headYaw: 0, headTarget: 0, headTimer: 1, aimPitch: 0, aiming: 0,
      cheer: 0, flinch: 0, salute: 0, salW: 0, throwT: 0, slapT: 0, recoil: 0, holdW: 0,
    };
    this.stats = { damage: 0, kills: 0, shots: 0 };
    this.lastHitBy = null;
  }

  get bodyCenter() { return _c.set(this.pos.x, this.pos.y + 1.0, this.pos.z); }
  get hidden() { return !this.mesh.visible; }
  setHidden(h) { this.setFirstPerson(h, false); }
  // on: the player looks out through this duck's eyes. body: 'vr' (posed from the headset and controllers),
  // 'screen' (animated as usual, holding its own weapon) or false (body hidden). The head is hidden either way.
  setFirstPerson(on, body = false) {
    if (body === true) body = 'vr';
    this.firstPerson = !!on;
    this.vrDriven = !!(on && body === 'vr');
    this.screenBody = !!(on && body === 'screen');
    this.headHidden = this.vrDriven || this.screenBody;
    this.mesh.visible = this.alive && (!on || !!body);
    if (this.weaponMesh) this.weaponMesh.visible = !on || this.screenBody;
    if (!this.vrDriven) this.vrs = null;
    if (this.shadowHead) this.shadowHead.visible = false;
  }
  salute(sec = 2.2) { this.anim.salute = Math.max(this.anim.salute, sec); }
  // Camouflaged ducks fade into the scenery: faintly visible to their own side, barely to the enemy.
  setCamo(on) {
    this.camo = !!on;
    const foe = this.team?.control === 'ai';
    const m = (on && camoMaterial(foe)) || sharedDuckMaterial || this.mesh.material;
    this.mesh.material = m;
    if (this.weaponMesh) this.weaponMesh.material = m;
  }
  // Your own head (and the feathers in your collar) would fill the view, so first person collapses them.
  // With shadows on, an invisible stand-in still casts the head's shadow.
  hideHead(headCenter = null) {
    this.bones.neck.scale.setScalar(0.001); this.bones.bib.scale.setScalar(0.001);
    if (!this.mesh.castShadow) return;
    if (!this.shadowHead) {
      this.shadowHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
      this.shadowHead.castShadow = true; this.shadowHead.frustumCulled = false;
      this.mesh.add(this.shadowHead);
    }
    this.shadowHead.visible = !!headCenter;
    if (headCenter) this.shadowHead.position.copy(this.mesh.worldToLocal(_c.copy(headCenter)));
  }

  // The camp mirror needs to see your head for the moment it renders its reflection.
  mirrorHead(show) {
    if (!this.headHidden) return;
    const s = show ? 1 : 0.001, B = this.bones;
    B.neck.scale.setScalar(s); B.bib.scale.setScalar(s);
    B.neck.updateMatrixWorld(true); B.bib.updateMatrixWorld(true);
    if (!show) this.mesh.skeleton.update();
  }

  showWeapon(model, id = this.weapon) {
    if (this.weaponMesh) { this.weaponMesh.parent?.remove(this.weaponMesh); this.weaponMesh = null; }
    this.hold = null;
    if (!model) return;
    const h = HOLD[id] || HOLD.bazooka;
    const m = new THREE.Mesh(model, this.mesh.material);
    m.castShadow = this.mesh.castShadow;
    // hand-held items (grenade, radio, medkit, mine) are modelled big for the old view-model; scale them to fit a fist
    if (h.type === 'hand' && h.pistol) { this.bones.handR.add(m); m.position.set(0.022, -0.06, 0.004); m.rotation.set(0, Math.PI, 0); m.scale.setScalar(0.9); }
    else if (h.type === 'hand') { this.bones.handR.add(m); m.position.set(0.02, -0.089, -0.024); m.rotation.set(Math.PI / 2, 0, 0); m.scale.setScalar(0.6); }
    else this.bones.spine.add(m);
    m.visible = !this.firstPerson || this.screenBody;
    this.weaponMesh = m; this.hold = h;
  }

  setFingers(S, curl, index, thumb) {
    const B = this.bones, sd = S === 'L' ? 1 : -1;
    B['fing' + S].rotation.set(0, 0, -sd * curl * 1.5);
    B['index' + S].rotation.set(0, 0, -sd * index * 1.45);
    B['thumb' + S].rotation.set(thumb * 0.2, -sd * thumb * 0.8, 0);
  }
  // elbow hint: shoulder + an offset in the body's frame
  poleAt(S, x, y, z) {
    this.bones['uarm' + S].getWorldPosition(_pole);
    return _pole.add(_e.set(x, y, z).applyQuaternion(_mq));
  }
  // Bring arm S's wrist to a world point (blended with the current pose by w), optionally turning the hand.
  reach(S, target, pole, w = 1, q = null) {
    const B = this.bones, L = LIMB['arm' + S], hand = B['hand' + S];
    if (w < 0.999) { hand.getWorldPosition(_rt); _rt.lerp(target, w); } else _rt.copy(target);
    const short = solveTwoBone(B['uarm' + S], B['farm' + S], L.lenA, L.lenB, _rt, pole, _mq, L.restA, L.restB);
    if (q) {
      if (w < 0.999) { hand.getWorldQuaternion(_q2); _q2.slerp(q, w); setBoneWorldQuat(hand, _q2); }
      else setBoneWorldQuat(hand, q);
    }
    return short;
  }
  meshPoint(x, y, z, out) { return out.set(x, y, z).applyMatrix4(this.mesh.matrixWorld); }

  // ------------------------------------------------------------ third-person animation (physics is in battle.js)
  animate(dt) {
    const A = this.anim, B = this.bones, st = this.state, m = this.mesh;
    A.t += dt;
    const mv = Math.hypot(this.pos.x - A.px, this.pos.z - A.pz);
    A.px = this.pos.x; A.pz = this.pos.z;
    A.speed = damp(A.speed, st === 'walk' && dt > 0 ? Math.min(6, mv / dt) : 0, 6, dt);
    m.position.copy(this.pos);
    if (st === 'swim') m.position.y += Math.sin(A.t * 2.1) * 0.035;
    m.rotation.set(0, this.yaw, 0);
    resetPose(B);
    A.walk = damp(A.walk, st === 'walk' ? 1 : 0, 9, dt);
    if (st === 'walk') A.step += dt * (5.5 + A.speed * 1.1);
    A.flinch = Math.max(0, A.flinch - dt * 3);
    A.cheer = Math.max(0, A.cheer - dt);
    A.salute = Math.max(0, A.salute - dt);
    A.salW = damp(A.salW, A.salute > 0.2 ? 1 : 0, 9, dt);
    A.throwT = Math.max(0, A.throwT - dt);
    A.slapT = Math.max(0, A.slapT - dt);
    A.recoil = Math.max(0, A.recoil - dt * 4);
    const hold = this.weaponMesh ? this.hold : null;
    A.holdW = damp(A.holdW, hold ? 1 : 0, 10, dt);
    const w = A.walk, ph = A.step, aim = A.aiming, steady = this.screenBody ? 0 : 1, br = Math.sin(A.t * 1.7) * steady;
    const air = st === 'air', jump = air && this.jumping, tumble = air && !this.jumping;
    const cheer = A.cheer > 0 ? Math.min(1, A.cheer * 2) : 0;
    const twist = hold && hold.twist ? hold.twist * A.holdW : 0;

    // --- hips and spine
    B.hips.position.y += -0.025 * w + Math.abs(Math.sin(ph)) * 0.04 * w + Math.abs(Math.sin(A.t * 6)) * 0.12 * cheer;
    let hx = 0, hy = Math.sin(ph) * 0.1 * w * steady, hz = Math.sin(ph) * 0.04 * w * steady;
    if (tumble) { A.spin += dt * 8; hx = Math.sin(A.spin) * 1.1; hz = Math.cos(A.spin * 0.7) * 0.8; } else A.spin = 0;
    if (st === 'swim') hx = 0.12;
    B.hips.rotation.set(hx, hy, hz);
    B.spine.rotation.set((0.08 * w - A.flinch * 0.28) * steady + br * 0.01 - A.recoil * 0.05, -hy * 0.5, 0);
    B.chest.rotation.set((0.03 * w - A.flinch * 0.2) * steady + br * 0.015, -hy * 0.6 * (1 - A.holdW * 0.7) + twist, 0);
    if (twist) B.clavL.rotation.y = -0.35 * A.holdW;

    // --- legs
    for (let i = 0; i < 2; i++) {
      const S = i ? 'R' : 'L', sd = i ? -1 : 1, p = ph + i * Math.PI;
      let th = -Math.sin(p) * 0.55 * w, kn = (0.1 + 0.9 * Math.max(0, Math.cos(p))) * w, ab = 0;
      if (st === 'swim') { th = -0.35 + Math.sin(A.t * 3.2 + sd) * 0.35; kn = 0.55 + Math.cos(A.t * 3.2 + sd) * 0.3; }
      else if (jump) { th = -0.75; kn = 1.3; }
      else if (tumble) { th = Math.sin(A.t * 14 + sd * 1.5) * 0.9; kn = 0.8 + Math.cos(A.t * 14 + sd) * 0.5; ab = 0.25; }
      else if (w < 0.05) { kn += 0.03; ab = 0.04; }
      B['thigh' + S].rotation.set(th, 0, sd * ab);
      B['shin' + S].rotation.set(kn, 0, 0);
      B['foot' + S].rotation.set(-(th + kn) * 0.85, 0, -sd * ab);
    }
    // --- arms (forward kinematics; IK below overrides them for holds and gestures)
    for (let i = 0; i < 2; i++) {
      const S = i ? 'R' : 'L', sd = i ? -1 : 1, p = ph + i * Math.PI;
      let ux = Math.sin(p) * 0.5 * w, uz = sd * (0.07 + br * 0.008), fx = -(0.15 + 0.6 * w), curl = 0.35;
      if (st === 'swim') { const k = Math.sin(A.t * 3); ux = -1.0 + k * 0.35; uz = sd * (0.55 + k * 0.4); fx = -0.7 - k * 0.2; curl = 0.1; }
      else if (jump) { ux = -0.6; uz = sd * 0.55; fx = -0.5; }
      else if (tumble) { ux = Math.sin(A.t * 11 + sd) * 0.7; uz = sd * (1.6 + Math.sin(A.t * 16 + sd) * 0.6); fx = -0.6 + Math.sin(A.t * 13) * 0.5; curl = 0; }
      uz += sd * A.flinch * 0.6; ux -= A.flinch * 0.4;
      B['uarm' + S].rotation.set(ux, 0, uz);
      B['farm' + S].rotation.set(fx, 0, 0);
      this.setFingers(S, curl, curl, curl);
    }
    // --- head: glance around, follow the aim
    A.headTimer -= dt;
    if (A.headTimer <= 0) { A.headTimer = 1.5 + Math.random() * 3; A.headTarget = (Math.random() - 0.5) * 1.1; }
    A.headYaw = dampAngle(A.headYaw, aim > 0.5 || cheer || A.salW > 0.1 ? 0 : A.headTarget, 4, dt);
    B.neck.rotation.set(0.05 - cheer * 0.15, A.headYaw * 0.35 - twist, 0);
    B.head.rotation.set(-A.aimPitch * 0.5 * aim + Math.sin(A.t * 1.7) * 0.025 - A.flinch * 0.3 - cheer * 0.25 - A.salW * 0.08, A.headYaw * 0.65, 0);
    // --- the weapon rides on the right shoulder and pitches with the aim
    const wm = this.weaponMesh;
    if (wm && hold && hold.type !== 'hand') {
      const p = lerp(hold.rest, A.aimPitch, aim) + A.recoil * 0.12, cp = Math.cos(p), sp = Math.sin(p), z = hold.z - A.recoil * 0.06;
      const P = this.screenBody ? PIVOT_FP : PIVOT_S;
      wm.position.set(P.x, P.y + sp * z - cp * hold.axis, P.z + cp * z + sp * hold.axis);
      wm.rotation.set(-p, Math.PI, 0);
    }
    m.updateMatrixWorld(true);
    m.getWorldQuaternion(_mq);

    // --- IK: right arm
    const throwing = A.throwT > 0 && hold && hold.type === 'hand';
    const tu = throwing ? 1 - A.throwT / 0.45 : 0;
    if (wm) wm.visible = (!this.firstPerson || this.screenBody) && !(throwing && tu > 0.45);
    if (A.slapT > 0) {
      const u = 1 - A.slapT / 0.4, e = 1 - (1 - u) * (1 - u);
      this.meshPoint(lerp(-0.48, 0.14, e), lerp(1.44, 1.36, e), lerp(0.04, 0.5, e), _t);
      handQuat('R', _F.set(0.55, 0.15, 0.82).applyQuaternion(_mq), _K.set(-0.85, 0.1, 0.5).applyQuaternion(_mq), _hq);
      this.reach('R', _t, this.poleAt('R', -0.35, -0.3, -0.1), 1, _hq);
      this.setFingers('R', 0, 0, 0.1);
    } else if (throwing) {
      if (tu < 0.45) { const e = tu / 0.45; this.meshPoint(lerp(-0.3, -0.12, e), lerp(1.62, 1.55, e), lerp(-0.15, 0.45, e), _t); }
      else { const e = (tu - 0.45) / 0.55; this.meshPoint(lerp(-0.12, 0.05, e), lerp(1.55, 1.1, e), lerp(0.45, 0.35, e), _t); }
      this.reach('R', _t, this.poleAt('R', -0.35, -0.3, -0.2));
      this.setFingers('R', tu < 0.45 ? 1 : 0.2, tu < 0.45 ? 1 : 0.2, 0.5);
    } else if (A.salW > 0.02) {
      this.meshPoint(SALUTE.wrist[0], SALUTE.wrist[1], SALUTE.wrist[2], _t);
      handQuat('R', _F.copy(SALUTE.F).applyQuaternion(_mq), _K.copy(SALUTE.K).applyQuaternion(_mq), _hq);
      this.reach('R', _t, this.poleAt('R', -0.45, 0.05, 0.1), A.salW, _hq);
      this.setFingers('R', 0.05 * (1 - A.salW), 0, 0.25);
    } else if (cheer) {
      this.meshPoint(-0.24, 1.98 + Math.sin(A.t * 9 + Math.PI) * 0.06, 0.06, _t);
      this.reach('R', _t, this.poleAt('R', -0.4, -0.1, -0.15), cheer);
      this.setFingers('R', 1, 1, 0.9);
    } else if (hold && A.holdW > 0.01 && hold.type !== 'hand') {
      wm.getWorldQuaternion(_wq);
      wm.localToWorld(_t.copy(GRIP));
      handQuat('R', _F.copy(GRIP_F).applyQuaternion(_wq), _K.copy(GRIP_K).applyQuaternion(_wq), _hq);
      this.reach('R', _t, this.poleAt('R', -0.3, -0.45, -0.15), A.holdW, _hq);
      this.setFingers('R', 1, 0.7, 0.8);
    } else if (hold && A.holdW > 0.01) {
      const a = hold.rest, b2 = this.screenBody && hold.fp ? hold.fp : hold.aim;
      this.meshPoint(lerp(a[0], b2[0], aim), lerp(a[1], b2[1], aim), lerp(a[2], b2[2], aim), _t);
      this.reach('R', _t, this.poleAt('R', -0.25, -0.4, -0.2), A.holdW);
      this.setFingers('R', 1, 1, 0.8);
    } else if (this.weapon === 'slap' && aim > 0.02) {
      if (this.screenBody) this.meshPoint(-0.17, 1.3, 0.42, _t); else this.meshPoint(-0.13, 1.42, 0.3, _t);
      this.reach('R', _t, this.poleAt('R', -0.25, -0.4, 0), aim);
      this.setFingers('R', 1, 1, 1);
    }
    // --- IK: left arm
    if (cheer) {
      this.meshPoint(0.24, 1.98 + Math.sin(A.t * 9) * 0.06, 0.06, _t);
      this.reach('L', _t, this.poleAt('L', 0.4, -0.1, -0.15), cheer);
      this.setFingers('L', 1, 1, 0.9);
    } else if (hold && A.holdW > 0.01 && hold.type !== 'hand' && !(A.slapT > 0)) {
      // under the barrel, as far forward as the arm will reach
      const L = LIMB.armL, reachMax = (L.lenA + L.lenB) * 0.98;
      B.uarmL.getWorldPosition(_sh);
      for (const k of [1, 0.8, 0.6, 0.45]) { wm.localToWorld(_u.set(hold.sup[0], hold.sup[1], hold.sup[2] * k)); if (_u.distanceTo(_sh) < reachMax) break; }
      wm.getWorldQuaternion(_wq);
      handQuat('L', _F.copy(SUP_F).applyQuaternion(_wq), _K.copy(SUP_K).applyQuaternion(_wq), _hq);
      this.reach('L', _u, this.poleAt('L', 0.25, -0.45, 0), A.holdW, _hq);
      this.setFingers('L', 0.85, 0.85, 0.6);
    } else if (hold && hold.both && A.holdW > 0.01) {
      const a = hold.rest, b2 = this.screenBody && hold.fp ? hold.fp : hold.aim;
      this.meshPoint(-lerp(a[0], b2[0], aim), lerp(a[1], b2[1], aim), lerp(a[2], b2[2], aim), _t);
      this.reach('L', _t, this.poleAt('L', 0.25, -0.4, -0.2), A.holdW);
      this.setFingers('L', 0.7, 0.7, 0.6);
    } else if (this.weapon === 'slap' && aim > 0.02) {
      if (this.screenBody) this.meshPoint(0.17, 1.28, 0.44, _t); else this.meshPoint(0.13, 1.4, 0.32, _t);
      this.reach('L', _t, this.poleAt('L', 0.25, -0.4, 0), aim);
      this.setFingers('L', 1, 1, 1);
    }
    if (this.headHidden) this.hideHead(this.screenBody && m.castShadow ? B.head.localToWorld(_headC.set(0, 0.125, 0.01)) : null);
  }

  // ------------------------------------------------------------ VR full body
  // vr: { eye, headQ, hands: { L, R: { ok, wrist, quat, curl, index, thumb } }, groundAt(x, z, y) }
  driveVR(dt, vr) {
    const A = this.anim, B = this.bones, m = this.mesh, st = this.state;
    A.t += dt;
    _fw.set(0, 0, -1).applyQuaternion(vr.headQ);
    const headYaw = Math.atan2(_fw.x, _fw.z);
    let S = this.vrs;
    if (!S) S = this.vrs = { yaw: headYaw, vx: 0, vz: 0, speed: 0, px: this.pos.x, pz: this.pos.z, py: this.pos.y, feet: null, wasAir: false };
    const idt = 1 / Math.max(dt, 1e-3);
    const jumped = Math.hypot(this.pos.x - S.px, this.pos.z - S.pz) > 0.75 || Math.abs(this.pos.y - S.py) > 0.8;
    S.vx = damp(S.vx, jumped ? 0 : (this.pos.x - S.px) * idt, 10, dt);
    S.vz = damp(S.vz, jumped ? 0 : (this.pos.z - S.pz) * idt, 10, dt);
    S.px = this.pos.x; S.pz = this.pos.z; S.py = this.pos.y;
    S.speed = Math.hypot(S.vx, S.vz);
    // the body lags behind the head's turn, catching up faster while moving
    if (jumped) S.yaw = headYaw;
    else {
      S.yaw = dampAngle(S.yaw, headYaw, S.speed > 0.5 ? 6 : 0.8, dt);
      const d = wrapAngle(headYaw - S.yaw), lim = 0.7;
      if (d > lim) S.yaw += d - lim; else if (d < -lim) S.yaw += d + lim;
    }
    const yaw = S.yaw, turn = wrapAngle(headYaw - yaw);
    _fw.set(Math.sin(yaw), 0, Math.cos(yaw)); _lf.set(Math.cos(yaw), 0, -Math.sin(yaw));
    resetPose(B);
    m.position.copy(this.pos);
    m.rotation.set(0, yaw, 0);
    m.updateMatrixWorld(true);
    m.getWorldQuaternion(_mq); _mqi.copy(_mq).invert();

    // --- torso hangs from the neck, which sits under the head; crouching drops the hips and bends the knees
    _Hp.set(0, -0.135, 0.095).applyQuaternion(vr.headQ).add(vr.eye);
    _N.copy(_Hp); _N.y -= 0.09;
    const crouch = clamp((BODY.neck - (_N.y - this.pos.y)) / 0.75, 0, 1);
    const back = 0.03 + 0.26 * crouch;
    _v.set(this.pos.x + (_N.x - this.pos.x) * 0.3 - _fw.x * back, _N.y - BODY.torso + 0.12 * crouch, this.pos.z + (_N.z - this.pos.z) * 0.3 - _fw.z * back);
    _dir.subVectors(_N, _v).normalize();
    _v.copy(_N).addScaledVector(_dir, -BODY.torso);
    B.root.worldToLocal(_v); B.hips.position.copy(_v); B.hips.updateMatrixWorld(true);
    pointBone(B.hips, UP, _w.set(0, 1, 0).lerp(_dir, 0.35), _mq);
    pointBone(B.spine, UP, _w.set(0, 1, 0).lerp(_dir, 0.8), _mq);
    pointBone(B.chest, UP, _dir, _mq);
    B.chest.getWorldQuaternion(_q); _q2.setFromAxisAngle(_dir, clamp(turn, -0.7, 0.7) * 0.6); _q.premultiply(_q2); setBoneWorldQuat(B.chest, _q);
    B.neck.getWorldPosition(_v); _e.subVectors(_N, _v);
    // never lift the hips higher than straight legs allow (tiptoes, or a head pitched down after calibration)
    const air = st === 'air', swim = st === 'swim';
    if (!S.feet || jumped || (S.wasAir && !air)) S.feet = this.plantFeet(yaw, vr.groundAt);
    if (!air && !swim) {
      B.hips.getWorldPosition(_w);
      const fy = Math.min(...S.feet.map(f => (f.t >= 1 ? f.pos.y : f.to.y)));
      const over = _w.y + _e.y - (fy + PIV.hips[1] - 0.005);
      if (over > 0) _e.y -= over;
    }
    _e.applyQuaternion(_mqi);
    B.hips.position.add(_e); B.hips.updateMatrixWorld(true);
    pointBone(B.neck, NECK_REST, _w.subVectors(_Hp, _N), _mq);
    _q.copy(vr.headQ).multiply(FLIP_Y); setBoneWorldQuat(B.head, _q);

    // --- legs: planted feet that step to keep up, or kicking / tucked when off the ground
    S.wasAir = air;
    if (air || swim) {
      for (let i = 0; i < 2; i++) {
        const Sd = i ? 'R' : 'L', sd = i ? -1 : 1;
        const th = swim ? -0.35 + Math.sin(A.t * 3.2 + sd) * 0.35 : -0.6, kn = swim ? 0.55 + Math.cos(A.t * 3.2 + sd) * 0.3 : 1.1;
        B['thigh' + Sd].rotation.set(th, 0, 0); B['shin' + Sd].rotation.set(kn, 0, 0); B['foot' + Sd].rotation.set(-(th + kn) * 0.85, 0, 0);
        B['thigh' + Sd].updateMatrixWorld(true);
      }
    } else {
      this.stepFeet(dt, S, yaw, vr.groundAt);
      for (let i = 0; i < 2; i++) {
        const Sd = i ? 'R' : 'L', sd = i ? -1 : 1, f = S.feet[i], L = LIMB['leg' + Sd];
        B['thigh' + Sd].getWorldPosition(_pole);
        _pole.addScaledVector(_fw, 0.6).addScaledVector(_lf, sd * 0.1); _pole.y -= 0.25;
        _t.copy(f.pos); _t.y += BODY.ankle;
        solveTwoBone(B['thigh' + Sd], B['shin' + Sd], L.lenA, L.lenB, _t, _pole, _mq, L.restA, L.restB);
        _q.setFromAxisAngle(UP, f.yaw); setBoneWorldQuat(B['foot' + Sd], _q);
      }
    }

    // --- arms follow the controllers; fingers follow trigger, grip and thumb
    for (let i = 0; i < 2; i++) {
      const Sd = i ? 'R' : 'L', sd = i ? -1 : 1, h = vr.hands[Sd];
      if (!h || !h.ok) {
        B['uarm' + Sd].rotation.set(0, 0, sd * 0.06); B['farm' + Sd].rotation.set(-0.2, 0, 0);
        this.setFingers(Sd, 0.3, 0.3, 0.3);
        continue;
      }
      // shoulders shrug up for high reaches and roll forward for long ones
      B['clav' + Sd].getWorldPosition(_sh);
      _w.subVectors(h.wrist, _sh);
      const up = clamp((_w.y + 0.1) / 0.5, 0, 1), fwd = clamp(_w.dot(_fw) / 0.55, 0, 1);
      B.chest.getWorldQuaternion(_q);
      _v.copy(CLAV[Sd]).applyQuaternion(_q); _v.y += up * 0.35; _v.addScaledVector(_fw, fwd * 0.3);
      pointBone(B['clav' + Sd], CLAV[Sd], _v, _mq);
      // elbows hang down and out
      B['uarm' + Sd].getWorldPosition(_pole);
      _pole.addScaledVector(_lf, sd * 0.32).addScaledVector(_fw, -0.18); _pole.y -= 0.42;
      const L = LIMB['arm' + Sd], hand = B['hand' + Sd];
      const short = solveTwoBone(B['uarm' + Sd], B['farm' + Sd], L.lenA, L.lenB, h.wrist, _pole, _mq, L.restA, L.restB);
      if (short > 0.002) {
        // keep the glove on the real hand: stretch the sleeve a little rather than leave the hand behind
        hand.getWorldPosition(_v); _v.lerp(h.wrist, Math.min(1, 0.16 / short));
        B['farm' + Sd].worldToLocal(_v); hand.position.copy(_v); hand.updateMatrixWorld(true);
      }
      setBoneWorldQuat(hand, h.quat);
      this.setFingers(Sd, h.curl, h.index, h.thumb);
    }
    if (this.headHidden) this.hideHead(_Hp.add(_e.set(0, 0.125, -0.01).applyQuaternion(vr.headQ)));
  }

  plantFeet(yaw, ground) {
    const feet = [];
    for (let i = 0; i < 2; i++) {
      const sd = i ? -1 : 1;
      const p = new THREE.Vector3(this.pos.x + Math.cos(yaw) * sd * 0.11, 0, this.pos.z - Math.sin(yaw) * sd * 0.11);
      p.y = ground ? ground(p.x, p.z, this.pos.y) : this.pos.y;
      feet.push({ pos: p, from: p.clone(), to: p.clone(), t: 1, yaw, yaw0: yaw, yaw1: yaw });
    }
    return feet;
  }

  stepFeet(dt, S, yaw, ground) {
    const lead = Math.min(0.35, S.speed * 0.28), inv = S.speed > 0.05 ? lead / S.speed : 0;
    const dur = clamp(0.3 - S.speed * 0.04, 0.17, 0.3);
    for (let i = 0; i < 2; i++) {
      const f = S.feet[i], o = S.feet[1 - i], sd = i ? -1 : 1;
      if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / dur);
        const e = f.t * f.t * (3 - 2 * f.t);
        f.pos.lerpVectors(f.from, f.to, e);
        f.pos.y += Math.sin(Math.PI * f.t) * (0.05 + Math.min(0.06, S.speed * 0.03));
        f.yaw = f.yaw0 + wrapAngle(f.yaw1 - f.yaw0) * e;
        continue;
      }
      // where this foot wants to be: beside the body, ahead of it when moving
      const x = this.pos.x + Math.cos(yaw) * sd * 0.11 + S.vx * inv, z = this.pos.z - Math.sin(yaw) * sd * 0.11 + S.vz * inv;
      const far = Math.hypot(x - f.pos.x, z - f.pos.z), turned = Math.abs(wrapAngle(yaw - f.yaw));
      if ((far > 0.17 || turned > 0.55) && o.t >= 1) {
        f.from.copy(f.pos); f.to.set(x, ground ? ground(x, z, this.pos.y) : this.pos.y, z);
        f.t = 0; f.yaw0 = f.yaw; f.yaw1 = yaw;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- Name tags (one draw call for all)
export class TagLayer {
  constructor(maxSlots = 16) {
    this.slotW = 256; this.slotH = 64; this.cols = 2; this.rows = 8;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.slotW * this.cols; this.canvas.height = this.slotH * this.rows;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.anisotropy = 4;
    this.max = maxSlots;
    const base = new THREE.PlaneGeometry(1, 0.25);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(maxSlots * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iUv = new THREE.InstancedBufferAttribute(new Float32Array(maxSlots * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.iScale = new THREE.InstancedBufferAttribute(new Float32Array(maxSlots), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.iPos); geo.setAttribute('iUv', this.iUv); geo.setAttribute('iScale', this.iScale);
    geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex }, uSlot: { value: new THREE.Vector2(1 / this.cols, 1 / this.rows) } },
      vertexShader: `
        attribute vec3 iPos; attribute vec2 iUv; attribute float iScale;
        uniform vec2 uSlot; varying vec2 vUv;
        void main() {
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          mv.xy += position.xy * iScale;
          gl_Position = projectionMatrix * mv;
          vUv = iUv + uv * uSlot;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(map, vUv);
          if (c.a < 0.02) discard;
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 60;
    this.mesh.name = 'tags';
    this.slots = new Map(); // duck -> slot index
    this.free = [];
    for (let i = maxSlots - 1; i >= 0; i--) this.free.push(i);
  }

  assign(duck) {
    if (this.slots.has(duck) || !this.free.length) return;
    this.slots.set(duck, this.free.pop());
    this.draw(duck);
  }
  release(duck) {
    const s = this.slots.get(duck);
    if (s === undefined) return;
    this.slots.delete(duck); this.free.push(s);
  }

  draw(duck) {
    const s = this.slots.get(duck);
    if (s === undefined) return;
    const g = this.g, W = this.slotW, H = this.slotH;
    const ox = (s % this.cols) * W, oy = Math.floor(s / this.cols) * H;
    g.clearRect(ox, oy, W, H);
    const tc = duck.team.tagColor || '#ffffff';
    g.fillStyle = 'rgba(14,20,24,0.78)';
    roundRect(g, ox + 4, oy + 4, W - 8, H - 8, 12); g.fill();
    g.fillStyle = tc; g.fillRect(ox + 4, oy + 4, 8, H - 8);
    g.font = `600 23px ${'"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif'}`;
    g.fillStyle = '#f3efe2'; g.textBaseline = 'middle';
    const label = duck.name.length > 18 ? duck.name.slice(0, 17) + '…' : duck.name;
    g.fillText(label, ox + 20, oy + 18);
    // career title in its colour
    const rank = duck.rank || duck.info?.rank || 1, br = duck.branch || duck.info?.spec;
    g.font = `700 14px ${'"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif'}`;
    g.fillStyle = classColor(rank, br);
    g.fillText(classTitle(rank, br).toUpperCase(), ox + 20, oy + 36);
    const frac = clamp(duck.hp / duck.maxHp, 0, 1);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(ox + 20, oy + 44, W - 92, 10);
    g.fillStyle = frac > 0.5 ? '#7bc96f' : frac > 0.25 ? '#e8c23a' : '#e2553a';
    g.fillRect(ox + 20, oy + 44, (W - 92) * frac, 10);
    g.font = `400 21px ${'"Share Tech Mono", Consolas, monospace'}`;
    g.fillStyle = '#f3efe2'; g.textAlign = 'right';
    g.fillText(String(Math.max(0, Math.ceil(duck.hp))), ox + W - 16, oy + 46);
    g.textAlign = 'left';
    this.tex.needsUpdate = true;
  }

  update(ducks, camPos) {
    let n = 0;
    for (const d of ducks) {
      const s = this.slots.get(d);
      if (s === undefined || !d.alive || d.hidden || d.firstPerson || (d.camo && d.team?.control === 'ai')) continue;
      const y = d.pos.y + 2.3;
      this.iPos.setXYZ(n, d.pos.x, y, d.pos.z);
      const dist = Math.hypot(d.pos.x - camPos.x, y - camPos.y, d.pos.z - camPos.z);
      this.iScale.setX(n, clamp(0.75 + dist * 0.022, 0.75, 3.4));
      this.iUv.setXY(n, (s % this.cols) / this.cols, 1 - (Math.floor(s / this.cols) + 1) / this.rows);
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    this.iPos.needsUpdate = true; this.iUv.needsUpdate = true; this.iScale.needsUpdate = true;
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.tex.dispose(); }
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
