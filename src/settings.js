// Settings + campaign save, kept in this browser's localStorage.
import { ctx } from './ctx.js';

const KEY = 'duck-and-cover.save.v1';

export const DEFAULT_SETTINGS = {
  locomotion: 'teleport',   // teleport | smooth
  turning: 'snap30',        // snap30 | snap45 | smooth
  vignette: 'low',          // off | low | high
  heightMode: 'auto',       // auto | real
  hand: 'right',            // right | left
  vrBody: 'full',           // full (see your duck's body, in VR and on screen) | hands
  aimGuide: 'short',        // off | short | full
  turnTime: 90,             // seconds per turn: move anywhere and fire once before it runs out
  quality: 'auto',          // auto | low | medium | high | ultra
  showFps: false,
  master: 0.8, music: 0.5, sfx: 0.9,
  difficulty: 'veteran',    // recruit | veteran | elite
  mouseSens: 1.0,
  invertY: false,
};

export function defaultSave() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    campaign: null, // created by campaign.newCampaign()
  };
}

export function loadSave() {
  let data = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { data = null; }
  const save = defaultSave();
  if (data && typeof data === 'object') {
    save.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    if (!(save.settings.turnTime > 0)) save.settings.turnTime = DEFAULT_SETTINGS.turnTime; // turns always run on the clock now
    save.campaign = data.campaign || null;
  }
  return save;
}

export function writeSave() {
  try { localStorage.setItem(KEY, JSON.stringify(ctx.save)); return true; } catch (e) { return false; }
}

export function setSetting(key, value) {
  ctx.save.settings[key] = value;
  ctx.settings = ctx.save.settings;
  writeSave();
}

// Option lists used by the settings screen (value, label).
export const SETTING_OPTIONS = {
  locomotion: [['teleport', 'Teleport'], ['smooth', 'Smooth']],
  turning: [['snap30', 'Snap 30°'], ['snap45', 'Snap 45°'], ['smooth', 'Smooth']],
  vignette: [['off', 'Off'], ['low', 'Low'], ['high', 'High']],
  heightMode: [['auto', 'Duck'], ['real', 'Real']],
  hand: [['right', 'Right'], ['left', 'Left']],
  vrBody: [['full', 'Full body'], ['hands', 'Hands only']],
  aimGuide: [['off', 'Off'], ['short', 'Short'], ['full', 'Full']],
  turnTime: [[30, '30 s'], [45, '45 s'], [60, '60 s'], [90, '90 s'], [120, '120 s']],
  quality: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']],
  showFps: [[false, 'Off'], [true, 'On']],
  difficulty: [['recruit', 'Recruit'], ['veteran', 'Veteran'], ['elite', 'Elite']],
  master: [[0, '0%'], [0.2, '20%'], [0.4, '40%'], [0.6, '60%'], [0.8, '80%'], [1, '100%']],
  music: [[0, '0%'], [0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, '100%']],
  sfx: [[0, '0%'], [0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [0.9, '90%'], [1, '100%']],
  mouseSens: [[0.5, 'Slow'], [0.75, 'Calm'], [1.0, 'Normal'], [1.5, 'Quick'], [2.0, 'Fast']],
  invertY: [[false, 'Off'], [true, 'On']],
};
