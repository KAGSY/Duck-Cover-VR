// Boot, scene flow (menu ↔ battle), WebXR session handling and the frame loop.
import * as THREE from 'three';
import { ctx, on, emit, clamp, runTimers, clearTimers, after } from './ctx.js';
import { detectDevice, resolveTier, TIERS } from './quality.js';
import { loadSave, writeSave } from './settings.js';
import { loadFonts, makeDetailTexture, makeNoiseTexture, makeCloudTexture, makeParticleAtlas } from './textures.js';
import { World } from './world.js';
import { Battle } from './battle.js';
import { AIController } from './ai.js';
import { FX } from './fx.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { UI, Panel, Follower } from './ui.js';
import { WristHUD, Banner, Toasts, Hint, HandLabel } from './hud.js';
import { Player, DUCK_EYE } from './player.js';
import { makeScreens } from './menus.js';
import { MISSIONS, FACTIONS, factionLook, campaignBattle, skirmishBattle, applyResults, deployedRoster, battleInfo, newCampaign, makeDuckInfo, ensureCampaign } from './campaign.js';
import { campaignMap } from './campaignmap.js';
import * as CLASSES from './classes.js';
import * as CAMPAIGN from './campaign.js';
import { Duck, resetDuckMaterial } from './duck.js';
import { HALF } from './terrain.js';
import { Mirror, mirrorFrame, MIRROR_LAYER } from './mirror.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ setup
ctx.save = loadSave();
ensureCampaign(ctx.save.campaign);
ctx.settings = ctx.save.settings;
const detected = detectDevice();
ctx.detected = detected;
ctx.deviceLabel = detected.device;
ctx.quality = resolveTier(ctx.settings.quality, detected);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ctx.quality.maxDpr));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.xr.enabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = 'game';
$('stage').appendChild(renderer.domElement);
ctx.renderer = renderer;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, ctx.quality.farClip);
const rig = new THREE.Group();
rig.name = 'rig';
rig.add(camera);
scene.add(rig);
ctx.scene = scene; ctx.camera = camera; ctx.rig = rig;
camera.position.set(0, DUCK_EYE, 0);

const tex = {
  detail: makeDetailTexture(ctx.quality.id === 'low' ? 256 : 512),
  noise: makeNoiseTexture(256),
  cloud: makeCloudTexture(256),
  atlas: makeParticleAtlas(),
};
const audio = new AudioEngine();
ctx.audio = audio;
const fx = new FX(scene, tex.atlas, ctx.quality);
ctx.fx = fx;
const input = new Input(renderer, rig);
ctx.input = input;
const ui = new UI(scene, camera, input);
ctx.ui = ui;
const hud = {
  wrist: new WristHUD(), banner: new Banner(), toasts: new Toasts(), hint: new Hint(), handLabel: new HandLabel(),
};
ctx.hud = hud;
for (const k in hud) { ui.add(hud[k].panel); }
const player = new Player({ scene, camera, rig, input, ui, hud });
ctx.player = player;
const menuPanel = new Panel({ w: 1024, h: 720, meters: 1.3, name: 'menu', order: 80, depthTest: false });
ui.add(menuPanel);
scene.add(menuPanel.mesh);
menuPanel.mesh.visible = false;
const menuFollow = new Follower(menuPanel.mesh, { dist: 1.3, height: -0.1, lag: 0, deadzone: 0.9, recentre: true });
// a field mirror beside the menu board (VR, full body): watch your duck copy you
const mirror = new Mirror(0.62, 1.25, {
  resolution: ctx.quality.id === 'low' ? 384 : 512,
  hooks: { before: () => player.menuBody?.mirrorHead(true), after: () => player.menuBody?.mirrorHead(false) },
});
mirror.position.set(-1.06, -0.1, 0.14); mirror.rotation.y = 0.72;
mirror.add(mirrorFrame(0.62, 1.25));
mirror.visible = false;
menuPanel.mesh.add(mirror);
let mirrorTurf = null;

