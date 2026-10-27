// Duck careers and promotions, in the manner of Hogs of War: every duck starts as a Private, chooses one of
// four permanent careers at its first promotion and climbs three levels in it. Every career then goes on to
// Commando, War Hero and finally Legend.
//
// Promotions are bought with promotion points, earned in the campaign (see campaign.js): a career level
// costs PROMOTION_COST points, an elite rank ELITE_COST.
//
// A duck's rank is 1..7: 1 Private, 2-4 career levels 1-3, 5 Commando, 6 War Hero, 7 Legend.
// Its career ("branch") is stored as info.spec, so older saves carry straight over.
const INF = Infinity;

export const BRANCHES = {
  grenadier: {
    id: 'grenadier', name: 'Heavy Weapons', short: 'Heavy', color: '#d65a43', letter: 'H',
    titles: ['Gunner', 'Bombardier', 'Artillerist'],
    blurb: 'Bazooka without limit, mortars, cluster and airburst shells. Their explosions hit harder.',
  },
  sapper: {
    id: 'sapper', name: 'Engineers', short: 'Engineer', color: '#e8ab3c', letter: 'E',
    titles: ['Sapper', 'Engineer', 'Saboteur'],
    blurb: 'Hidden mines, TNT, a shotgun and sandbag walls. Tough, and hard to knock over.',
  },
  sharpshooter: {
    id: 'sharpshooter', name: 'Recon', short: 'Recon', color: '#6fa9e2', letter: 'R',
    titles: ['Scout', 'Sniper', 'Infiltrator'],
    blurb: 'Fastest on foot. Camouflage, sniper rifle, then homing gulls.',
  },
  medic: {
    id: 'medic', name: 'Medical Corps', short: 'Medic', color: '#f1efe6', letter: 'M',
    titles: ['Orderly', 'Medic', 'Surgeon'],
    blurb: 'Medkits and healing darts. Patches itself up every turn and heals squadmates nearby.',
  },
};
export const BRANCH_ORDER = ['grenadier', 'sapper', 'sharpshooter', 'medic'];
export const ELITE_COLOR = '#e2c044';

// hp: maximum health at that rank. cost: promotion points to reach it from the rank below.
export const PROMOTION_COST = 1, ELITE_COST = 2;
export const RANKS = [
  null,
  { short: 'Pvt.', name: 'Private', hp: 80, cost: 0 },
  { short: 'Cpl.', name: 'Corporal', hp: 95, cost: PROMOTION_COST },
  { short: 'Sgt.', name: 'Sergeant', hp: 110, cost: PROMOTION_COST },
  { short: 'Lt.', name: 'Lieutenant', hp: 125, cost: PROMOTION_COST },
  { short: 'Cdo.', name: 'Commando', hp: 140, cost: ELITE_COST },
  { short: 'Hero', name: 'War Hero', hp: 160, cost: ELITE_COST },
  { short: 'Legend', name: 'Legend', hp: 200, cost: ELITE_COST },
];
export const MAX_RANK = 7;
// early career levels trade health against their speciality
const HP_MOD = { grenadier: 0, sapper: 10, sharpshooter: -5, medic: -10 };

const KIT = {
  recruit: { bazooka: 2, grenade: 3 },
  grenadier: [
    { bazooka: INF, grenade: 2, mortar: 2 },
    { bazooka: INF, grenade: 2, mortar: 3, cluster: 1 },
    { bazooka: INF, grenade: 3, mortar: 4, cluster: 2, airburst: 2 },
  ],
  sapper: [
    { bazooka: 2, grenade: 3, mine: 3, tnt: 1, sandbags: 1 },
    { bazooka: 2, grenade: 3, shotgun: INF, mine: 3, tnt: 2, sandbags: 2 },
    { bazooka: 3, grenade: 3, shotgun: INF, mine: 4, tnt: 3, sandbags: 2, airstrike: 1 },
  ],
  sharpshooter: [
    { bazooka: 2, grenade: 2, sniper: 2, camo: 1 },
    { bazooka: 2, grenade: 2, sniper: INF, camo: 2 },
    { bazooka: 2, grenade: 3, sniper: INF, homing: 2, camo: 3 },
  ],
  medic: [
    { bazooka: 2, grenade: 3, medkit: 3 },
    { bazooka: 2, grenade: 3, medkit: 3, medidart: 3 },
    { bazooka: 3, grenade: 3, medkit: 4, medidart: 4 },
  ],
  // elite ranks keep their career's top kit (one more of everything) and add these
  elite: [
    { bazooka: INF, cluster: 1, sniper: 2, medkit: 1, jetpack: 1 },
    { bazooka: INF, cluster: 1, sniper: 2, medkit: 2, jetpack: 2, paradrop: 1, airstrike: 1 },
    { bazooka: INF, cluster: 2, sniper: INF, medkit: 2, jetpack: 3, paradrop: 2, airstrike: 2, airburst: 2 },
  ],
};

export const isRecruit = (info) => (info.rank || 1) <= 1 || !BRANCHES[info.spec];
export function branchOf(info) { return BRANCHES[info.spec] || null; }

