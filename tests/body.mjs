// Headless checks for the humanoid duck rig: geometry, third-person poses, weapon holds, and the VR body solver.
import * as THREE from 'three';
import { Duck, BODY, handQuat } from '../src/duck.js';
import { weaponModel } from '../src/models.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const nanFree = (d) => d.bones.list.every(b => [b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w].every(Number.isFinite));
const wp = (o) => o.getWorldPosition(new THREE.Vector3());

const quality = { duckMat: 'lambert', shadows: false };
const look = { species: 'mallard', helmet: '#5d6a3a', belt: '#3c4628', accent: '#e2c044', tunic: '#6b7246', trousers: '#5a5f3b', rank: 3, commander: true };
const scene = new THREE.Scene();
const d = new Duck({ info: { name: 'Test', maxHp: 100 }, team: {}, look, quality });
scene.add(d.mesh);
const g = d.mesh.geometry;
console.log('vertices', g.attributes.position.count, 'triangles', g.index.count / 3, 'bones', d.bones.list.length);
ok(g.attributes.position.count < 6000, 'vertex budget');
ok(d.bones.list.length === 27, '27 bones');
const sw = g.attributes.skinWeight;
let wOk = true; for (let i = 0; i < sw.count; i++) { const s = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i); if (Math.abs(s - 1) > 1e-4) { wOk = false; break; } }
ok(wOk, 'skin weights sum to 1');
g.computeBoundingBox();
console.log('bbox', g.boundingBox.min.toArray().map(v => v.toFixed(2)), g.boundingBox.max.toArray().map(v => v.toFixed(2)));
ok(g.boundingBox.max.y > 1.8 && g.boundingBox.max.y < 1.95, 'height ~1.85-1.9 m with helmet');

// third person: idle, walk, aim each weapon, gestures
d.pos.set(3, 0, -2); d.yaw = 0.7;
for (let i = 0; i < 30; i++) d.animate(1 / 30);
ok(nanFree(d), 'idle pose finite');
d.state = 'walk';
for (let i = 0; i < 30; i++) { d.pos.x += 0.1; d.animate(1 / 30); }
ok(nanFree(d), 'walk pose finite');
d.state = 'idle';
for (const w of ['bazooka', 'cluster', 'homing', 'mortar', 'rifle', 'sniper', 'grenade', 'mine', 'airstrike', 'medkit']) {
  d.weapon = w; d.showWeapon(weaponModel(w), w);
  d.anim.aiming = 1; d.anim.aimPitch = w === 'mortar' ? 0.9 : 0.3;
  for (let i = 0; i < 40; i++) d.animate(1 / 30);
  d.mesh.updateMatrixWorld(true);
  const hand = wp(d.bones.handR);
  let gripErr = -1;
  if (d.hold.type !== 'hand') {
    const grip = d.weaponMesh.localToWorld(new THREE.Vector3(0.025, 0.01, 0.06));
    gripErr = hand.distanceTo(grip);
  }
  const lh = wp(d.bones.handL), ls = wp(d.bones.uarmL);
  console.log(`  ${w.padEnd(9)} grip err ${gripErr.toFixed(3)}  left hand-shoulder ${lh.distanceTo(ls).toFixed(2)}`);
  ok(nanFree(d) && (gripErr < 0.02), `${w} hold`);
}
d.showWeapon(null); d.weapon = 'slap';
d.anim.aiming = 0;
d.salute(2);
for (let i = 0; i < 20; i++) d.animate(1 / 30);
d.mesh.updateMatrixWorld(true);
const salH = wp(d.bones.handR), headP = wp(d.bones.head);
console.log('  salute hand-head', salH.distanceTo(headP).toFixed(2));
ok(salH.distanceTo(headP) < 0.3, 'salute hand by the helmet');
for (const st of ['swim', 'air']) { d.state = st; for (let i = 0; i < 20; i++) d.animate(1 / 30); ok(nanFree(d), `${st} pose finite`); }
d.state = 'idle'; d.anim.cheer = 3; for (let i = 0; i < 20; i++) d.animate(1 / 30); ok(nanFree(d), 'cheer finite');
d.anim.cheer = 0;