let world = null, battle = null, menuDucks = [], lastConfig = null, paused = false, handoffCb = null, saluteT = 6;
let state = 'landing';
ctx.state = state;
const setState = (s) => { state = s; ctx.state = s; };

// ------------------------------------------------------------------ app actions (used by menus)
const app = {
  show(name, st = {}) {
    menuPanel.setScreen(screens[name], st);
    menuPanel.mesh.visible = true;
    placeMenuPanel();
    ui.menuMode = true;
  },
  hideMenu() { menuPanel.mesh.visible = false; ui.menuMode = false; },
  confirm(text, yes, back = 'main') { app.show('confirm', { text, yes, back }); },
  startMission(m) { const cfg = campaignBattle(m, ctx.save.campaign, ctx.settings); cfg.missionRef = m; startBattle(cfg); },
  startSkirmish(opts) { startBattle(skirmishBattle(opts)); },
  restartBattle() {
    if (!lastConfig) return;
    const cfg = lastConfig.missionRef ? campaignBattle(lastConfig.missionRef, ctx.save.campaign, ctx.settings) : lastConfig;
    if (lastConfig.missionRef) cfg.missionRef = lastConfig.missionRef;
    startBattle(cfg);
  },
  quitBattle() { goToMenu(); },
  resume() {
    paused = false; player.paused = false; app.hideMenu();
    if (!ctx.isXR && state === 'battle') input.lockPointer();
  },
  pause() {
    if (state !== 'battle' || paused || battle?.phase === 'over') return;
    paused = true; player.paused = true; player.cancelAim();
    app.show('pause');
  },
  // leave the results screen for the barracks or the campaign map
  afterResults(screen = 'campaign', st = {}) {
    if (state === 'battle') goToMenu(screen, { from: 'results', ...st });
    else app.show(screen, { from: 'results', ...st });
  },
  // promotions change how the squad at the camp looks
  refreshSquad() { if (state === 'menu') spawnMenuSquad(); },
  handoff(team, cb) {
    paused = true; player.paused = true; handoffCb = cb;
    player.fadeOut(5);
    app.show('handoff', { team: team.name, color: team.tagColor });
    if (!ctx.isXR) input.unlockPointer();
  },
  handoffReady() {
    const cb = handoffCb; handoffCb = null;
    app.resume();
    cb?.();
    player.fadeIn(3);
  },
  exitVR() { renderer.xr.getSession()?.end(); },
  recenter() { player.calibrate(); },
  settingChanged(key) {
    if (['master', 'music', 'sfx'].includes(key)) audio.applyVolumes();
    if (key === 'hand') { player.attachHands(); player.refreshHandWeapon(); }
    if (key === 'heightMode') player.calibrate();
    if (key === 'vrBody') player.applyBodyMode();
  },
};
ctx.app = app;
const screens = makeScreens(app);

// ------------------------------------------------------------------ worlds
function disposeWorld() {
  clearTimers();
  if (battle) { battle.dispose(); battle = null; ctx.battle = null; }
  for (const d of menuDucks) scene.remove(d.mesh);
  menuDucks = [];
  if (player.menuBody) { scene.remove(player.menuBody.mesh); player.menuBody = null; }
  if (mirrorTurf) { mirrorTurf.parent?.remove(mirrorTurf); mirrorTurf.geometry.dispose(); mirrorTurf.material.dispose(); mirrorTurf = null; }
  if (world) { world.dispose(scene); world = null; ctx.world = null; }
  fx.clear(); fx.setSnow(false);
  audio.stopLoops();
  hud.toasts.clear(); hud.hint.hide(); hud.banner.panel.mesh.visible = false;
}

