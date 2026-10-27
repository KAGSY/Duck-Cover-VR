// First-person player: you see through your duck's eyes (VR or mouse-look),
// move with teleport/smooth locomotion, aim with your hand, and fire.
import * as THREE from 'three';
import { ctx, emit, on, clamp, lerp, damp, wrapAngle } from './ctx.js';
import { WEAPONS } from './weapons.js';
import * as MD from './models.js';
import { Ribbon, makeGroundRing } from './fx.js';
import { muzzleFor, dirFrom, SWIM_Y } from './battle.js';
import { WATER, HALF } from './terrain.js';
import { SPECIES, handQuat, heldMuzzle } from './duck.js';
import { Follower, C } from './ui.js';
import { Hit } from './physics.js';

export const DUCK_EYE = 1.62;
// On a flat screen your eye stays put while you aim; looking well down tips your head forward to see your body.
const EYE_STAND = { y: 1.635, z: -0.095 }, EYE_PEER = { y: 1.5, z: -0.27 };
// Where your wrist and hand sit relative to a Touch controller's pointing pose (controller space:
// -Z along the laser, +Y up). The fist wraps the weapon grip with the knuckles 40 degrees below the laser,
// which is how a hand closes round the Touch handle.
const WRIST = { x: 0.015, y: -0.006, z: 0.106 };
const KNUCKLES = new THREE.Vector3(0, -Math.sin(0.7), -Math.cos(0.7));
const HANDQ = {
  L: handQuat('L', KNUCKLES, new THREE.Vector3(-1, 0, 0)),
  R: handQuat('R', KNUCKLES, new THREE.Vector3(1, 0, 0)),
};
const TIP = { bazooka: 0.95, cluster: 0.9, mortar: 0.62, rifle: 0.8, sniper: 1.05, homing: 0.8, grenade: 0.12, mine: 0.12, airstrike: 0.12, medkit: 0.12, slap: 0.25,
  airburst: 0.62, shotgun: 0.75, medidart: 0.3, tnt: 0.12, camo: 0.12, sandbags: 0.12, jetpack: 0.12, paradrop: 0.2 };
const SMALL_ITEMS = ['grenade', 'mine', 'airstrike', 'medkit', 'tnt', 'camo', 'sandbags'];

