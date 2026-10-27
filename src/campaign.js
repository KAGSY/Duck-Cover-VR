// Factions, the 12-mission campaign, squad progression and skirmish setup.
import { loadoutFor, RANK_SHORT } from './weapons.js';
import { BRANCH_ORDER, hpFor, nextPromotion, promoteDuck } from './classes.js';
import { ctx } from './ctx.js';
import { writeSave } from './settings.js';

export const FACTIONS = {
  mallard: { id: 'mallard', name: 'Mallard Fusiliers', short: 'Mallards', species: 'mallard', helmet: '#5d6a3a', belt: '#3c4628', accent: '#e2c044', tunic: '#6b7246', trousers: '#565a38', puttee: '#8a7f5c', glove: '#4a3a2a', tagColor: '#9ccf62', flag: ['#4b5a2e', '#e2c044'] },
  teal: { id: 'teal', name: 'Teal Brigade', short: 'Teals', species: 'teal', helmet: '#3d5d72', belt: '#273846', accent: '#d9c27a', tunic: '#4b6a80', trousers: '#34495a', puttee: '#6d7f8a', glove: '#2b2a2a', tagColor: '#6fc6d9', flag: ['#2f4a5c', '#d9c27a'] },
  eider: { id: 'eider', name: 'Eider Arctic Corps', short: 'Eiders', species: 'eider', helmet: '#dfe5e8', belt: '#566672', accent: '#3a7ab5', tunic: '#e4e9ec', trousers: '#c2ccd3', puttee: '#9aa6ae', glove: '#e9ecee', tagColor: '#b9d7ef', flag: ['#dfe6ea', '#3a7ab5'] },
  merganser: { id: 'merganser', name: 'Merganser Raiders', short: 'Raiders', species: 'merganser', helmet: '#8a3a22', belt: '#4a2a1a', accent: '#e8a23a', tunic: '#a0663e', trousers: '#6e4b31', puttee: '#b59a72', glove: '#3a2a1e', tagColor: '#ef8f5f', flag: ['#6e2a18', '#e8a23a'] },
  muscovy: { id: 'muscovy', name: 'Muscovy Imperial Guard', short: 'Guard', species: 'muscovy', helmet: '#2a2a33', belt: '#7a1a22', accent: '#d9b43a', tunic: '#30303c', trousers: '#6a1a24', puttee: '#22222a', glove: '#e8e4da', tagColor: '#e46a7a', flag: ['#2a2a33', '#d9b43a'] },
};
// How a faction's ducks look: species colours plus the field uniform.
export function factionLook(f) {
  return { species: f.species, helmet: f.helmet, belt: f.belt, accent: f.accent, tunic: f.tunic, trousers: f.trousers, puttee: f.puttee, glove: f.glove };
}

const ENEMY_NAMES = {
  teal: ['Greenwing', 'Darter', 'Tealby', 'Sedge', 'Rill', 'Wren'],
  eider: ['Floe', 'Fjell', 'Skerry', 'Brash', 'Haar', 'Sleet'],
  merganser: ['Sawbill', 'Rusty', 'Flint', 'Gully', 'Scree', 'Talus'],
  muscovy: ['Wattle', 'Velvet', 'Garnet', 'Sable', 'Crown', 'Ermine'],
};
const SQUAD_NAMES = ['Puddles', 'Waddington', 'Mallory', 'Drake'];
const RECRUIT_NAMES = ['Dabs', 'Paddles', 'Bramble', 'Quillon'];