function buildMenuWorld() {
  const spec = {
    seed: 4242, biome: 'marsh', look: 'morning', flagColors: FACTIONS.mallard.flag,
    layout: {
      teams: [{ x: -18, z: 20, r: 3, count: 1 }],
      structures: [
        { type: 'tent', rel: 0, x: -7, z: -9, rot: 0.3 }, { type: 'sandbags', rel: 0, x: 8, z: -11, rot: -0.5 },
        { type: 'hut', rel: 0, x: -12, z: 2, rot: 1.2 }, { type: 'barrels', rel: 0, x: 9, z: -14 },
      ],
      zone: { x: -14, z: 6, r: 0.01 },
    },
  };
  world = new World(spec, tex);
  world.attach(scene);
  ctx.world = world;
  if (world.zoneRing) world.zoneRing.visible = false;
  fx.terrain = world.terrain;
  const spot = world.spawns[0][0];
  const T = world.terrain;
  const yaw = Math.PI; // look toward -Z
  player.menuSpot = { x: spot.x, y: T.heightAt(spot.x, spot.z), z: spot.z, yaw };
  const look = factionLook(FACTIONS.mallard);
  // your own body, for VR full-body mode (hidden on a flat screen)
  const me = new Duck({ info: { name: 'You', maxHp: 100 }, team: { tagColor: FACTIONS.mallard.tagColor }, look: { ...look, rank: 4 }, quality: ctx.quality });
  me.pos.set(spot.x, T.heightAt(spot.x, spot.z), spot.z); me.yaw = yaw;
  scene.add(me.mesh);
  me.setFirstPerson(true, player.fullBody());
  player.menuBody = me;
  // what the mirror reflects: you, your squad, sky, light and a patch of grass
  me.mesh.layers.enable(MIRROR_LAYER);
  for (const o of [world.sky, world.hills, world.lights.hemi, world.lights.sun]) o?.layers.enable(MIRROR_LAYER);
  mirrorTurf = new THREE.Mesh(new THREE.CircleGeometry(8, 40), new THREE.MeshLambertMaterial({ color: '#5b7a37' }));
  mirrorTurf.rotation.x = -Math.PI / 2;
  mirrorTurf.position.set(spot.x, T.heightAt(spot.x, spot.z) + 0.01, spot.z);
  mirrorTurf.layers.set(MIRROR_LAYER);
  scene.add(mirrorTurf);
  spawnMenuSquad();
}

// The squad lines up beside the menu board, dressed for their current ranks and careers.
function spawnMenuSquad() {
  for (const d of menuDucks) scene.remove(d.mesh);
  menuDucks = [];
  const spot = player.menuSpot, T = world?.terrain;
  if (!spot || !T) return;
  const camp = ctx.save.campaign || newCampaign(), look = factionLook(FACTIONS.mallard), yaw = spot.yaw;
  camp.roster.slice(0, 6).forEach((info, i) => {
    const bi = battleInfo(info);
    const d = new Duck({ info: bi, team: { tagColor: FACTIONS.mallard.tagColor }, look: { ...look, rank: info.rank, spec: info.spec }, quality: ctx.quality });
    const a = -0.95 - i * 0.2, r = 5.2 + (i % 2) * 0.6;
    const x = spot.x + Math.sin(yaw + a) * r, z = spot.z + Math.cos(yaw + a) * r;
    d.pos.set(x, T.heightAt(x, z), z);
    d.yaw = Math.atan2(spot.x - x, spot.z - z);
    scene.add(d.mesh);
    d.mesh.layers.enable(MIRROR_LAYER);
    menuDucks.push(d);
    after(0.8 + i * 0.3, () => d.salute(2.0));
  });
}

function goToMenu(screen = 'main', st = {}) {
  player.fadeThen(() => {
    disposeWorld();
    player.inBattle = false; player.tut = null; player.duck = null;
    paused = false; player.paused = false;
    resetDuckMaterial();
    buildMenuWorld();
    player.placeMenu();
    player.setupHands(null);
    layoutHUD();
    setState('menu');
    app.show(screen, st);
    audio.stopAmbience();
    audio.ambience('marsh', 'morning');
    audio.startMusic();
    if (!ctx.isXR) input.unlockPointer();
  });
}

