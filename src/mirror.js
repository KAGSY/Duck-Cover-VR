// A field mirror for camp: in VR you can watch your duck copy your head, arms and stance.
// Planar reflection (after three.js' Reflector) that only draws objects on MIRROR_LAYER, so it stays cheap
// on Quest 1: your body, your squad, the sky, the lights and a patch of grass.
import * as THREE from 'three';

export const MIRROR_LAYER = 5;

const _rp = new THREE.Vector3(), _cp = new THREE.Vector3(), _n = new THREE.Vector3(), _view = new THREE.Vector3(), _target = new THREE.Vector3();
const _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();

export class Mirror extends THREE.Mesh {
  // hooks.before / hooks.after run around the reflection render (e.g. to show your own head to the mirror)
  constructor(width, height, { resolution = 512, tint = '#dfe8ec', hooks = {} } = {}) {
    const rt = new THREE.WebGLRenderTarget(resolution, Math.round(resolution * height / width));
    const textureMatrix = new THREE.Matrix4();
    const material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: rt.texture }, textureMatrix: { value: textureMatrix }, tint: { value: new THREE.Color(tint) } },
      vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv;
        void main() { vUv = textureMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 tint; varying vec4 vUv;
        void main() {
          vec3 c = texture2DProj(tDiffuse, vUv).rgb * tint;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    super(new THREE.PlaneGeometry(width, height), material);
    this.name = 'mirror';
    this.renderTarget = rt;
    const cam = this.camera = new THREE.PerspectiveCamera();
    cam.layers.set(MIRROR_LAYER);
    this.onBeforeRender = (renderer, scene, camera) => {
      _rp.setFromMatrixPosition(this.matrixWorld);
      _cp.setFromMatrixPosition(camera.matrixWorld);
      _rot.extractRotation(this.matrixWorld);
      _n.set(0, 0, 1).applyMatrix4(_rot);
      _view.subVectors(_rp, _cp);
      if (_view.dot(_n) > 0) return; // looking at the back
      _view.reflect(_n).negate().add(_rp);
      _rot.extractRotation(camera.matrixWorld);
      _look.set(0, 0, -1).applyMatrix4(_rot).add(_cp);
      _target.subVectors(_rp, _look).reflect(_n).negate().add(_rp);
      cam.position.copy(_view);
      cam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n);
      cam.lookAt(_target);
      cam.far = camera.far;
      cam.updateMatrixWorld();
      cam.projectionMatrix.copy(camera.projectionMatrix);
      textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      textureMatrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse).multiply(this.matrixWorld);
      // oblique near plane on the mirror surface (Lengyel)
      _plane.setFromNormalAndCoplanarPoint(_n, _rp).applyMatrix4(cam.matrixWorldInverse);
      _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
      const p = cam.projectionMatrix.elements;
      _q.set((Math.sign(_clip.x) + p[8]) / p[0], (Math.sign(_clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
      _clip.multiplyScalar(2 / _clip.dot(_q));
      p[2] = _clip.x; p[6] = _clip.y; p[10] = _clip.z + 1; p[14] = _clip.w;
      this.visible = false;
      const prevRT = renderer.getRenderTarget(), xr = renderer.xr.enabled, shadows = renderer.shadowMap.autoUpdate;
      renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
      hooks.before?.();
      renderer.setRenderTarget(rt);
      renderer.state.buffers.depth.setMask(true);
      if (renderer.autoClear === false) renderer.clear();
      renderer.render(scene, cam);
      hooks.after?.();
      renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = shadows;
      renderer.setRenderTarget(prevRT);
      if (camera.viewport !== undefined) renderer.state.viewport(camera.viewport);
      this.visible = true;
    };
  }
  dispose() { this.renderTarget.dispose(); this.material.dispose(); this.geometry.dispose(); }
}

// Wooden frame for a mirror of the given size (a child of the mirror's parent, behind the glass).
export function mirrorFrame(width, height, color = '#6b4a2e') {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const t = 0.05, d = 0.04;
  for (const [w, h, x, y] of [[width + 2 * t, t, 0, height / 2 + t / 2], [width + 2 * t, t, 0, -height / 2 - t / 2], [t, height, -width / 2 - t / 2, 0], [t, height, width / 2 + t / 2, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, -d / 2 + 0.005);
    g.add(m);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(width + 2 * t, height + 2 * t, 0.012), mat);
  back.position.z = -d + 0.006;
  g.add(back);
  return g;
}