// ------------------------------------------------------------------ missions
// Coordinates are metres from the map centre (map is 160 m across).
export const MISSIONS = [
  {
    id: 1, act: 1, name: 'Boot Camp Pond', place: 'The Reed Marshes', biome: 'marsh', look: 'morning', seed: 1101,
    enemy: null, windMax: 0, crates: 2, tutorial: true,
    objective: { type: 'destroy', text: 'Knock down the three straw dummies', win: 'All three dummies flattened. Not bad, recruits.' },
    layout: {
      teams: [{ x: -26, z: 22, r: 5, count: 4 }],
      structures: [
        { type: 'dummy', x: -4, z: 8, objective: 'target', label: 'Straw dummy', rot: 2.4 },
        { type: 'dummy', x: 6, z: 26, objective: 'target', label: 'Straw dummy', rot: 1.9 },
        { type: 'dummy', x: 14, z: -10, objective: 'target', label: 'Straw dummy', rot: 2.8 },
        { type: 'sandbags', x: -18, z: 14, rot: 0.6 },
        { type: 'hut', x: -36, z: 32, rot: 0.8 },
      ],
    },
    briefing: 'Welcome to the Fusiliers, recruits. Before we let you anywhere near the Teals, show the Sergeant you can hit something. Three straw dummies are set up out on the marsh. Flatten them.',
  },
  {
    id: 2, act: 1, name: 'Reedbed Skirmish', place: 'The Reed Marshes', biome: 'marsh', look: 'afternoon', seed: 1202,
    enemy: 'teal', windMax: 3, crates: 3,
    objective: { type: 'eliminate', text: 'Knock out the Teal patrol' },
    enemies: [{ rank: 1 }, { rank: 1 }, { rank: 1 }],
    layout: {
      teams: [{ x: -42, z: 30, r: 6, count: 4 }, { x: 38, z: -26, r: 7, count: 3 }],
      structures: [
        { type: 'sandbags', rel: 1, x: -6, z: 5, rot: 0.8 }, { type: 'sandbags', rel: 1, x: 4, z: 7, rot: -0.4 },
        { type: 'sandbags', rel: 0, x: 5, z: -5, rot: 0.8 }, { type: 'hut', rel: 1, x: 9, z: -6, rot: 2.3 },
      ],
    },
    briefing: 'A Teal patrol has dug in among the reeds south of the pond. Clear them out. Keep an eye on the wind flag on your wrist before you fire: rockets drift.',
  },
  {
    id: 3, act: 1, name: 'The Old Mill', place: "Pollard's Mill", biome: 'farm', look: 'afternoon', seed: 1303,
    enemy: 'teal', windMax: 4, crates: 3,
    objective: { type: 'destroy', text: 'Destroy both Teal supply tents', win: 'The supply tents are burning. The Teals will go hungry tonight.' },
    enemies: [{ rank: 1 }, { rank: 2, spec: 'grenadier' }, { rank: 1 }],
    layout: {
      teams: [{ x: -46, z: -30, r: 6, count: 4 }, { x: 34, z: 30, r: 8, count: 3 }],
      structures: [
        { type: 'tent', rel: 1, x: -6, z: 8, objective: 'target', label: 'Supply tent', rot: 0.4 },
        { type: 'tent', rel: 1, x: 10, z: -4, objective: 'target', label: 'Supply tent', rot: 1.7 },
        { type: 'mill', rel: 1, x: 14, z: 14, rot: 3.6 }, { type: 'fence', rel: 1, x: -12, z: -2, rot: 1.2 },
        { type: 'sandbags', rel: 1, x: -2, z: -7, rot: 0.6 }, { type: 'barrels', rel: 1, x: -9, z: 12 },
        { type: 'hut', rel: 0, x: -6, z: -8, rot: 0.5 }, { type: 'fence', rel: 0, x: 8, z: 4, rot: 0.2 },
      ],
    },
    briefing: "The Teals are feeding their whole brigade from the stores at Pollard's Mill. Destroy both supply tents and they'll be eating reeds by morning. The red barrels by the tents are full of lamp oil.",
  },
  {
    id: 4, act: 1, name: "Blueflash's Last Stand", place: 'Heron Point', biome: 'marsh', look: 'dusk', seed: 1404,
    enemy: 'teal', windMax: 5, crates: 3,
    objective: { type: 'assassinate', text: 'Take out Major Blueflash', win: 'Major Blueflash is down. The marsh belongs to the Fusiliers.' },
    enemies: [{ rank: 4, spec: 'grenadier', name: 'Major Blueflash', commander: true, hp: 160 }, { rank: 2, spec: 'sharpshooter' }, { rank: 1 }, { rank: 2, spec: 'sapper' }],
    layout: {
      teams: [{ x: -44, z: -34, r: 6, count: 4 }, { x: 36, z: 32, r: 7, count: 4 }],
      structures: [
        { type: 'bunker', rel: 1, x: 6, z: 6, rot: 3.9 }, { type: 'tower', rel: 1, x: -8, z: 8, rot: 0.3 },
        { type: 'sandbags', rel: 1, x: -4, z: -6, rot: 0.8 }, { type: 'sandbags', rel: 1, x: 7, z: -5, rot: 2.2 },
        { type: 'barrels', rel: 1, x: 12, z: 0 }, { type: 'sandbags', rel: 0, x: 4, z: 6, rot: 0.8 },
      ],
    },
    briefing: 'Major Blueflash runs the Teal Brigade from a bunker on Heron Point. He is tougher than his privates and his sharpshooter has a long reach. Take him out and the marsh is ours.',
  },
  {
    id: 5, act: 2, name: 'Icefloe Landing', place: 'The Frozen Firth', biome: 'snow', look: 'overcast', seed: 2105,
    enemy: 'eider', windMax: 5, crates: 3,
    objective: { type: 'eliminate', text: 'Push the Eiders off the beach' },
    enemies: [{ rank: 1 }, { rank: 2, spec: 'grenadier' }, { rank: 1 }, { rank: 2, spec: 'medic' }],
    layout: {
      teams: [{ x: -50, z: 20, r: 6, count: 4 }, { x: 30, z: -24, r: 8, count: 4 }],
      structures: [
        { type: 'wall', rel: 1, x: -7, z: 4, rot: 1.1 }, { type: 'sandbags', rel: 1, x: 5, z: 8, rot: 0.3 },
        { type: 'hut', rel: 1, x: 10, z: -6, rot: 2.6 }, { type: 'sandbags', rel: 0, x: 6, z: -4, rot: 1.0 },
      ],
    },
    briefing: "We've landed on the ice-bound shore of the Firth. The Eiders know this cold; we don't. Their medic will patch them up if you leave them limping, so finish what you start.",
  },
  {
    id: 6, act: 2, name: 'Radar Hill', place: 'Kittiwake Hill', biome: 'snow', look: 'noon', seed: 2206,
    enemy: 'eider', windMax: 6, crates: 3,
    objective: { type: 'capture', turns: 2, text: 'Hold the hilltop flag for 2 of your turns', win: 'Our flag flies over Kittiwake Hill.' },
    enemies: [{ rank: 2, spec: 'sharpshooter' }, { rank: 1 }, { rank: 2, spec: 'sapper' }, { rank: 1 }],
    layout: {
      teams: [{ x: -48, z: -40, r: 6, count: 4 }, { x: 22, z: 26, r: 8, count: 4 }],
      zone: { x: 5, z: 5, r: 6, hill: true },
      structures: [
        { type: 'radar', at: 'zone', x: 7, z: 4, rot: 2.2 }, { type: 'sandbags', at: 'zone', x: -5, z: -6, rot: 0.7 },
        { type: 'bunker', rel: 1, x: 6, z: 6, rot: 3.6 }, { type: 'wall', rel: 0, x: 6, z: 6, rot: 0.8 },
      ],
    },
    briefing: 'The Eider radar on Kittiwake Hill sees every move we make. Get a duck inside the flag ring on the summit and hold it, with no Eiders inside, at the end of two of your turns in a row.',
  },
  {
    id: 7, act: 2, name: 'Whiteout Pass', place: 'Skerry Pass', biome: 'snow', look: 'blizzard', seed: 2307,
    enemy: 'eider', windMax: 8, crates: 4,
    objective: { type: 'survive', turns: 7, text: 'Survive 7 turns until the blizzard clears', win: 'The weather has cleared and the relief column is here.' },
    enemies: [{ rank: 2, spec: 'grenadier' }, { rank: 1 }, { rank: 2 , spec: 'sharpshooter' }, { rank: 1 }, { rank: 2, spec: 'medic' }],
    layout: {
      teams: [{ x: -10, z: -8, r: 6, count: 4 }, { x: 40, z: 38, r: 10, count: 5 }],
      structures: [
        { type: 'wall', rel: 0, x: 6, z: 6, rot: 0.8 }, { type: 'sandbags', rel: 0, x: -6, z: 7, rot: 2.4 },
        { type: 'hut', rel: 0, x: -7, z: -6, rot: 0.3 }, { type: 'sandbags', rel: 1, x: -6, z: -6, rot: 0.8 },
      ],
    },
    briefing: "A blizzard has cut us off in Skerry Pass and five Eiders are closing in. You can barely see your own bill. Keep at least one duck standing for seven turns and the relief column will reach you. The wind is savage today.",
  },
  {
    id: 8, act: 2, name: 'Fortress Eiderdown', place: 'The Narrows', biome: 'snow', look: 'dusk', seed: 2408,
    enemy: 'eider', windMax: 6, crates: 4,
    objective: { type: 'destroy', text: 'Destroy the three concrete bunkers', win: 'All three bunkers are rubble. The Firth is ours.' },
    enemies: [{ rank: 5, spec: 'sapper', name: 'Colonel Eiderdown', commander: true, hp: 170 }, { rank: 2, spec: 'grenadier' }, { rank: 2, spec: 'sharpshooter' }, { rank: 2, spec: 'medic' }],
    layout: {
      teams: [{ x: -46, z: 40, r: 6, count: 4 }, { x: 32, z: -30, r: 9, count: 4 }],
      structures: [
        { type: 'bunker', rel: 1, x: -10, z: 6, objective: 'target', label: 'Bunker', hp: 200, rot: 0.6 },
        { type: 'bunker', rel: 1, x: 8, z: 10, objective: 'target', label: 'Bunker', hp: 200, rot: 2.4 },
        { type: 'bunker', rel: 1, x: 12, z: -10, objective: 'target', label: 'Bunker', hp: 200, rot: 3.9 },
        { type: 'barrels', rel: 1, x: 0, z: 0 }, { type: 'tower', rel: 1, x: -2, z: -12, rot: 0.2 },
        { type: 'wall', rel: 0, x: 5, z: -6, rot: 0.6 },
      ],
    },
    briefing: 'Colonel Eiderdown has fortified the Narrows with three concrete bunkers. They take a lot of punishment: mortars and airstrikes are your friends here. Flatten all three.',
  },
  {
    id: 9, act: 3, name: 'Canyon Ambush', place: 'The Rustwater Canyons', biome: 'canyon', look: 'morning', seed: 3109,
    enemy: 'merganser', windMax: 5, crates: 4,
    objective: { type: 'survive', turns: 6, text: 'Survive 6 turns against the raiders', win: 'The raiders have pulled back into the canyons.' },
    enemies: [{ rank: 2, spec: 'grenadier' }, { rank: 2, spec: 'sapper' }, { rank: 1 }, { rank: 2, spec: 'sharpshooter' }, { rank: 1 }, { rank: 2 }],
    layout: {
      teams: [{ x: 0, z: 0, r: 6, count: 4 }, { x: 44, z: -38, r: 14, count: 6 }],
      structures: [
        { type: 'wall', rel: 0, x: 6, z: -6, rot: 0.8 }, { type: 'sandbags', rel: 0, x: -6, z: 5, rot: 2.3 },
        { type: 'barrels', rel: 0, x: -9, z: -8 }, { type: 'tower', rel: 1, x: 0, z: 8, rot: 0.4 },
      ],
    },
    briefing: 'Merganser Raiders have ambushed the convoy in the canyons and we are badly outnumbered. Dig in, use the cover, and keep at least one duck standing for six turns.',
  },
  {
    id: 10, act: 3, name: 'Rescue at Rustwater', place: 'Rustwater Ford', biome: 'canyon', look: 'afternoon', seed: 3210,
    enemy: 'merganser', windMax: 5, crates: 3, reward: 'pip',
    objective: { type: 'rescue', captive: { x: 6, z: -4, rel: 1 }, text: 'Reach the cage and free Private Pip', win: 'Private Pip is free and joins your squad.' },
    enemies: [{ rank: 2, spec: 'sapper' }, { rank: 2, spec: 'grenadier' }, { rank: 1 }, { rank: 2, spec: 'medic' }],
    layout: {
      teams: [{ x: -46, z: 34, r: 6, count: 4 }, { x: 28, z: -28, r: 8, count: 4 }],
      captive: { x: 6, z: -4, rel: 1 },
      structures: [
        { type: 'hut', rel: 1, x: -8, z: 6, rot: 0.6 }, { type: 'sandbags', rel: 1, x: -3, z: 9, rot: 0.2 },
        { type: 'tower', rel: 1, x: 10, z: 8, rot: 1.0 }, { type: 'barrels', rel: 1, x: -10, z: -6 },
      ],
    },
    briefing: 'The raiders captured Private Pip from the convoy and keep him caged at their camp by the ford. Get any of your ducks right up to the cage to free him. Watch for mines on the approach.',
  },
  {
    id: 11, act: 3, name: "Sawtooth's Stronghold", place: 'Red Mesa', biome: 'canyon', look: 'dusk', seed: 3311,
    enemy: 'merganser', windMax: 6, crates: 4,
    objective: { type: 'assassinate', text: 'Take out Captain Sawtooth', win: 'Captain Sawtooth is finished. The canyons are quiet.' },
    enemies: [{ rank: 5, spec: 'sharpshooter', name: 'Captain Sawtooth', commander: true, hp: 175 }, { rank: 3, spec: 'grenadier' }, { rank: 2, spec: 'sapper' }, { rank: 2, spec: 'medic' }, { rank: 2 }],
    layout: {
      teams: [{ x: -44, z: -42, r: 6, count: 4 }, { x: 34, z: 34, r: 9, count: 5 }],
      structures: [
        { type: 'wall', rel: 1, x: -8, z: -4, rot: 0.9 }, { type: 'wall', rel: 1, x: 4, z: -9, rot: 2.6 },
        { type: 'tower', rel: 1, x: 8, z: 6, rot: 0.2 }, { type: 'bunker', rel: 1, x: -4, z: 10, rot: 3.4 },
        { type: 'barrels', rel: 1, x: 0, z: -2 }, { type: 'sandbags', rel: 0, x: 6, z: 6, rot: 0.8 },
      ],
    },
    briefing: 'Captain Sawtooth commands the raiders from the top of Red Mesa, behind stone walls and a watchtower. He is a crack shot. Get him and the raiders will scatter.',
  },
  {
    id: 12, act: 4, name: 'The Grand Weir', place: 'The Grand Weir', biome: 'weir', look: 'sunset', seed: 4412,
    enemy: 'muscovy', windMax: 6, crates: 5,
    objective: { type: 'eliminate', text: 'Defeat the Muscovy Imperial Guard', win: 'The Imperial Guard has fallen. The pond is free!' },
    enemies: [{ rank: 7, spec: 'grenadier', name: 'Grand Duke Muscovado', commander: true, hp: 220 }, { rank: 3, spec: 'sharpshooter' }, { rank: 3, spec: 'sapper' }, { rank: 3, spec: 'medic' }, { rank: 3, spec: 'grenadier' }],
    layout: {
      teams: [{ x: -40, z: 46, r: 6, count: 4 }, { x: 36, z: -40, r: 9, count: 5 }],
      structures: [
        { type: 'weir', x: 0, z: 2, rot: Math.PI / 2, exact: true },
        { type: 'bunker', rel: 1, x: -8, z: 8, rot: 0.6 }, { type: 'bunker', rel: 1, x: 10, z: -2, rot: 2.6 },
        { type: 'tower', rel: 1, x: 2, z: 12, rot: 0.3 }, { type: 'wall', rel: 1, x: -6, z: -8, rot: 1.2 },
        { type: 'barrels', rel: 1, x: 4, z: 4 }, { type: 'sandbags', rel: 0, x: 6, z: -6, rot: 0.8 },
        { type: 'hut', rel: 0, x: -8, z: 4, rot: 0.2 },
      ],
    },
    briefing: 'This is it. The Muscovy Imperial Guard holds the Grand Weir, and Grand Duke Muscovado himself leads them. Every one of his ducks is a veteran. Win here and the whole pond is free.',
  },
];
export const ACTS = { 1: 'Act I · The Reed Marshes', 2: 'Act II · The Frozen Firth', 3: 'Act III · The Rustwater Canyons', 4: 'Finale' };