function startBattle(cfg) {
  lastConfig = cfg;
  app.show('loading', { title: cfg.mission.mode === 'campaign' ? cfg.mission.name : 'Skirmish', sub: cfg.mission.mode === 'campaign' ? cfg.mission.place : 'Random battlefield' });
  player.fadeThen(() => {
    disposeWorld();
    ctx.quality = resolveTier(ctx.settings.quality, detected);
    resetDuckMaterial();
    camera.far = ctx.quality.farClip; camera.updateProjectionMatrix();
    world = new World(cfg.world, tex);
    world.attach(scene);
    ctx.world = world;
    fx.terrain = world.terrain;
    // spawn points and facing
    cfg.teams.forEach((t, i) => {
      const pts = world.spawns[i] || world.spawns[0];
      const other = world.zones[(i + 1) % world.zones.length] || { x: 0, z: 0 };
      t.spawns = pts.map(p => ({ x: p.x, z: p.z, yaw: Math.atan2(other.x - p.x, other.z - p.z) }));
    });
    battle = new Battle({ world, mission: cfg.mission, teams: cfg.teams, settings: ctx.settings });
    battle.makeAI = (b, team) => new AIController(b, team);
    ctx.battle = battle;
    player.inBattle = true; player.tut = null;
    const pteam = battle.playerTeam();
    player.setupHands(pteam);
    player.inhabit(pteam.ducks[0], { fade: false });
    if (cfg.mission.tutorial) player.startTutorial();
    layoutHUD();
    setState('battle');
    paused = false; player.paused = false;
    app.hideMenu();
    audio.stopMusic();
    audio.ambience(cfg.world.biome, cfg.world.look);
    fx.setSnow(cfg.world.look === 'blizzard' || (cfg.world.biome === 'snow' && cfg.world.look === 'overcast'), () => camera.getWorldPosition(_cp));
    battle.start();
    hud.banner.show(cfg.mission.mode === 'campaign' ? cfg.mission.name.toUpperCase() : 'SKIRMISH', cfg.mission.objective?.text || '', '#f2c230', 3.2);
    if (!ctx.isXR) input.lockPointer();
    player.fadeIn(1.5);
  }, 4);
}

on('battleOver', ({ result, battle: b }) => {
  player.tut = null; hud.hint.hide();
  setTimeout(() => {
    if (b !== battle) return;
    let summary;
    if (b.mission.mode === 'campaign' && lastConfig.missionRef) summary = applyResults(ctx.save.campaign, lastConfig.missionRef, b);
    else summary = { won: result.outcome === 'victory', reason: result.reason, rows: b.playerTeam().ducks.map(d => ({ name: d.name, damage: d.stats.damage, kills: d.stats.kills, alive: d.alive })) };
    player.cancelAim();
    if (!ctx.isXR) input.unlockPointer();
    app.show('results', { summary, mode: b.mission.mode, missionName: b.mission.mode === 'campaign' ? `Mission ${b.mission.id} · ${b.mission.name}` : 'Skirmish' });
  }, 3500);
});

// ------------------------------------------------------------------ HUD layout (XR vs screen)
function layoutHUD() {
  const panels = [hud.wrist.panel.mesh, hud.banner.panel.mesh, hud.toasts.panel.mesh, hud.hint.panel.mesh, hud.handLabel.panel.mesh];
  for (const m of panels) { m.parent?.remove(m); }
  if (ctx.isXR) { for (const m of panels) scene.add(m); }
  else { for (const m of panels) camera.add(m); }
  for (const m of panels) { m.material.depthTest = false; m.renderOrder = Math.max(m.renderOrder, 85); }
  hud.wrist.panel.mesh.visible = state === 'battle' || ctx.state === 'battle';
  player.followBanner.snap(); player.followToast.snap(); player.followHint.snap();
}