export function classTitle(rank, branch) {
  if (rank >= 5) return RANKS[Math.min(rank, MAX_RANK)].name;
  if (rank <= 1 || !BRANCHES[branch]) return 'Private';
  return BRANCHES[branch].titles[rank - 2];
}
export const rankShort = (rank) => (RANKS[rank] || RANKS[1]).short;
export function classColor(rank, branch) { return rank >= 5 ? ELITE_COLOR : BRANCHES[branch]?.color || '#bdb7a6'; }
export function hpFor(rank, branch) {
  const r = RANKS[Math.min(Math.max(rank, 1), MAX_RANK)];
  return r.hp + (rank >= 2 && rank <= 3 ? HP_MOD[branch] || 0 : 0);
}

export function loadoutFor(rank, branch) {
  const a = { slap: INF, rifle: INF };
  const put = (kit, bonus = 0) => { for (const [w, n] of Object.entries(kit)) a[w] = n === INF ? INF : Math.max(a[w] === INF ? INF : a[w] || 0, n + bonus); };
  if (rank <= 1 || !BRANCHES[branch]) put(KIT.recruit);
  else put(KIT[branch][Math.min(rank, 4) - 2], rank >= 5 ? 1 : 0);
  if (rank >= 5) put(KIT.elite[Math.min(rank, MAX_RANK) - 5]);
  return a;
}

// Passive bonuses. Elite ranks keep their career's full bonus and add their own.
export function perksFor(rank, branch) {
  const lvl = rank >= 5 ? 3 : Math.max(0, Math.min(3, rank - 1));
  const p = { blastMul: 1, dmgMul: 1, speedMul: 1, regen: 0, knockRes: 0, healSplash: 0, hiddenMines: false, seesMines: false };
  if (lvl && branch === 'grenadier') p.blastMul = [1, 1.1, 1.15, 1.2][lvl];
  if (lvl && branch === 'sapper') { p.hiddenMines = true; p.knockRes = [0, 0.15, 0.2, 0.3][lvl]; }
  if (lvl && branch === 'sharpshooter') p.speedMul = [1, 1.25, 1.35, 1.45][lvl];
  if (lvl && branch === 'medic') { p.regen = [0, 4, 6, 8][lvl]; p.healSplash = [0, 0, 10, 15][lvl]; }
  if (rank >= 5) { p.knockRes = Math.max(p.knockRes, 0.25); p.speedMul *= 1.1; p.seesMines = true; }
  if (rank >= 6) { p.knockRes = Math.max(p.knockRes, 0.4); p.regen = Math.max(p.regen, 5); p.dmgMul = 1.1; }
  if (rank >= 7) { p.knockRes = 0.6; p.regen = Math.max(p.regen, 8); p.dmgMul = 1.2; }
  return p;
}

// One-line summaries of a rank's bonuses, for the barracks and promotion screens.
export function perkLines(rank, branch) {
  const p = perksFor(rank, branch), out = [];
  if (p.blastMul > 1) out.push(`Explosions hit ${Math.round((p.blastMul - 1) * 100)}% harder`);
  if (p.speedMul > 1.001) out.push(`Moves ${Math.round((p.speedMul - 1) * 100)}% faster`);
  if (p.regen) out.push(`Heals ${p.regen} HP every turn`);
  if (p.healSplash) out.push(`Medkits also heal squadmates nearby by ${p.healSplash}`);
  if (p.hiddenMines) out.push('Mines are hidden from the enemy');
  if (p.knockRes) out.push(`Shrugs off ${Math.round(p.knockRes * 100)}% of knockback`);
  if (p.seesMines) out.push('Spots hidden enemy mines');
  if (p.dmgMul > 1) out.push(`All weapons +${Math.round((p.dmgMul - 1) * 100)}% damage`);
  return out;
}

// What changes between two ranks' kits: [{ weapon, from, to }]
export function kitGains(fromRank, toRank, branch) {
  const a = loadoutFor(fromRank, branch), b = loadoutFor(toRank, branch), out = [];
  for (const [w, n] of Object.entries(b)) if ((a[w] || 0) !== n) out.push({ weapon: w, from: a[w] || 0, to: n });
  return out;
}

// The next promotion for a duck: { rank, cost, needsCareer }, or null at the top. Privates must choose a career.
export function nextPromotion(info) {
  const next = (info.rank || 1) + 1;
  if (next > MAX_RANK) return null;
  return { rank: next, cost: RANKS[next].cost, needsCareer: isRecruit(info) };
}
// Promote one rank (the caller pays the points). A private needs a career to go with it.
export function promoteDuck(info, career = null) {
  const p = nextPromotion(info);
  if (!p) return false;
  if (p.needsCareer) { if (!BRANCHES[career]) return false; info.spec = career; }
  info.rank = p.rank;
  return true;
}
// Points spent to bring a duck from Private to its current rank.
export function pointsInvested(rank) { let n = 0; for (let r = 2; r <= Math.min(rank, MAX_RANK); r++) n += RANKS[r].cost; return n; }