// ------------------------------------------------------------------ roster
let idSeq = 1;
export function makeDuckInfo(name, rank = 1, spec = 'none') {
  return { id: `d${Date.now().toString(36)}${idSeq++}`, name, rank, spec, kills: 0, missions: 0, damage: 0, deploy: true };
}

// Promotion points: one for winning a mission, and a bonus one when every duck you sent comes home.
// Each mission pays out once for the win and once for the bonus, however often it is replayed.
export const POINTS_VICTORY = 1, POINTS_ALL_SURVIVED = 1;

export function newCampaign() {
  return {
    v: 2,
    unlocked: 1,
    completed: {},   // mission id -> won
    flawless: {},    // mission id -> won with every duck alive
    points: 0,       // promotion points waiting to be spent
    // every duck starts as a Private
    roster: SQUAD_NAMES.map(n => makeDuckInfo(n)),
    recruits: 0,
    finished: false,
  };
}
// Bring a save from before promotion points up to date (ducks keep the ranks they have).
export function ensureCampaign(camp) {
  if (!camp) return camp;
  camp.completed ??= {}; camp.flawless ??= {}; camp.points ??= 0; camp.v = 2;
  for (const d of camp.roster || []) { delete d.xp; d.damage ??= 0; }
  return camp;
}

export function displayName(info) { return `${RANK_SHORT[info.rank] || 'Pvt.'} ${info.name}`; }
export function maxHpFor(info) { return info.hp || hpFor(info.rank || 1, info.spec); }