function placeMenuPanel() {
  const m = menuPanel.mesh;
  m.parent?.remove(m);
  if (ctx.isXR) {
    scene.add(m);
    m.scale.setScalar(1);
    menuFollow.snap();
    menuFollow.update(1, camera);
  } else {
    camera.add(m);
    const vfov = camera.fov * Math.PI / 180, halfH = Math.tan(vfov / 2), halfW = halfH * camera.aspect;
    const dist = 1;
    const maxW = Math.min(halfW * 2 * 0.94, halfH * 2 * 0.94 * (1024 / 720));
    m.scale.setScalar(maxW / 1.3);
    m.position.set(0, 0, -dist);
    m.rotation.set(0, 0, 0);
  }
}

function updateHUD(dt) {
  const b = battle;
  hud.banner.update(dt); hud.toasts.update(dt);
  const inBattle = state === 'battle' && b;
  hud.wrist.panel.mesh.visible = !!inBattle && !(paused && ctx.isXR && !player.bigMap) && (b.phase !== 'over');
  const showLabel = inBattle && b.isHumanTurn() && b.phase === 'act' && player.duck === b.active && !paused;
  hud.handLabel.panel.mesh.visible = !!showLabel;
  if (ctx.isXR) {
    // wrist map floats above the off hand and faces you; grip held = big map in front
    const offC = input.off.controller;
    const wm = hud.wrist.panel.mesh;
    if (player.bigMap) { player.followMap.update(dt, camera); wm.scale.setScalar(2.6); }
    else if (offC && input.off.connected) {
      offC.getWorldPosition(_v1); camera.getWorldPosition(_cp);
      _v2.subVectors(_cp, _v1).normalize();
      wm.position.copy(_v1).addScaledVector(_v2, 0.04); wm.position.y += 0.11;
      wm.lookAt(_cp); wm.scale.setScalar(1);
      player.followMap.snap();
    } else { player.followMap.update(dt, camera); wm.scale.setScalar(2.2); }
    const mainC = input.main.controller;
    if (showLabel && mainC) {
      mainC.getWorldPosition(_v1); camera.getWorldPosition(_cp);
      hud.handLabel.panel.mesh.position.copy(_v1); hud.handLabel.panel.mesh.position.y += 0.12;
      hud.handLabel.panel.mesh.lookAt(_cp);
    }
    player.followBanner.update(dt, camera);
    player.followToast.update(dt, camera);
    player.followHint.update(dt, camera);
  } else {
    const vfov = camera.fov * Math.PI / 180, halfH = Math.tan(vfov / 2), halfW = halfH * camera.aspect;
    const z = -1;
    const wm = hud.wrist.panel.mesh;
    if (player.bigMap) { const s = Math.min(halfH * 1.6, halfW * 1.6) / 0.2; wm.scale.setScalar(s); wm.position.set(0, 0, z); }
    else {
      const size = clamp(Math.min(halfH * 0.62, halfW * 0.5), 0.2, 0.6);
      wm.scale.setScalar(size / 0.2);
      wm.position.set(-halfW + size / 2 + 0.03, -halfH + size / 2 + 0.03, z);
    }
    wm.rotation.set(0, 0, 0);
    const bw = Math.min(halfW * 1.3, 1.1);
    hud.banner.panel.mesh.scale.setScalar(bw / 1.1); hud.banner.panel.mesh.position.set(0, halfH * 0.66, z);
    hud.toasts.panel.mesh.scale.setScalar(Math.min(halfW * 1.2, 0.9) / 0.9); hud.toasts.panel.mesh.position.set(0, halfH * 0.34, z);
    hud.hint.panel.mesh.scale.setScalar(Math.min(halfW * 1.2, 0.85) / 0.85); hud.hint.panel.mesh.position.set(0, -halfH * 0.72, z);
    const lw = clamp(halfW * 0.5, 0.16, 0.42);
    hud.handLabel.panel.mesh.scale.setScalar(lw / 0.16); hud.handLabel.panel.mesh.position.set(halfW - lw / 2 - 0.03, -halfH + lw * 0.15 + 0.06, z);
    for (const m of [wm, hud.banner.panel.mesh, hud.toasts.panel.mesh, hud.hint.panel.mesh, hud.handLabel.panel.mesh]) m.rotation.set(0, 0, 0);
  }
}