// VR body: head 1.62 above the feet, hands in front
const v = new Duck({ info: { name: 'Me', maxHp: 100 }, team: {}, look, quality });
scene.add(v.mesh);
v.pos.set(0, 2, 0);
v.setFirstPerson(true, true);
const headQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.4, 0, 'YXZ'));
const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQ);
const mkHand = (side, pos, dir) => {
  const cq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize());
  const sd = side === 'L' ? 1 : -1;
  const hq = handQuat(side, new THREE.Vector3(0, -0.5, -0.866), new THREE.Vector3(-sd, 0, 0));
  return { ok: true, wrist: new THREE.Vector3(-sd * 0.015, -0.015, 0.112).applyQuaternion(cq).add(pos), quat: cq.clone().multiply(hq), curl: 0.5, index: 0.2, thumb: 1 };
};
const eye = new THREE.Vector3(0.05, 2 + 1.62, 0.02);
const right = new THREE.Vector3(Math.cos(0.4), 0, -Math.sin(0.4));
const vr = {
  eye, headQ,
  hands: {
    L: mkHand('L', eye.clone().addScaledVector(right, -0.2).add(new THREE.Vector3(0, -0.45, 0)).addScaledVector(fwd, 0.35), fwd),
    R: mkHand('R', eye.clone().addScaledVector(right, 0.2).add(new THREE.Vector3(0, -0.4, 0)).addScaledVector(fwd, 0.4), fwd),
  },
  groundAt: () => 2,
};
for (let i = 0; i < 60; i++) v.driveVR(1 / 60, vr);
v.mesh.updateMatrixWorld(true);
ok(nanFree(v), 'VR pose finite');
for (const S of ['L', 'R']) {
  const e = wp(v.bones['hand' + S]).distanceTo(vr.hands[S].wrist);
  console.log(`  VR ${S} wrist error ${e.toFixed(4)}`);
  ok(e < 0.005, `VR ${S} hand on the controller`);
  const q = v.bones['hand' + S].getWorldQuaternion(new THREE.Quaternion());
  ok(q.angleTo(vr.hands[S].quat) < 0.01, `VR ${S} hand orientation`);
}
const neck = wp(v.bones.neck);
console.log('  neck', neck.toArray().map(x => x.toFixed(3)), 'eye', eye.toArray().map(x => x.toFixed(3)));
ok(eye.y - neck.y > 0.15 && eye.y - neck.y < 0.3, 'neck below the eyes');
for (const S of ['L', 'R']) { const f = wp(v.bones['foot' + S]); ok(Math.abs(f.y - (2 + BODY.ankle)) < 0.03, `VR ${S} foot planted (${f.y.toFixed(3)})`); }
// crouch: head 0.5 lower -> hips drop, knees bend, feet stay planted
eye.y -= 0.5; for (const S of ['L', 'R']) vr.hands[S].wrist.y -= 0.5;
for (let i = 0; i < 30; i++) v.driveVR(1 / 60, vr);
v.mesh.updateMatrixWorld(true);
const hipsY = wp(v.bones.hips).y - 2;
console.log('  crouch hips height', hipsY.toFixed(3));
ok(hipsY < 0.75, 'crouch lowers the hips');
for (const S of ['L', 'R']) { const f = wp(v.bones['foot' + S]); ok(Math.abs(f.y - (2 + BODY.ankle)) < 0.03, `crouch ${S} foot planted`); }
// walking: move the duck, feet should take steps
eye.y += 0.5; for (const S of ['L', 'R']) vr.hands[S].wrist.y += 0.5;
let steps = 0, prevT = [1, 1];
for (let i = 0; i < 120; i++) {
  v.pos.x += 2.5 / 60; eye.x += 2.5 / 60; for (const S of ['L', 'R']) vr.hands[S].wrist.x += 2.5 / 60;
  v.state = 'walk';
  v.driveVR(1 / 60, vr);
  v.vrs.feet.forEach((f, k) => { if (f.t < 1 && prevT[k] >= 1) steps++; prevT[k] = f.t; });
}
console.log('  steps in 2 s at 2.5 m/s:', steps);
ok(steps >= 5 && steps <= 14, 'walking takes steps');
const lag = Math.min(...v.vrs.feet.map(f => Math.hypot(f.pos.x - v.pos.x, f.pos.z - v.pos.z)));
ok(lag < 0.6, `feet keep up (${lag.toFixed(2)} m)`);
v.state = 'idle';
// hand far out of reach: stretch only a little
vr.hands.R.wrist.copy(eye).addScaledVector(fwd, 1.5);
for (let i = 0; i < 5; i++) v.driveVR(1 / 60, vr);
v.mesh.updateMatrixWorld(true);
const gap = wp(v.bones.handR).distanceTo(vr.hands.R.wrist);
ok(gap > 0.3 && nanFree(v), `out-of-reach hand stays attached to the arm (gap ${gap.toFixed(2)})`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