export function battleInfo(info) {
  return {
    ...info,
    name: displayName(info),
    baseName: info.name,
    maxHp: maxHpFor(info),
    ammo: loadoutFor(info.rank, info.spec),
  };
}

export function deployedRoster(camp) {
  const list = camp.roster.filter(d => d.deploy !== false);
  return (list.length ? list : camp.roster).slice(0, 4);
}

// The next promotion for a duck ({ rank, cost, needsSpec }), or null at the top. Privates must pick a career.
export function promotionFor(info) {
  const p = nextPromotion(info);
  return p ? { rank: p.rank, cost: p.cost, needsSpec: p.needsCareer } : null;
}
export function canPromote(camp, info) {
  const p = nextPromotion(info);
  return !!p && (camp?.points || 0) >= p.cost;
}
// Spend promotion points to promote one rank. Returns true if it happened.
export function promote(camp, info, spec = null) {
  const p = nextPromotion(info);
  if (!p || (camp.points || 0) < p.cost) return false;
  const from = info.rank;
  if (!promoteDuck(info, spec)) return false;
  camp.points -= p.cost;
  info.lastPromo = { from, to: info.rank };
  return true;
}

// ------------------------------------------------------------------ battle setup
export function campaignBattle(mission, camp, settings) {
  const player = FACTIONS.mallard;
  const squad = deployedRoster(camp);
  const teams = [{
    name: player.name, faction: player, control: 'human', isPlayer: true, difficulty: settings.difficulty, tagColor: player.tagColor,
    look: factionLook(player),
    ducksInfo: squad.map(battleInfo),
  }];
  const layout = JSON.parse(JSON.stringify(mission.layout));
  layout.teams[0].count = squad.length;
  // squads start 50-80 m apart: close enough for grenades after a couple of turns
  for (const t of layout.teams) { t.x *= 0.7; t.z *= 0.7; }
  for (const st of layout.structures || []) if (st.rel === undefined && st.at === undefined) { st.x *= 0.7; st.z *= 0.7; }
  if (layout.zone) { layout.zone.x *= 0.7; layout.zone.z *= 0.7; }
  if (mission.enemy) {
    const f = FACTIONS[mission.enemy];
    const names = ENEMY_NAMES[mission.enemy].slice();
    const enemies = mission.enemies.map((e, i) => {
      const spec = e.spec || 'none';
      const info = { id: `e${i}`, name: e.name || `${RANK_SHORT[e.rank]} ${names[i % names.length]}`, rank: e.rank, spec, commander: !!e.commander };
      info.maxHp = Math.max(e.hp || 0, hpFor(e.rank, spec));
      info.ammo = loadoutFor(e.rank, spec);
      return info;
    });
    // Act I enemies are one step gentler than the chosen skill while you learn to aim
    const skill = mission.act === 1 ? ({ elite: 'veteran', veteran: 'recruit', recruit: 'recruit' }[settings.difficulty] || 'recruit') : settings.difficulty;
    teams.push({
      name: f.name, faction: f, control: 'ai', isPlayer: false, difficulty: skill, tagColor: f.tagColor,
      look: factionLook(f),
      ducksInfo: enemies,
    });
  }
  const world = { seed: mission.seed, biome: mission.biome, look: mission.look, layout, flagColors: player.flag };
  const runtime = { ...mission, mode: 'campaign', objective: { ...mission.objective } };
  return { world, teams, mission: runtime };
}