// ------------------------------------------------------------------ XR session
async function enterVR() {
  audio.init(ctx.quality.hrtf);
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFramebufferScaleFactor(ctx.quality.fbScale);
    await renderer.xr.setSession(session);
  } catch (e) {
    console.warn(e);
    showLandingError('Could not start VR here. Open this page in the Meta Quest Browser from a secure (https) address, then press Enter VR.');
  }
}
renderer.xr.addEventListener('sessionstart', () => {
  ctx.isXR = true;
  try { renderer.xr.setFoveation(ctx.quality.foveation); } catch (e) {}
  $('landing').hidden = true;
  player.attachHands();
  player.applyBodyMode();
  layoutHUD();
  player.calibrate();
  if (state === 'landing') { goToMenuFromLanding(); }
  else if (state === 'menu') { player.placeMenu(); placeMenuPanel(); }
  else if (state === 'battle' && player.duck) player.placeAt(player.duck.pos.x, player.duck.pos.y, player.duck.pos.z, player.duck.yaw);
  if (menuPanel.mesh.visible) placeMenuPanel();
});
renderer.xr.addEventListener('sessionend', () => {
  ctx.isXR = false;
  camera.position.set(0, DUCK_EYE, 0); camera.quaternion.identity();
  rig.rotation.set(0, 0, 0);
  player.attachHands();
  player.applyBodyMode();
  layoutHUD();
  if (state === 'menu') { player.placeMenu(); placeMenuPanel(); }
  else if (state === 'battle') { if (!paused) app.pause(); }
  if (menuPanel.mesh.visible) placeMenuPanel();
  showLanding(true);
});
input.onConnect = () => { if (ctx.isXR) player.attachHands(); };
input.onUnlock = () => { if (state === 'battle' && !paused && battle?.phase !== 'over' && !handoffCb) app.pause(); };
input.onLockFailed = () => { hud.toasts.push('Click the game to capture the mouse. If it won’t capture, drag with any mouse button or use the arrow keys to look', 'info'); };

// ------------------------------------------------------------------ landing page
function showLanding(again = false) {
  $('landing').hidden = false;
  $('play').textContent = again ? 'Keep playing on this screen' : 'Play on this screen';
}
function showLandingError(msg) { const e = $('vr-note'); e.textContent = msg; e.dataset.state = 'error'; }
function goToMenuFromLanding() {
  if (state !== 'landing') return;
  setState('menu');
  app.show('main');
  audio.startMusic();
}
async function setupLanding() {
  $('device').textContent = `${detected.device} · ${ctx.quality.label}`;
  let vrOk = false;
  try { vrOk = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch (e) { vrOk = false; }
  const vr = $('enter-vr');
  if (vrOk) { vr.disabled = false; $('vr-note').textContent = 'Put on your headset, then press Enter VR.'; }
  else {
    vr.disabled = true;
    $('vr-note').textContent = window.isSecureContext
      ? 'VR isn’t available in this browser or view. On your Quest, open this game’s web address in the Meta Quest Browser.'
      : 'VR needs a secure (https) address. Host this file on an https site and open it in the Meta Quest Browser.';
  }
  vr.addEventListener('click', () => enterVR());
  $('play').addEventListener('click', () => {
    audio.init(ctx.quality.hrtf);
    $('landing').hidden = true;
    if (state === 'landing') goToMenuFromLanding();
    else if (state === 'battle' && paused) { /* stay on pause menu */ }
  });
}

// ------------------------------------------------------------------ resize
function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (menuPanel.mesh.visible) placeMenuPanel();
}
window.addEventListener('resize', onResize);