export class Player {
  constructor({ scene, camera, rig, input, ui, hud }) {
    this.scene = scene; this.camera = camera; this.rig = rig; this.input = input; this.ui = ui; this.hud = hud;
    this.duck = null;
    this.hit = new Hit();
    this.heightOffset = 0; this.calibT = -1;
    this.yaw = 0; this.pitch = 0;
    this.fadeV = 1; this.fadeTarget = 0; this.fadeSpeed = 3; this.fadeQueue = [];
    this.vignetteV = 0;
    this.blackout = false; this.tether = 0;
    this.charging = false; this.power = 0; this.chargeT = 0; this.pointing = false; this.chargeSound = null;
    this.tp = { active: false, ok: false, x: 0, z: 0, reason: '' };
    this.snapReady = true; this.flickReady = true; this.endHold = 0;
    this.inBattle = false; this.paused = false;
    this.bigMap = false;
    this.tut = null;
    // fade + vignette (attached to the camera)
    this.fadeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, fog: false }));
    this.fadeMesh.renderOrder = 9999;
    camera.add(this.fadeMesh);
    this.vigMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uStrength; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(0.42 - uStrength * 0.18, 0.95 - uStrength * 0.35, d) * uStrength; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }',
      transparent: true, depthTest: false, depthWrite: false,
    }));
    this.vigMesh.position.set(0, 0, -0.6);
    this.vigMesh.renderOrder = 9998;
    this.vigMesh.visible = false;
    camera.add(this.vigMesh);
    // aim visuals
    this.arc = new Ribbon(60, 0.035, '#f2c230', { opacity: 0.9, dashed: true });
    this.laser = new Ribbon(2, 0.012, '#ff4a3a', { opacity: 0.85, additive: true });
    this.tpArc = new Ribbon(48, 0.03, '#7bc96f', { opacity: 0.85 });
    this.target = makeGroundRing('#f2c230', 0.55, 0.8);
    this.tpRing = makeGroundRing('#7bc96f', 0.35, 0.55);
    for (const o of [this.arc.mesh, this.laser.mesh, this.tpArc.mesh, this.target, this.tpRing]) scene.add(o);
    this.arcPts = new Float32Array(60 * 3);
    // hands
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.weaponGeo = {};
    this.handWeapon = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.handWeapon.visible = false;
    this.offWing = null; this.mainWing = null;
    // desktop crosshair
    const ch = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.0095, 24), new THREE.MeshBasicMaterial({ color: '#fff4c8', transparent: true, opacity: 0.85, depthTest: false }));
    ch.position.set(0, 0, -1); ch.renderOrder = 300; ch.visible = false;
    camera.add(ch); this.crosshair = ch;
    // panel followers (VR)
    this.followBanner = new Follower(hud.banner.panel.mesh, { dist: 1.7, height: 0.32, lag: 2.5 });
    this.followToast = new Follower(hud.toasts.panel.mesh, { dist: 1.7, height: -0.42, lag: 2.5 });
    this.followHint = new Follower(hud.hint.panel.mesh, { dist: 1.5, height: -0.62, lag: 2 });
    this.followMap = new Follower(hud.wrist.panel.mesh, { dist: 0.62, height: -0.08, lag: 6 });
    this.bindEvents();
  }

  // ------------------------------------------------------------------ events
  bindEvents() {
    on('turnStart', ({ team, duck, battle }) => {
      if (!this.inBattle) return;
      this.cancelAim();
      if (team.control === 'human') {
        const humans = battle.teams.filter(t => t.control === 'human');
        const other = this.duck && this.duck.team !== team;
        if (humans.length > 1 && other) { ctx.app.handoff(team, () => { this.inhabit(duck); this.turnBanner(battle); }); return; }
        this.inhabit(duck, { fade: !this.duck || this.duck !== duck });
        this.turnBanner(battle);
      } else {
        ctx.hud.banner.show('ENEMY TURN', team.name, team.tagColor || C.bad, 2.2);
        ctx.audio?.play('enemyTurn');
        if (!this.duck || !this.duck.alive) this.inhabitSurvivor(battle);
      }
    });
    on('activeDuck', ({ duck, battle }) => {
      if (!this.inBattle || !battle.isHumanTurn() || battle.phase !== 'act') return;
      if (this.duck !== duck) { this.inhabit(duck); ctx.hud.banner.show('SWITCHED', duck.name, C.accent, 1.4); }
    });
    on('duckKilled', ({ duck, battle }) => {
      if (duck === this.duck) setTimeout(() => { if (this.inBattle && this.duck === duck) this.inhabitSurvivor(battle); }, 1400);
    });
    on('damage', ({ duck, amount }) => {
      if (duck === this.duck) { this.input.main.pulse(0.9, 120); this.input.off.pulse(0.9, 120); this.flash = 0.5; }
    });
    on('explosion', ({ x, y, z, radius }) => {
      if (!this.duck) return;
      const d = Math.hypot(x - this.duck.pos.x, z - this.duck.pos.z);
      if (d < radius * 4) { const k = clamp(1 - d / (radius * 4), 0, 1); this.input.main.pulse(0.3 + k * 0.6, 60 + k * 120); this.input.off.pulse(0.3 + k * 0.6, 60 + k * 120); }
    });
    on('toast', ({ text, kind }) => ctx.hud.toasts.push(text, kind));
    on('weaponChange', () => this.refreshHandWeapon());
    on('fired', () => this.cancelAim(false));
    on('ability', ({ duck }) => { if (duck === this.duck) { this.cancelAim(false); this.input.main.pulse(0.5, 50); } });
    on('paradrop', ({ duck }) => {
      // a plane drops you off: a moment's black, then the long float down
      if (duck === this.duck && this.inBattle) { this.fadeV = 1; this.fadeTarget = 0; this.fadeSpeed = 1.6; }
    });
  }

  turnBanner(battle) {
    ctx.hud.banner.show('YOUR TURN', battle.active ? battle.active.name : '', C.accent, 2.2);
    ctx.audio?.play('turn');
    this.input.main.pulse(0.4, 60);
  }

  inhabitSurvivor(battle) {
    const pref = battle.teams.find(t => t.control === 'human' && (!this.duck || t === this.duck.team)) || battle.playerTeam();
    const alive = pref.ducks.find(d => d.alive) || battle.teams.filter(t => t.control === 'human').flatMap(t => t.ducks).find(d => d.alive);
    if (alive) this.inhabit(alive);
  }

  // ------------------------------------------------------------------ fades
  fadeThen(fn, speed = 5) {
    if (this.fadeV >= 0.98) { fn(); this.fadeTarget = 0; return; }
    this.fadeQueue.push(fn);
    this.fadeTarget = 1; this.fadeSpeed = speed;
  }
  fadeIn(speed = 3) { this.fadeTarget = 0; this.fadeSpeed = speed; }
  fadeOut(speed = 4) { this.fadeTarget = 1; this.fadeSpeed = speed; }
  updateFade(dt) {
    const target = Math.max(this.fadeTarget, this.blackout ? 1 : 0, this.tether);
    this.fadeV = this.fadeV < target ? Math.min(target, this.fadeV + dt * this.fadeSpeed) : Math.max(target, this.fadeV - dt * this.fadeSpeed);
    if (this.fadeV >= 0.999 && this.fadeQueue.length) {
      const q = this.fadeQueue.splice(0);
      for (const fn of q) fn();
      this.fadeTarget = 0;
    }
    this.fadeMesh.material.opacity = this.fadeV;
    this.fadeMesh.visible = this.fadeV > 0.002;
    if (this.flash > 0) {
      this.flash -= dt;
      this.fadeMesh.material.color.setRGB(Math.max(0, this.flash) * 0.9, 0, 0);
      this.fadeMesh.material.opacity = Math.max(this.fadeV, this.flash * 0.45);
      this.fadeMesh.visible = true;
    } else this.fadeMesh.material.color.setRGB(0, 0, 0);
  }

  // ------------------------------------------------------------------ rig placement
  headLocal() { return this.camera.position; }
  headLocalYaw() {
    _f.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return Math.atan2(_f.x, _f.z);
  }
  headWorldYaw() {
    this.camera.getWorldDirection(_f);
    return Math.atan2(_f.x, _f.z);
  }
  // Place the viewer's head over (x,z) on the duck, facing yaw (duck convention: dir = (sin, cos)).
  placeAt(x, y, z, yaw) {
    if (ctx.isXR) {
      const th = yaw - this.headLocalYaw();
      this.rig.rotation.set(0, th, 0);
      const h = this.headLocal();
      const ox = h.x * Math.cos(th) + h.z * Math.sin(th), oz = -h.x * Math.sin(th) + h.z * Math.cos(th);
      this.rig.position.set(x - ox, y + this.heightOffset, z - oz);
    } else {
      this.yaw = yaw;
      this.rig.rotation.set(0, yaw - Math.PI, 0);
      this.camera.position.set(0, DUCK_EYE, 0);
      this.camera.rotation.set(this.pitch, 0, 0);
      this.rig.position.set(x, y, z);
    }
    this.rig.updateMatrixWorld(true);
  }

  inhabit(duck, { fade = true } = {}) {
    const go = () => {
      if (this.duck && this.duck !== duck) this.duck.setFirstPerson(false);
      this.duck = duck;
      duck.setFirstPerson(true, this.bodyMode());
      this.placeAt(duck.pos.x, duck.pos.y, duck.pos.z, duck.yaw);
      this.refreshHandWeapon();
    };
    if (fade) this.fadeThen(go, 6); else go();
  }

  snapTurn(delta) {
    this.camera.getWorldPosition(_h);
    const r = this.rig;
    const dx = r.position.x - _h.x, dz = r.position.z - _h.z;
    const c = Math.cos(delta), s = Math.sin(delta);
    r.position.x = _h.x + dx * c + dz * s;
    r.position.z = _h.z - dx * s + dz * c;
    r.rotation.y += delta;
    r.updateMatrixWorld(true);
    // your body turns with you
    const body = this.inBattle ? this.duck : this.menuBody, S = body?.vrs;
    if (S) {
      S.yaw += delta;
      for (const f of S.feet || []) {
        for (const p of [f.pos, f.from, f.to]) { const px = p.x - _h.x, pz = p.z - _h.z; p.x = _h.x + px * c + pz * s; p.z = _h.z - px * s + pz * c; }
        f.yaw += delta; f.yaw0 += delta; f.yaw1 += delta;
      }
    }
  }

  calibrate() { this.calibT = 0.6; }

  // ------------------------------------------------------------------ hands
  setupHands(team) {
    const look = team ? team.look : { species: 'mallard', belt: '#3c4628', helmet: '#5d6a3a', accent: '#e2c044' };
    const sp = SPECIES[look.species];
    const mkWing = () => {
      const b = new MD.GeoBuilder(77);
      b.add(MD.sph(0.06, 10, 8), sp.wing, MD.M(0, 0, 0.02, 0, 0, 0, 0.8, 0.55, 1.4), { ao: 0.2 });
      for (let i = 0; i < 4; i++) b.add(MD.cone(0.025, 0.11, 4), i % 2 ? sp.wing : sp.speculum, MD.M(-0.03 + i * 0.02, 0, -0.08, -Math.PI / 2, 0, 0, 1, 0.5, 1), { flat: true });
      b.add(MD.cyl(0.052, 0.058, 0.05, 10), look.belt, MD.M(0, 0, 0.1, Math.PI / 2, 0, 0));
      return new THREE.Mesh(b.build(), this.mat);
    };
    for (const w of [this.offWing, this.mainWing]) if (w) { w.parent?.remove(w); w.geometry.dispose(); }
    this.offWing = mkWing(); this.mainWing = mkWing();
    this.attachHands();
  }
  attachHands() {
    const main = this.input.main, off = this.input.off;
    if (ctx.isXR) {
      if (main.controller) { main.controller.add(this.handWeapon); main.controller.add(this.mainWing); }
      if (off.grip || off.controller) (off.grip || off.controller).add(this.offWing);
      this.handWeapon.position.set(0, -0.035, 0.07);
      this.handWeapon.rotation.set(0, 0, 0);
      this.handWeapon.scale.setScalar(1);
    } else {
      this.camera.add(this.handWeapon);
      this.handWeapon.position.set(0.27, -0.25, -0.8);
      this.handWeapon.rotation.set(0.05, 0.13, 0);
      this.handWeapon.scale.setScalar(0.55);
    }
    this.refreshHandWeapon();
  }
  refreshHandWeapon() {
    const b = ctx.battle, d = this.duck;
    const show = this.inBattle && b && d && b.active === d && b.isHumanTurn() && b.phase === 'act';
    const w = d ? d.weapon : null;
    const gloves = ctx.isXR && !this.bodyActive();
    if (this.offWing) this.offWing.visible = gloves;
    // on a screen with your body showing, your duck holds the weapon itself
    if (!show || !w || w === 'slap' || this.screenBody()) { this.handWeapon.visible = false; if (this.mainWing) this.mainWing.visible = gloves; return; }
    if (!this.weaponGeo[w]) this.weaponGeo[w] = MD.weaponModel(WEAPONS[w].model);
    this.handWeapon.geometry = this.weaponGeo[w];
    this.handWeapon.visible = true;
    if (ctx.isXR) {
      // with your duck's glove on the controller, small items sit in the fist at fist size
      const small = this.bodyActive() && SMALL_ITEMS.includes(w);
      this.handWeapon.scale.setScalar(small ? 0.6 : 1);
      this.handWeapon.position.set(0, small ? -0.081 : -0.035, small ? 0.084 : 0.07);
    }
    if (this.mainWing) this.mainWing.visible = false;
  }

  // ------------------------------------------------------------------ your body (VR)
  // Your body: 'vr' in a headset, 'screen' on a flat screen, or false for the floating-hands style.
  bodyMode() { return ctx.settings.vrBody === 'hands' ? false : ctx.isXR ? 'vr' : 'screen'; }
  fullBody() { return this.bodyMode() === 'vr'; }
  bodyActive() { return this.fullBody() && !!(this.inBattle ? this.duck : this.menuBody); }
  screenBody() { return !ctx.isXR && !!this.duck?.screenBody; }
  applyBodyMode() {
    const mode = this.bodyMode();
    if (this.duck) this.duck.setFirstPerson(true, mode);
    if (this.menuBody) this.menuBody.setFirstPerson(true, mode === 'vr' && !this.inBattle ? 'vr' : false);
    this.refreshHandWeapon();
  }
  // Where the crosshair lands (terrain, buildings or ducks), so shots from your shoulder meet it.
  crosshairPoint(range) {
    const b = ctx.battle;
    if (!b) return null;
    this.camera.getWorldPosition(_cpa); this.camera.getWorldDirection(_cpd);
    let x = _cpa.x, y = _cpa.y, z = _cpa.z, left = range;
    while (left > 0) {
      const st = Math.min(8, left);
      b.W.segment(x, y, z, x + _cpd.x * st, y + _cpd.y * st, z + _cpd.z * st, this.hit, { ignoreDuck: this.duck });
      if (this.hit.hit) return _cpt.set(this.hit.x, this.hit.y, this.hit.z);
      x += _cpd.x * st; y += _cpd.y * st; z += _cpd.z * st; left -= st;
    }
    return _cpt.set(x, y, z);
  }
  // After the battle step: pose the inhabited duck from the headset and controllers.
  lateUpdate(dt) {
    if (!ctx.isXR) return;
    const d = this.inBattle ? this.duck : this.menuBody;
    if (!d || !d.vrDriven) return;
    if (!this.inBattle) {
      // in camp your feet follow your head around
      this.camera.getWorldPosition(_h);
      const dx = _h.x - d.pos.x, dz = _h.z - d.pos.z, l = Math.hypot(dx, dz);
      if (l > 0.3) { d.pos.x += dx / l * (l - 0.3); d.pos.z += dz / l * (l - 0.3); }
      if (ctx.world) d.pos.y = ctx.world.terrain.heightAt(d.pos.x, d.pos.z);
    }
    if (this.blackout || (d.state === 'air' && !d.jumping)) { d.animate(dt); return; }
    d.driveVR(dt, this.vrPose());
  }
  vrPose() {
    const mk = () => ({ ok: false, wrist: new THREE.Vector3(), quat: new THREE.Quaternion(), curl: 0, index: 0, thumb: 0 });
    const P = this._vp || (this._vp = { eye: new THREE.Vector3(), headQ: new THREE.Quaternion(), hands: { L: mk(), R: mk() }, groundAt: null });
    this.camera.getWorldPosition(P.eye); this.camera.getWorldQuaternion(P.headQ);
    const main = this.input.main;
    for (const [k, hand] of [['L', this.input.hands.left], ['R', this.input.hands.right]]) {
      const h = P.hands[k], c = hand.controller;
      h.ok = !!(hand.connected && c && c.visible !== false);
      if (!h.ok) continue;
      c.getWorldPosition(_o); c.getWorldQuaternion(_cq);
      const sd = k === 'L' ? 1 : -1;
      h.wrist.set(-sd * WRIST.x, WRIST.y, WRIST.z).applyQuaternion(_cq).add(_o);
      h.quat.copy(_cq).multiply(HANDQ[k]);
      // fingers: grip squeezes the fist, trigger curls the index finger, thumb rests on the buttons
      const b = hand.gamepad?.buttons || [];
      const holding = hand === main && this.handWeapon.visible;
      const trig = b[0]?.value || 0, squeeze = b[1]?.value || 0;
      const thumbDown = !!(b[3]?.touched || b[4]?.touched || b[5]?.touched || b[6]?.touched || b[4]?.pressed || b[5]?.pressed);
      h.index = holding ? 0.35 + trig * 0.55 : Math.max(trig, b[0]?.touched ? 0.25 : 0);
      h.curl = holding ? 1 : squeeze;
      h.thumb = holding ? 0.85 : thumbDown ? 0.9 : 0.15;
    }
    P.groundAt = this.groundFn || (this.groundFn = (x, z, y) => {
      const b = ctx.battle;
      if (b && this.inBattle) return b.W.supportHeight(x, z, y + 0.6);
      return ctx.world ? ctx.world.terrain.heightAt(x, z) : y;
    });
    return P;
  }

  // muzzle + aim direction for the current weapon
  aimPose(outO, outD) {
    const w = this.duck?.weapon || 'bazooka';
    if (ctx.isXR && this.input.main.controller) {
      const c = this.input.main.controller;
      c.updateMatrixWorld();
      outD.set(0, 0, -1).transformDirection(c.matrixWorld);
      outO.set(0, 0.07, -TIP[w] + 0.07).applyMatrix4(c.matrixWorld);
    } else if (this.screenBody()) {
      // your duck's own weapon: shots leave its muzzle; direct-fire weapons meet the crosshair
      const d = this.duck, def = WEAPONS[w];
      this.camera.updateMatrixWorld();
      this.camera.getWorldDirection(outD);
      heldMuzzle(d, d.yaw, this.pitch, outO);
      if (def && (def.kind === 'hitscan' || def.kind === 'bullet' || def.fire === 'point')) {
        const pt = this.crosshairPoint(def.range || 160);
        if (pt && pt.distanceToSquared(outO) > 1) outD.subVectors(pt, outO).normalize();
      }
    } else {
      // the on-screen weapon's muzzle (see attachHands), aiming at the crosshair
      this.camera.updateMatrixWorld();
      this.camera.getWorldDirection(outD);
      outO.set(0.2, -0.19, -0.8 - TIP[w] * 0.55).applyMatrix4(this.camera.matrixWorld);
    }
    return outO;
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    this.updateFade(dt);
    const inp = this.input;
    if (ctx.isXR && this.calibT > 0) {
      this.calibT -= dt;
      if (this.calibT <= 0) {
        const hy = this.camera.position.y;
        this.heightOffset = ctx.settings.heightMode === 'auto' && hy > 0.5 ? DUCK_EYE - hy : (hy < 0.5 ? DUCK_EYE - hy : 0);
        if (this.duck) this.placeAt(this.duck.pos.x, this.duck.pos.y, this.duck.pos.z, this.headWorldYaw());
        else if (this.menuSpot) this.placeMenu();
      }
    }
    // desktop look (battle only, pointer locked)
    if (!ctx.isXR && this.inBattle && !this.paused) {
      const s = 0.0022 * (ctx.settings.mouseSens || 1);
      this.yaw -= inp.mouse.dx * s;
      const lo = -1.35;
      this.pitch = clamp(this.pitch - inp.mouse.dy * s * (ctx.settings.invertY ? -1 : 1), lo, 1.35);
      // arrow keys look around too
      const kt = 1.6 * dt;
      if (inp.key('ArrowLeft')) this.yaw += kt;
      if (inp.key('ArrowRight')) this.yaw -= kt;
      if (inp.key('ArrowUp')) this.pitch = clamp(this.pitch + kt * 0.7, lo, 1.35);
      if (inp.key('ArrowDown')) this.pitch = clamp(this.pitch - kt * 0.7, lo, 1.35);
    }
    this.crosshair.visible = !ctx.isXR && this.inBattle && inp.aiming && !this.paused;
    if (!this.inBattle || !ctx.battle || !this.duck) { this.hideAim(); return; }
    const b = ctx.battle, d = this.duck;
    const myTurn = b.isHumanTurn() && b.active === d && b.team === d.team;
    const canAct = myTurn && b.canAct() && !this.paused;
    // --- knockback: black out while our duck is flying, then re-anchor
    if (d.alive && d.state === 'air' && !d.jumping) { if (!this.blackout) { this.blackout = true; this.fadeSpeed = 9; } }
    else if (this.blackout) { this.blackout = false; this.placeAt(d.pos.x, d.pos.y, d.pos.z, this.headWorldYaw()); this.fadeSpeed = 3; }
    // --- movement
    let moving = 0;
    if (ctx.isXR) moving = this.updateXRMove(dt, d, b, canAct);
    else moving = this.updateDesktopMove(dt, d, b, canAct);
    this.vignetteV = damp(this.vignetteV, moving ? { off: 0, low: 0.55, high: 0.9 }[ctx.settings.vignette] ?? 0.5 : 0, 8, dt);
    this.vigMesh.visible = ctx.isXR && this.vignetteV > 0.01;
    this.vigMesh.material.uniforms.uStrength.value = this.vignetteV;
    // your duck faces where you look (unless the computer has taken over your side, as in the soak tests)
    if (d.team.control === 'human') {
      d.yaw = this.headWorldYaw();
      if (this.screenBody()) { d.anim.aimPitch = this.pitch; d.anim.aiming = damp(d.anim.aiming, canAct ? 1 : 0, 8, dt); }
    }
    // --- weapon handling
    if (canAct) this.updateWeapon(dt, d, b);
    else this.hideAim();
    // --- buttons
    if (myTurn && b.phase === 'act' && !this.paused) {
      const switchPressed = ctx.isXR ? inp.off.pressed('a') : inp.keyPressed('Tab');
      if (switchPressed && !this.charging) { if (!b.switchDuck(1)) { ctx.audio?.play('deny'); emit('toast', { text: b.moved >= 0.6 ? 'You can only switch before moving' : 'No other duck to switch to', kind: 'info' }); } }
      const jumpPressed = ctx.isXR ? inp.main.pressed('a') : inp.keyPressed('Space');
      if (jumpPressed && b.jump(d)) ctx.audio?.play('quack', d.pos, { pitch: 1.1 });
      const endHeld = ctx.isXR ? inp.main.held('b') : (inp.key('Enter') || inp.key('Backspace'));
      this.endHold = endHeld ? this.endHold + dt : 0;
      if (this.endHold > 1.0) { this.endHold = 0; this.cancelAim(); b.skipTurn(); }
    } else this.endHold = 0;
    this.bigMap = ctx.isXR ? inp.off.held('grip') : inp.key('KeyM');
    // --- tutorial
    if (this.tut) this.updateTutorial(dt, b, d);
  }

  updateXRMove(dt, d, b, canAct) {
    const inp = this.input, off = inp.off, main = inp.main;
    let moving = 0;
    // while your duck is airborne under its own steam (jump, jetpack, parachute) the world carries you with it
    if (this.followPrev && this.followPrev.duck === d && d.state === 'air' && d.jumping) {
      this.rig.position.x += d.pos.x - this.followPrev.x; this.rig.position.z += d.pos.z - this.followPrev.z;
    }
    this.followPrev = { duck: d, x: d.pos.x, z: d.pos.z };
    // physical leaning / walking: the duck follows your head beyond a small radius
    this.camera.getWorldPosition(_h);
    const ox = _h.x - d.pos.x, oz = _h.z - d.pos.z, ol = Math.hypot(ox, oz);
    if (canAct && ol > 0.28 && d.state !== 'air') {
      const want = ol - 0.28;
      b.walk(d, ox / ol * want, oz / ol * want);
    }
    const ol2 = Math.hypot(_h.x - d.pos.x, _h.z - d.pos.z);
    this.tether = clamp((ol2 - 0.55) / 0.5, 0, 0.85);
    // turning
    const tx = main.axes.x;
    if (ctx.settings.turning === 'smooth') {
      if (Math.abs(tx) > 0.25) { this.snapTurn(-tx * 2.2 * dt); moving = 1; }
    } else {
      if (this.snapReady && Math.abs(tx) > 0.7) { this.snapTurn(-Math.sign(tx) * (ctx.settings.turning === 'snap45' ? Math.PI / 4 : Math.PI / 6)); this.snapReady = false; }
      if (Math.abs(tx) < 0.3) this.snapReady = true;
    }
    // locomotion
    const sx = off.axes.x, sy = off.axes.y;
    if (ctx.settings.locomotion === 'smooth') {
      this.tp.active = false; this.tpArc.hide(); this.tpRing.visible = false;
      const mag = Math.hypot(sx, sy);
      if (canAct && mag > 0.2) {
        this.camera.getWorldDirection(_f); _f.y = 0; _f.normalize();
        const rx = -_f.z, rz = _f.x; // right vector
        const speed = (d.state === 'swim' ? 1.6 : 3.0) * (d.perks?.speedMul || 1) * Math.min(1, (mag - 0.2) / 0.7);
        const mx = (_f.x * -sy + rx * sx), mz = (_f.z * -sy + rz * sx), ml = Math.hypot(mx, mz) || 1;
        const bx = d.pos.x, bz = d.pos.z;
        b.walk(d, mx / ml * speed * dt, mz / ml * speed * dt);
        this.rig.position.x += d.pos.x - bx; this.rig.position.z += d.pos.z - bz;
        moving = 1;
      }
    } else if (canAct) {
      // teleport hop: push forward to aim an arc from the off hand, release to hop
      if (!this.tp.active && sy < -0.6) this.tp.active = true;
      if (this.tp.active) {
        this.aimTeleport(d, b);
        if (Math.hypot(sx, sy) < 0.3) {
          this.tp.active = false; this.tpArc.hide(); this.tpRing.visible = false;
          if (this.tp.ok) {
            const x = this.tp.x, z = this.tp.z;
            this.fadeThen(() => {
              const bx = d.pos.x, bz = d.pos.z;
              if (b.hop(d, x, z)) { this.rig.position.x += d.pos.x - bx; this.rig.position.z += d.pos.z - bz; ctx.audio?.play('swoosh'); }
            }, 9);
            this.fadeSpeed = 9;
          } else ctx.audio?.play('deny');
        }
      }
    } else { this.tp.active = false; this.tpArc.hide(); this.tpRing.visible = false; }
    // keep the tracking floor at duck feet height
    const targetY = d.pos.y + this.heightOffset;
    this.rig.position.y = d.state === 'air' && d.jumping ? targetY : damp(this.rig.position.y, targetY, 18, dt);
    if (d.jumping) moving = 1;
    return moving;
  }

  aimTeleport(d, b) {
    const c = this.input.off.controller;
    if (!c) return;
    c.getWorldPosition(_o);
    _dv.set(0, 0, -1).transformDirection(c.matrixWorld);
    const T = b.terrain, pts = [];
    let x = _o.x, y = _o.y, z = _o.z, vx = _dv.x * 11, vy = _dv.y * 11, vz = _dv.z * 11;
    let hit = null;
    pts.push(x, y, z);
    for (let i = 0; i < 46; i++) {
      const dt = 0.045;
      const nx = x + vx * dt, ny = y + vy * dt, nz = z + vz * dt;
      vy -= 9.8 * dt;
      const g = Math.max(T.heightAt(nx, nz), WATER);
      if (ny <= g) { hit = { x: nx, z: nz, y: g }; pts.push(nx, g, nz); break; }
      x = nx; y = ny; z = nz;
      pts.push(x, y, z);
    }
    this.tpArc.set(pts, pts.length / 3, _h);
    if (hit) {
      const chk = b.checkHop(d, hit.x, hit.z);
      this.tp.ok = chk.ok; this.tp.x = hit.x; this.tp.z = hit.z; this.tp.reason = chk.reason;
      const col = chk.ok ? '#7bc96f' : '#e2553a';
      this.tpArc.setColor(col); this.tpRing.material.color.set(col);
      this.tpRing.position.set(hit.x, Math.max(chk.y, WATER) + 0.06, hit.z);
      this.tpRing.visible = true;
    } else { this.tp.ok = false; this.tpRing.visible = false; this.tpArc.setColor('#e2553a'); }
  }

  updateDesktopMove(dt, d, b, canAct) {
    const inp = this.input;
    let moving = 0;
    if (canAct) {
      let fx = 0, fz = 0;
      if (inp.key('KeyW')) fz += 1;
      if (inp.key('KeyS')) fz -= 1;
      if (inp.key('KeyA')) fx -= 1;
      if (inp.key('KeyD')) fx += 1;
      if (fx || fz) {
        const l = Math.hypot(fx, fz);
        const speed = (d.state === 'swim' ? 1.6 : 3.2) * (d.perks?.speedMul || 1) * dt;
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        // forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw)
        const mx = (sy * fz - cy * fx) / l * speed, mz = (cy * fz + sy * fx) / l * speed;
        b.walk(d, mx, mz);
        moving = 1;
      }
    }
    // camera follows duck
    const bob = d.state === 'walk' ? Math.abs(Math.sin(d.anim.step)) * 0.035 : 0;
    this.rig.position.set(d.pos.x, d.pos.y, d.pos.z);
    this.rig.rotation.set(0, this.yaw - Math.PI, 0);
    if (this.screenBody()) {
      // fixed eye for aiming; past about 30 degrees down your head tips forward so you can see your body and feet
      let k = clamp((-this.pitch - 0.5) / 0.75, 0, 1); k = k * k * (3 - 2 * k);
      this.camera.position.set(0, lerp(EYE_STAND.y, EYE_PEER.y, k) + bob, lerp(EYE_STAND.z, EYE_PEER.z, k));
    } else this.camera.position.set(0, DUCK_EYE + bob, 0);
    this.camera.rotation.set(this.pitch, 0, 0, 'YXZ');
    this.rig.updateMatrixWorld(true);
    return moving;
  }

  // ------------------------------------------------------------------ weapons
  updateWeapon(dt, d, b) {
    const inp = this.input, def = WEAPONS[d.weapon];
    const xr = ctx.isXR;
    const uiCapture = xr ? this.ui.capture[inp.main.name] : this.ui.capture.mouse;
    // weapon cycling
    if (!this.charging && !this.pointing) {
      if (xr) {
        const y = inp.main.axes.y;
        if (this.flickReady && Math.abs(y) > 0.7) { b.cycleWeapon(y < 0 ? 1 : -1); this.flickReady = false; inp.main.pulse(0.25, 25); ctx.audio?.play('ui'); }
        if (Math.abs(y) < 0.3) this.flickReady = true;
      } else {
        if (inp.keyPressed('KeyE') || inp.mouse.wheel > 0) { b.cycleWeapon(1); ctx.audio?.play('ui'); }
        if (inp.keyPressed('KeyQ') || inp.mouse.wheel < 0) { b.cycleWeapon(-1); ctx.audio?.play('ui'); }
        for (let k = 1; k <= 9; k++) if (inp.keyPressed('Digit' + k)) { const list = Object.keys(d.ammo).filter(w => d.ammo[w] > 0); }
      }
    }
    const kbFire = !xr && (inp.key('KeyF'));
    const down = xr ? inp.main.pressed('trigger') && !uiCapture : (inp.mousePressed(0) && inp.aiming && !uiCapture) || inp.keyPressed('KeyF');
    const held = xr ? inp.main.held('trigger') : inp.mouse.buttons[0] || kbFire;
    const up = xr ? inp.main.released('trigger') : (inp.mouseReleased(0) && !kbFire) || (!inp.mouse.buttons[0] && !kbFire);
    this.aimPose(_o, _dv);
    // slapping by swinging your wing (VR)
    if (xr && d.weapon === 'slap' && inp.main.vel.length() > 3.2 && !this.charging) {
      const v = inp.main.vel;
      b.fire({ weapon: 'slap', origin: _o, dir: _dv.set(v.x, 0, v.z).normalize() });
      return;
    }
    if (def.fire === 'tap') {
      this.showGuide(d, b, def, 0.75);
      if (down) {
        const spec = { weapon: d.weapon, origin: _o.clone(), dir: _dv.clone() };
        if (def.kind === 'heal') spec.targetDuck = this.pickFriend(d, b);
        if (def.kind === 'mine') spec.target = this.groundPoint(b, 4);
        if (b.fire(spec)) inp.main.pulse(0.6, 60);
      }
    } else if (def.fire === 'charge') {
      if (down) { this.charging = true; this.chargeT = 0; this.power = 0; this.chargeSound = ctx.audio?.loop('charge', null); }
      if (this.charging) {
        this.chargeT += dt;
        this.power = clamp(this.chargeT / 1.6, 0, 1);
        this.chargeSound?.set(this.power);
        if (Math.floor(this.chargeT * 10) !== Math.floor((this.chargeT - dt) * 10)) inp.main.pulse(0.1 + this.power * 0.35, 18);
        this.showGuide(d, b, def, this.power);
        if (up || !held) {
          this.chargeSound?.stop(); this.chargeSound = null;
          this.charging = false;
          if (this.chargeT < 0.12) { ctx.audio?.play('deny'); this.hideAim(); return; }
          const spec = { weapon: d.weapon, origin: _o.clone(), dir: _dv.clone(), power: this.power };
          if (xr && def.throwable) {
            const v = inp.main.vel;
            if (v.length() > 2.2) spec.velocity = v.clone().multiplyScalar(2.6);
          }
          if (b.fire(spec)) inp.main.pulse(0.9, 90);
        }
      } else this.showGuide(d, b, def, -1);
    } else if (def.fire === 'point') {
      if (down) this.pointing = true;
      if (this.pointing) {
        const tgt = this.pointTarget(b, d, def);
        if (up || !held) {
          this.pointing = false;
          this.laser.hide(); this.target.visible = false;
          if ((def.kind === 'airstrike' || def.kind === 'jetpack' || def.kind === 'paradrop') && !tgt) { ctx.audio?.play('deny'); return; }
          const spec = { weapon: d.weapon, origin: _o.clone(), dir: _dv.clone(), target: tgt ? tgt.clone() : null };
          if (b.fire(spec)) inp.main.pulse(0.8, 80);
        }
      } else { this.laser.hide(); this.target.visible = false; this.arc.hide(); }
    }
    // weapon label by the hand
    const ammo = d.ammo[d.weapon];
    const how = def.fire === 'charge' ? 'Hold to charge' : def.fire === 'point' ? 'Hold to aim' : 'Press to use';
    ctx.hud.handLabel.set(def.name, ammo === Infinity ? '∞' : `×${ammo}`, this.charging ? this.power : -1, this.endHold, def.free ? `${how} · free action` : how);
  }

  showGuide(d, b, def, power) {
    const mode = ctx.settings.aimGuide;
    if (mode === 'off' || !def.speed || power < 0 && !(def.kind === 'bullet')) { this.arc.hide(); this.target.visible = false; return; }
    const p = def.kind === 'bullet' ? 1 : power;
    const speed = lerp(def.speed[0], def.speed[1], clamp(p, 0, 1));
    _vel.copy(_dv).multiplyScalar(speed);
    const secs = mode === 'full' ? 6 : def.kind === 'bullet' ? 0.25 : 0.8;
    const n = b.predict(d.weapon, _o, _vel, this.arcPts, 60, secs);
    this.arc.set(this.arcPts, n, _h.setFromMatrixPosition(this.camera.matrixWorld));
    if (mode === 'full' && b.predictHit) { this.target.position.set(b.predictHit.x, b.predictHit.y + 0.05, b.predictHit.z); this.target.visible = true; }
    else this.target.visible = false;
  }

  pointTarget(b, d, def) {
    const dist = b.terrain.raycast(_o.x, _o.y, _o.z, _dv.x, _dv.y, _dv.z, def.kind === 'jetpack' ? 120 : def.range || 300);
    const len = dist > 0 ? dist : 80;
    this.camera.getWorldPosition(_h);
    this.laser.set([_o.x, _o.y, _o.z, _o.x + _dv.x * len, _o.y + _dv.y * len, _o.z + _dv.z * len], 2, _h);
    this.arc.hide();
    if (dist > 0) {
      _t.set(_o.x + _dv.x * dist, _o.y + _dv.y * dist, _o.z + _dv.z * dist);
      this.target.position.set(_t.x, _t.y + 0.06, _t.z);
      this.target.scale.setScalar(def.kind === 'airstrike' ? 3 : def.kind === 'homing' || def.kind === 'paradrop' ? 1.6 : def.kind === 'jetpack' ? 1 : 0.6);
      this.target.visible = def.kind !== 'hitscan';
      return _t;
    }
    this.target.visible = false;
    if (def.kind === 'homing') return _t.set(_o.x + _dv.x * 60, _o.y + _dv.y * 60, _o.z + _dv.z * 60);
    return null;
  }

  pickFriend(d, b) {
    let best = null, bestA = 0.92;
    for (const o of d.team.ducks) {
      if (!o.alive || o === d) continue;
      _t.set(o.pos.x - _o.x, o.pos.y + 1.0 - _o.y, o.pos.z - _o.z);
      const l = _t.length();
      if (l > 4) continue;
      const cos = _t.dot(_dv) / l;
      if (cos > bestA) { bestA = cos; best = o; }
    }
    return best;
  }
  groundPoint(b, maxD) {
    const dist = b.terrain.raycast(_o.x, _o.y, _o.z, _dv.x, _dv.y, _dv.z, maxD);
    return dist > 0 ? new THREE.Vector3(_o.x + _dv.x * dist, 0, _o.z + _dv.z * dist) : null;
  }

  cancelAim(sound = false) {
    if (this.chargeSound) { this.chargeSound.stop(); this.chargeSound = null; }
    this.charging = false; this.pointing = false;
    this.hideAim();
    this.refreshHandWeapon();
  }
  hideAim() {
    this.arc.hide(); this.laser.hide(); this.target.visible = false;
    if (!this.tp.active) { this.tpArc.hide(); this.tpRing.visible = false; }
  }

  // ------------------------------------------------------------------ menu placement
  placeMenu() {
    const s = this.menuSpot;
    if (!s) return;
    this.placeAt(s.x, s.y, s.z, s.yaw);
  }

  // ------------------------------------------------------------------ tutorial (mission 1)
  startTutorial() { this.tut = { step: 0, t: 0, start: null, shots: 0 }; }
  updateTutorial(dt, b, d) {
    const T = this.tut, xr = ctx.isXR;
    T.t += dt;
    const hint = (vr, desk) => ctx.hud.hint.show(xr ? vr : desk);
    if (!T.start) T.start = d.pos.clone();
    switch (T.step) {
      case 0:
        hint('Raise your left hand to see your map. Red crosses are the straw dummies, squares are supply crates.',
          'Your map is at the bottom left. Red crosses are the straw dummies, squares are supply crates. Click the game to look around.');
        if (T.t > 7) { T.step = 1; T.t = 0; }
        break;
      case 1:
        hint(ctx.settings.locomotion === 'smooth' ? 'Move with the left stick. Go wherever you like until the clock on your wrist map runs out.' : 'Push the left stick forward to aim a hop, then let go to jump there. Go wherever you like until the clock on your wrist map runs out.',
          'Walk with W A S D. Go wherever you like until the clock on your map runs out.');
        if (b.moved > 2 || T.t > 14) { T.step = 2; T.t = 0; }
        break;
      case 2:
        hint('Point your right hand at a dummy. Hold the trigger to charge, then let go to fire the bazooka.',
          'Aim with the mouse. Hold the left button to charge, then let go to fire the bazooka.');
        if (b.fired) { T.step = 3; T.t = 0; }
        break;
      case 3:
        hint('One duck moves and fires each turn. Next time, try a grenade: flick the right stick up or down to change weapon.',
          'One duck moves and fires each turn. Next time, try a grenade: press E or Q to change weapon.');
        if (T.t > 9 && b.phase === 'act' && b.isHumanTurn()) { T.step = 4; T.t = 0; }
        break;
      case 4:
        hint('Press X to switch to another duck before you move. Hold B to end a turn early.',
          'Press Tab to switch duck before you move. Hold Enter to end a turn early.');
        if (T.t > 10) { T.step = 5; ctx.hud.hint.hide(); }
        break;
    }
  }
}
const _cq = new THREE.Quaternion(), _cpa = new THREE.Vector3(), _cpd = new THREE.Vector3(), _cpt = new THREE.Vector3();
const _f = new THREE.Vector3(), _h = new THREE.Vector3(), _o = new THREE.Vector3(), _dv = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3(), _vel = new THREE.Vector3();