export const BIOME_CHOICES = [['marsh', 'Reed marsh'], ['farm', 'Farmland'], ['snow', 'Frozen firth'], ['canyon', 'Canyons'], ['weir', 'River weir']];
export const LOOK_FOR_BIOME = { marsh: 'afternoon', farm: 'morning', snow: 'overcast', canyon: 'dusk', weir: 'sunset' };

// opts: { biome, size, enemy, difficulty, hotseat, rank, seed }
export function skirmishBattle(opts) {
  const seed = opts.seed || (Math.floor(Math.random() * 9000) + 1000);
  const pf = FACTIONS.mallard, ef = FACTIONS[opts.enemy] || FACTIONS.teal;
  const n = opts.size || 4, rank = opts.rank || 2;
  const mk =(names, f, team) => names.slice(0, n).map((nm, i) => {
    const spec = rank >= 2 ? BRANCH_ORDER[i % 4] : 'none';
    return { id: `${team}${i}`, name: `${RANK_SHORT[rank]} ${nm}`, rank, spec, maxHp: hpFor(rank, spec), ammo: loadoutFor(rank, spec) };
  });
  const teams = [
    { name: pf.name, faction: pf, control: 'human', isPlayer: true, difficulty: opts.difficulty, tagColor: pf.tagColor,
      look: factionLook(pf), ducksInfo: mk(SQUAD_NAMES.concat(RECRUIT_NAMES), pf, 'p') },
    { name: ef.name, faction: ef, control: opts.hotseat ? 'human' : 'ai', isPlayer: false, difficulty: opts.difficulty, tagColor: ef.tagColor,
      look: factionLook(ef), ducksInfo: mk(ENEMY_NAMES[ef.id], ef, 'e') },
  ];
  const corners = [[-31, 28], [29, -27]];
  const layout = {
    teams: [{ x: corners[0][0], z: corners[0][1], r: 7, count: n }, { x: corners[1][0], z: corners[1][1], r: 7, count: n }],
    structures: [
      { type: 'sandbags', rel: 0, x: 6, z: -5, rot: 0.8 }, { type: 'sandbags', rel: 1, x: -6, z: 5, rot: 0.8 },
      { type: 'hut', rel: 0, x: -7, z: 4, rot: 0.4 }, { type: 'bunker', rel: 1, x: 7, z: -5, rot: 3.6 },
      { type: 'barrels', x: 0, z: 0 }, { type: 'wall', x: -14, z: -12, rot: 0.7 }, { type: 'tower', x: 16, z: 14, rot: 0.3 },
    ],
  };
  const world = { seed, biome: opts.biome || 'marsh', look: LOOK_FOR_BIOME[opts.biome] || 'afternoon', layout, flagColors: pf.flag };
  const mission = { id: 0, name: 'Skirmish', mode: 'skirmish', seed, windMax: 6, crates: 4, objective: { type: 'eliminate', text: 'Knock out the other squad' }, biome: opts.biome };
  return { world, teams, mission };
}