// ------------------------------------------------------------------ frame loop
const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0;
ctx.fps = 0;
const fpsEl = $('fps');
function frame(dtOverride, noRender = false) {
  const rawDt = typeof dtOverride === 'number' ? dtOverride : clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  ctx.dt = dt; ctx.time += dt; ctx.frame++;
  fpsAcc += rawDt; fpsFrames++;
  if (fpsAcc > 0.5) { ctx.fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; if (fpsEl) { fpsEl.hidden = !ctx.settings.showFps || ctx.isXR; fpsEl.textContent = `${ctx.fps} fps · ${renderer.info.render.calls} draws`; } }
  runTimers();
  input.update(dt);
  // global buttons
  if (state === 'battle') {
    const pausePressed = ctx.isXR ? input.off.pressed('b') : input.keyPressed('Escape') || input.keyPressed('KeyP');
    if (pausePressed && !handoffCb) { if (paused) app.resume(); else app.pause(); }
    if (!ctx.isXR && !input.mouse.locked && !paused && input.mousePressed(0) && !ui.capture.mouse) input.lockPointer();
  } else if (state === 'menu' && ctx.isXR && input.off.pressed('b') && menuPanel.screen !== screens.main) app.show('main');
  ui.update(dt);
  player.update(dt);
  if (battle && !paused) battle.update(dt);
  if (state === 'menu') {
    for (const d of menuDucks) d.animate(dt);
    if (!ctx.isXR) player.placeMenu();
    saluteT -= dt;
    if (saluteT <= 0 && menuDucks.length) { saluteT = 5 + Math.random() * 5; menuDucks[Math.floor(Math.random() * menuDucks.length)].salute(2.0); }
    // draw the campaign map a slice at a time while the menus are up, so opening it never stalls a frame
    if (!campaignMap.ready && ctx.frame > 30) campaignMap.work(ctx.isXR ? 2.5 : 5);
  }
  player.lateUpdate(dt);
  mirror.visible = ctx.isXR && state === 'menu' && !!player.menuBody?.vrDriven;
  if (world) world.update(dt, ctx.time, camera.getWorldPosition(_cp));
  fx.update(dt);
  updateHUD(dt);
  if (battle) battle.tags.update(battle.ducks, camera.getWorldPosition(_cp));
  if (ctx.isXR && menuPanel.mesh.visible && menuPanel.mesh.parent === scene) {
    // re-centre the menu if the player turns well away from it
    menuFollow.lag = 1.5; menuFollow.update(dt, camera);
  }
  // audio listener follows the head
  camera.getWorldPosition(_cp); camera.getWorldDirection(_v1); _v2.set(0, 1, 0).transformDirection(camera.matrixWorld);
  audio.setListener(_cp, _v1, _v2);
  if (ctx.settings.showFps && ctx.isXR && ctx.frame % 36 === 0) hud.wrist.panel.dirty = true;
  if (!noRender) renderer.render(scene, camera);
  input.endFrame();
}
const _cp = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

// ------------------------------------------------------------------ boot
(async function boot() {
  await loadFonts();
  buildMenuWorld();
  player.placeMenu();
  player.setupHands(null);
  layoutHUD();
  setupLanding();
  renderer.setAnimationLoop((t) => frame());
  $('boot')?.remove();
  document.body.dataset.ready = '1';
  window.__duck = { THREE: { WebGLRenderTarget: THREE.WebGLRenderTarget, PerspectiveCamera: THREE.PerspectiveCamera }, ctx, app, get battle() { return battle; }, get state() { return state; }, get paused() { return paused; }, player, input, renderer, MISSIONS, newCampaign, makeDuckInfo, CLASSES, CAMPAIGN, campaignMap, skirmishBattle, startBattle: (cfg) => startBattle(cfg), scene, camera, rig, step: (dt, noRender) => frame(dt, noRender), stop: () => renderer.setAnimationLoop(null), start: () => renderer.setAnimationLoop(() => frame()) };
})();
