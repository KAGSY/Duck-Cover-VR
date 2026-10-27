// Weapon table. Damage/radius tuned for ~80-125 HP ducks.
// fire: 'charge' (hold to build power, release), 'tap' (press), 'point' (hold to aim a target, release)
import { RANKS, BRANCHES, classTitle, loadoutFor as classLoadout, rankShort, hpFor } from './classes.js';

export const WEAPONS = {
  bazooka: {
    name: 'Bazooka', short: 'BAZ', kind: 'rocket', fire: 'charge', dmg: 42, radius: 4.4, crater: 1.6,
    speed: [10, 46], wind: 1.0, gravity: 1.0, knock: 11, model: 'bazooka', proj: 'rocket', sound: 'launch',
    desc: 'Rocket with a strong blast. Drifts with the wind.',
  },
  grenade: {
    name: 'Grenade', short: 'GRN', kind: 'grenade', fire: 'charge', dmg: 38, radius: 4.2, crater: 1.4,
    speed: [5, 25], wind: 0.25, gravity: 1.0, knock: 10, fuse: 3.0, bounce: 0.42, model: 'grenade', proj: 'grenade', sound: 'throw', throwable: true,
    desc: 'Bounces, then goes off after 3 seconds. Throw it for real or charge it.',
  },
  rifle: {
    name: 'Pellet Rifle', short: 'RFL', kind: 'bullet', fire: 'tap', dmg: 21, radius: 0, crater: 0,
    speed: [95, 95], wind: 0, gravity: 0.25, knock: 3.5, model: 'rifle', proj: 'bullet', sound: 'shot', shots: 3,
    desc: 'Three quick pellets. Weak but accurate.',
  },
  slap: {
    name: 'Wing Slap', short: 'SLP', kind: 'melee', fire: 'tap', dmg: 16, radius: 0, crater: 0, range: 2.3,
    knock: 15, model: 'slap', sound: 'slap',
    desc: 'Close-range shove. Great for knocking ducks into the river.',
  },
  mortar: {
    name: 'Mortar', short: 'MRT', kind: 'shell', fire: 'charge', dmg: 55, radius: 5.4, crater: 2.0,
    speed: [12, 48], wind: 1.2, gravity: 1.0, knock: 13, minPitch: 0.6, model: 'mortar', proj: 'shell', sound: 'mortar',
    desc: 'Heavy lobbed shell. Aim high.',
  },
  cluster: {
    name: 'Cluster Shell', short: 'CLU', kind: 'cluster', fire: 'charge', dmg: 26, radius: 3.4, crater: 1.1,
    speed: [12, 44], wind: 1.0, gravity: 1.0, knock: 8, bomblets: 5, model: 'cluster', proj: 'shell', sound: 'mortar',
    desc: 'Bursts into five bomblets on impact.',
  },
  sniper: {
    name: 'Sniper Rifle', short: 'SNP', kind: 'hitscan', fire: 'point', dmg: 48, radius: 0, crater: 0, range: 260,
    knock: 6, model: 'sniper', sound: 'snipe',
    desc: 'Hold to aim the laser sight, release to fire. No drop, no wind.',
  },
  homing: {
    name: 'Homing Gull', short: 'GUL', kind: 'homing', fire: 'point', dmg: 40, radius: 4.0, crater: 1.4,
    speed: [24, 24], wind: 0.3, gravity: 0, knock: 10, model: 'homing', proj: 'gull', sound: 'gull',
    desc: 'Hold to mark a spot with the laser, release. The gull flies there.',
  },
  mine: {
    name: 'Landmine', short: 'MIN', kind: 'mine', fire: 'tap', dmg: 45, radius: 4.0, crater: 1.6,
    knock: 12, model: 'mine', sound: 'place',
    desc: 'Placed at your feet. Goes off when any duck comes close.',
  },
  airstrike: {
    name: 'Airstrike', short: 'AIR', kind: 'airstrike', fire: 'point', dmg: 36, radius: 4.4, crater: 1.6,
    knock: 11, bombs: 4, model: 'airstrike', sound: 'radio',
    desc: 'Hold to point at the ground, release to call in four bombs.',
  },
  medkit: {
    name: 'Field Medkit', short: 'MED', kind: 'heal', fire: 'tap', heal: 35, model: 'medkit', sound: 'heal',
    desc: 'Heals this duck, or a squadmate you are pointing at.',
  },
  // ---- career weapons and abilities (see classes.js)
  airburst: {
    name: 'Airburst Shell', short: 'ABS', kind: 'shell', fire: 'charge', dmg: 34, radius: 5.2, crater: 0, airburst: 3.2,
    speed: [12, 46], wind: 1.1, gravity: 1.0, knock: 9, minPitch: 0.5, model: 'airburst', proj: 'shell', sound: 'mortar',
    desc: 'Lob it high: it bursts in the air above the target, catching ducks behind cover.',
  },
  tnt: {
    name: 'TNT', short: 'TNT', kind: 'grenade', fire: 'charge', dmg: 55, radius: 5.0, crater: 2.2,
    speed: [4, 18], wind: 0.1, gravity: 1.0, knock: 13, fuse: 4.0, bounce: 0.08, model: 'tnt', proj: 'tnt', sound: 'throw', throwable: true,
    desc: 'A heavy charge that barely bounces. Goes off after 4 seconds with a huge blast.',
  },
  shotgun: {
    name: 'Shotgun', short: 'SHG', kind: 'bullet', fire: 'tap', dmg: 9, radius: 0, crater: 0, shots: 7, burst: true, spread: 0.075, life: 0.42,
    speed: [80, 80], wind: 0, gravity: 0.3, knock: 2.4, model: 'shotgun', proj: 'bullet', sound: 'shot',
    desc: 'Seven pellets at once. Brutal up close, harmless far away.',
  },
  medidart: {
    name: 'Medicine Dart', short: 'DRT', kind: 'hitscan', fire: 'tap', healDart: true, heal: 30, dmg: 6, range: 90, knock: 0,
    model: 'medidart', sound: 'snipe',
    desc: 'Shoot a squadmate to heal them by 30 from afar. Only stings an enemy.',
  },
  camo: {
    name: 'Camouflage', short: 'CAM', kind: 'camo', fire: 'tap', free: true, model: 'camo', sound: 'place',
    desc: 'Vanish into the scenery: the enemy cannot pick you out until you fire, get hit, or two turns pass. Free action.',
  },
  sandbags: {
    name: 'Sandbags', short: 'BAG', kind: 'build', fire: 'tap', free: true, model: 'sandbags', sound: 'place',
    desc: 'Build a sandbag wall just in front of you for cover. Free action.',
  },
  jetpack: {
    name: 'Jetpack', short: 'JET', kind: 'jetpack', fire: 'point', free: true, range: 24, model: 'jetpack', sound: 'launch',
    desc: 'Point where to land and let go: a rocket-powered leap over anything in the way. Free action.',
  },
  paradrop: {
    name: 'Paradrop', short: 'PAR', kind: 'paradrop', fire: 'point', free: true, range: 260, model: 'paradrop', sound: 'radio',
    desc: 'Point anywhere on the map and let go: a plane drops you there by parachute. Free action.',
  },
};

export const WEAPON_ORDER = ['bazooka', 'grenade', 'rifle', 'shotgun', 'mortar', 'cluster', 'airburst', 'sniper', 'homing', 'tnt', 'mine', 'airstrike', 'medkit', 'medidart', 'camo', 'sandbags', 'jetpack', 'paradrop', 'slap'];

// Ranks, careers and kits live in classes.js; these keep older imports working.
export const RANK_NAMES = RANKS.map(r => r?.name || '');
export const RANK_SHORT = RANKS.map(r => r?.short || '');
export const RANK_HP = RANKS.map(r => r?.hp || 0);
export const SPECS = Object.fromEntries([['none', { name: 'Private', desc: 'No career yet.' }], ...Object.values(BRANCHES).map(b => [b.id, { name: b.name, desc: b.blurb }])]);
export function specTitle(rank, spec) { return classTitle(rank, spec); }
export function loadoutFor(rank, spec) { return classLoadout(rank, spec); }
export function enemyLoadout(rank, spec) { return classLoadout(rank, spec); }
export { rankShort, hpFor };

export function weaponList(ammo) {
  return WEAPON_ORDER.filter(w => ammo[w] !== undefined && ammo[w] > 0);
}