// ------------------------------------------------------------------ results
// Called after a campaign battle: records each duck's record, pays out promotion points and returns
// a summary for the results screen.
export function applyResults(camp, mission, battle) {
  ensureCampaign(camp);
  const res = battle.result;
  const won = res.outcome === 'victory';
  const player = battle.playerTeam();
  const rows = [];
  for (const d of player.ducks) {
    const info = camp.roster.find(r => r.id === d.info.id);
    if (!info) continue;
    info.kills += d.stats.kills; info.missions += 1; info.damage = (info.damage || 0) + Math.round(d.stats.damage);
    rows.push({ id: info.id, name: displayName(info), damage: d.stats.damage, kills: d.stats.kills, alive: d.alive });
  }
  const lost = player.ducks.filter(d => !d.alive).length;
  const points = { victory: 0, survival: 0, wonBefore: false, bonusBefore: false, lost, total: 0 };
  let reward = null;
  if (won) {
    const first = !camp.completed[mission.id];
    if (first) { camp.completed[mission.id] = true; points.victory = POINTS_VICTORY; } else points.wonBefore = true;
    if (!lost) { if (!camp.flawless[mission.id]) { camp.flawless[mission.id] = true; points.survival = POINTS_ALL_SURVIVED; } else points.bonusBefore = true; }
    camp.points += points.victory + points.survival;
    camp.unlocked = Math.max(camp.unlocked, mission.id + 1);
    if (mission.id === MISSIONS.length) camp.finished = true;
    if (first && mission.reward === 'pip' && !camp.roster.some(r => r.name === 'Pip')) {
      const pip = makeDuckInfo('Pip'); pip.deploy = false;
      camp.roster.push(pip); reward = 'Private Pip has joined your squad. Choose who to deploy in the barracks.';
    }
    if (first && (mission.id === 4 || mission.id === 8) && camp.recruits < RECRUIT_NAMES.length && camp.roster.length < 6) {
      const r = makeDuckInfo(RECRUIT_NAMES[camp.recruits++]); r.deploy = false;
      camp.roster.push(r);
      reward = `Private ${r.name} has joined your squad as a reinforcement.`;
    }
  }
  points.total = camp.points;
  writeSave();
  return { won, reason: res.reason, rows, reward, points, missionId: mission.id };
}
