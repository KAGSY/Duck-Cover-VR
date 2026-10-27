// Small IK toolkit for the duck skeleton: point a bone along a direction,
// and solve two-bone limbs (arms, legs) with an elbow/knee hint.
import * as THREE from 'three';

const _pq = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qa = new THREE.Quaternion();
const _rest = new THREE.Vector3(), _d = new THREE.Vector3();
const _S = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _E = new THREE.Vector3(), _H = new THREE.Vector3();

// Give a bone an exact world orientation (keeps its position).
export function setBoneWorldQuat(bone, qWorld) {
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(qWorld));
  bone.updateMatrixWorld(true);
}

// Rotate a bone so its rest direction (in the mesh's bind space) points along dirWorld.
// meshQ is the skinned mesh's world quaternion (bones are unrotated in the bind pose).
export function pointBone(bone, restDirMesh, dirWorld, meshQ, amount = 1) {
  _rest.copy(restDirMesh).applyQuaternion(meshQ).normalize();
  _d.copy(dirWorld).normalize();
  _qa.setFromUnitVectors(_rest, _d);
  if (amount < 1) _qa.slerp(_pq.identity(), 1 - amount);
  _qw.copy(_qa).multiply(meshQ);
  setBoneWorldQuat(bone, _qw);
}

// Two-bone IK. upper/lower are bones; lenA/lenB their lengths; target and pole are world points.
// restA/restB: each bone's direction to its child in the bind pose (mesh space).
// Returns how far the reach fell short (0 when the target was reached).
export function solveTwoBone(upper, lower, lenA, lenB, target, pole, meshQ, restA, restB) {
  upper.getWorldPosition(_S);
  _u.subVectors(target, _S);
  let d = _u.length();
  const reach = lenA + lenB;
  const short = Math.max(0, d - reach * 0.999);
  d = Math.min(Math.max(d, Math.abs(lenA - lenB) + 1e-3), reach * 0.999);
  if (_u.lengthSq() < 1e-8) _u.set(0, -1, 0);
  _u.normalize();
  // bend plane from the pole hint
  _v.subVectors(pole, _S);
  _v.addScaledVector(_u, -_v.dot(_u));
  if (_v.lengthSq() < 1e-8) { _v.set(0, 0, 1).applyQuaternion(meshQ); _v.addScaledVector(_u, -_v.dot(_u)); }
  _v.normalize();
  const cosA = (lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _E.copy(_S).addScaledVector(_u, lenA * cosA).addScaledVector(_v, lenA * sinA);
  _H.copy(_S).addScaledVector(_u, d);
  pointBone(upper, restA, _d.subVectors(_E, _S), meshQ);
  lower.getWorldPosition(_E); // actual elbow after rotating the upper bone
  pointBone(lower, restB, _H.sub(_E), meshQ);
  return short;
}
