// Menu screens drawn onto the main 3D panel.
import { ctx, clamp } from './ctx.js';
import { C } from './ui.js';
import { MISSIONS, ACTS, FACTIONS, displayName, maxHpFor, promotionFor, canPromote, promote, deployedRoster, newCampaign, BIOME_CHOICES } from './campaign.js';
import { SETTING_OPTIONS, setSetting, writeSave } from './settings.js';
import { WEAPONS, loadoutFor } from './weapons.js';
import { BRANCHES, BRANCH_ORDER, RANKS, MAX_RANK, classTitle, classColor, hpFor, perkLines, isRecruit } from './classes.js';
import { TIERS } from './quality.js';
import { campaignMap, REGIONS, regionStates, regionForMission, star } from './campaignmap.js';

const W = 1024, H = 720;

function frame(p, eyebrow, title) {
  p.bg();
  p.eyebrow(eyebrow, 48, 64);
  p.title(title, 48, 126, 58);
}

const pts = (n) => `${n} point${n === 1 ? '' : 's'}`;
// promotion points waiting to be spent
function pointsBadge(p, x, y, n, w = 118, h = 50) {
  p.box(x, y, w, h, { fill: n > 0 ? 'rgba(242,194,48,0.16)' : 'rgba(239,231,207,0.05)', border: n > 0 ? C.accent : C.line, r: 12 });
  p.text(String(n), x + 30, y + h / 2 + 13, { size: 36, kind: 'display', weight: 700, align: 'center', color: n > 0 ? C.accent : C.dim });
  p.text('promotion', x + 54, y + h / 2 - 2, { size: 16, color: C.dim });
  p.text(n === 1 ? 'point' : 'points', x + 54, y + h / 2 + 16, { size: 16, color: C.dim });
}
// a campaign medal: a ribbon and a disc, dull until it is earned
function medal(p, x, y, earned, label, sub, color = '#e2c044') {
  const g = p.g;
  g.save();
  g.fillStyle = earned ? '#a82a1e' : 'rgba(239,231,207,0.12)'; g.fillRect(x + 6, y - 2, 6, 14);
  g.fillStyle = earned ? '#2f6a8a' : 'rgba(239,231,207,0.12)'; g.fillRect(x + 12, y - 2, 6, 14);
  g.fillStyle = earned ? color : 'rgba(239,231,207,0.08)'; g.strokeStyle = earned ? '#6a4e10' : 'rgba(239,231,207,0.3)'; g.lineWidth = 2;
  g.beginPath(); g.arc(x + 12, y + 22, 11, 0, Math.PI * 2); g.fill(); g.stroke();
  if (earned) star(g, x + 12, y + 22, 6, '#fff3c0');
  g.restore();
  p.text(label, x + 30, y + 16, { size: 19, weight: 600, color: earned ? C.text : C.dim });
  p.text(sub, x + 30, y + 36, { size: 16, color: earned ? C.accent : 'rgba(239,231,207,0.4)' });
}

function stepper(p, id, x, y, w, label, key, onChange) {
  const opts = SETTING_OPTIONS[key];
  const cur = ctx.settings[key];
  let i = opts.findIndex(o => o[0] === cur);
  if (i < 0) i = 0;
  p.text(label, x, y + 36, { size: 25, color: C.text });
  const bx = x + w - 226;
  p.button(id + '-', bx, y + 6, 42, 44, '‹', () => { const n = opts[(i - 1 + opts.length) % opts.length][0]; setSetting(key, n); onChange?.(key, n); }, { size: 30 });
  p.text(opts[i][1], bx + 113, y + 37, { size: 24, align: 'center', weight: 600, color: C.accent });
  p.button(id + '+', bx + 184, y + 6, 42, 44, '›', () => { const n = opts[(i + 1) % opts.length][0]; setSetting(key, n); onChange?.(key, n); }, { size: 30 });
}

export function makeScreens(app) {
  const S = {};

  S.main = {
    render(p) {
      p.bg();
      p.eyebrow('Mallard Fusiliers · field manual', 48, 64);
      p.text('DUCK & COVER', 48, 150, { size: 92, kind: 'display', weight: 700, color: C.accent });
      p.text('Turn-based artillery from a duck’s-eye view', 50, 196, { size: 30, color: C.dim });
      const camp = ctx.save.campaign;
      const next = camp ? MISSIONS.find(m => m.id === Math.min(camp.unlocked, MISSIONS.length)) : MISSIONS[0];
      let y = 240;
      const bw = 430, bh = 70, gap = 14;
      if (camp) {
        p.button('cont', 48, y, bw, bh, camp.finished ? 'Campaign (complete)' : 'Continue campaign', () => app.show('campaign'), { primary: true }); y += bh + gap;
        p.button('newc', 48, y, bw, bh, 'New campaign', () => app.confirm('Start a new campaign? Your squad and progress will be reset.', () => { ctx.save.campaign = newCampaign(); writeSave(); app.show('campaign'); })); y += bh + gap;
      } else {
        p.button('start', 48, y, bw, bh, 'Start campaign', () => { ctx.save.campaign = newCampaign(); writeSave(); app.show('campaign'); }, { primary: true }); y += bh + gap;
      }
      p.button('skirm', 48, y, bw, bh, 'Skirmish', () => app.show('skirmish')); y += bh + gap;
      p.button('barr', 48, y, bw, bh, 'Barracks', () => app.show('barracks'), { enabled: !!camp }); y += bh + gap;
      p.button('sett', 48, y, bw / 2 - 7, bh, 'Settings', () => app.show('settings', { from: 'main' }));
      p.button('help', 48 + bw / 2 + 7, y, bw / 2 - 7, bh, 'How to play', () => app.show('howto', { from: 'main' })); y += bh + gap;
      if (ctx.isXR) p.button('exit', 48, y, bw, 56, 'Leave VR', () => app.exitVR(), { size: 26, back: true });
      // dispatch card
      const cx = 520, cy = 240, cw = 456, ch = 330;
      p.box(cx, cy, cw, ch, { fill: 'rgba(239,231,207,0.05)', border: C.line, r: 18 });
      p.eyebrow(camp ? 'Next orders' : 'First orders', cx + 28, cy + 46, C.accent);
      if (next) {
        p.text(next.name, cx + 28, cy + 96, { size: 40, kind: 'display', weight: 700 });
        p.text(`${ACTS[next.act]}`, cx + 28, cy + 134, { size: 24, color: C.dim });
        p.text(next.objective.text, cx + 28, cy + 182, { size: 27, maxW: cw - 56, lineH: 1.25 });
      }
      const done = camp ? Object.keys(camp.completed).length : 0;
      p.text(`${done} of ${MISSIONS.length} won`, cx + 28, cy + ch - 56, { size: 24, color: C.dim });
      if (camp?.points) p.text(pts(camp.points) + ' to spend', cx + cw - 28, cy + ch - 56, { size: 22, color: C.accent, align: 'right', weight: 600 });
      p.bar(cx + 28, cy + ch - 38, cw - 56, 12, done / MISSIONS.length, C.mallard);
      p.text(`${ctx.deviceLabel || ''} · ${ctx.quality?.label || ''}`, 976, 690, { size: 20, color: C.dim, align: 'right', kind: 'mono' });
    },
  };

  // The campaign map: the Pondlands, region by region. Pick a region for its mission; the Fusiliers' green
  // spreads across the map as you win.
  S.campaign = {
    render(p, st, panel) {
      const camp = ctx.save.campaign, M = campaignMap;
      p.bg();
      const ox = 26, oy = 28;
      const view = regionStates(camp);
      const hov = typeof panel?.hover === 'string' && panel.hover.startsWith('rg') ? +panel.hover.slice(2) : -1;
      const sel = st.sel ?? regionForMission(st.captured ?? Math.min(camp.unlocked, MISSIONS.length)).id;
      M.draw(p.g, ox, oy, { ...view, hover: hov, sel, captured: st.captured ?? null, finished: camp.finished });
      for (const r of REGIONS) {
        const b = M.box(r.id);
        p.hotspot('rg' + r.id, ox + b.x, oy + b.y, b.w, b.h, () => app.show('campaign', { ...st, sel: r.id }), true, (x, y) => M.regionAt(x - ox, y - oy) === r.id);
      }
      // the orders column
      const x0 = 714, W = 282;
      p.eyebrow('Campaign', x0, 64);
      p.title('Pondlands', x0, 112, 46);
      const held = view.owners.filter(o => o === 'mallard').length;
      p.text(camp.finished ? 'Every region is free' : `${held} of ${REGIONS.length} regions held`, x0, 146, { size: 20, color: C.dim });
      p.bar(x0, 158, W, 9, held / REGIONS.length, C.good);
      const r = REGIONS[sel] || REGIONS[0], m = r.mission ? MISSIONS[r.mission - 1] : null;
      const y = 214;
      if (!m) {
        p.eyebrow('Headquarters', x0, y, C.good);
        p.text('Fusilier HQ', x0, y + 40, { size: 32, kind: 'display', weight: 700, maxW: W });
        p.text('Home of the 1st Mallard Fusiliers. Spend promotion points and choose who deploys in the barracks.', x0, y + 78, { size: 21, maxW: W, lineH: 1.28, color: C.dim });
      } else {
        const won = !!camp.completed[m.id], flawless = !!camp.flawless?.[m.id], locked = m.id > camp.unlocked;
        p.eyebrow(`Mission ${m.id}`, x0, y, won ? C.good : locked ? C.dim : C.accent);
        p.text(won ? 'LIBERATED' : locked ? 'ENEMY GROUND' : 'NEXT OBJECTIVE', x0 + W, y, { size: 17, kind: 'mono', align: 'right', color: won ? C.good : locked ? C.dim : C.accent });
        let yy = y + 40;
        yy += p.text(m.name, x0, yy, { size: 30, kind: 'display', weight: 700, maxW: W, lineH: 1.08, maxLines: 2 }) - 8;
        const holder = won ? 'held by the Fusiliers' : m.enemy ? `held by the ${FACTIONS[m.enemy].name}` : 'an unclaimed training ground';
        yy += p.text(`${m.place}, ${holder}`, x0, yy + 6, { size: 19, color: C.dim, maxW: W, maxLines: 2, lineH: 1.2 });
        yy += p.text(m.objective.text, x0, yy + 18, { size: 21, maxW: W, lineH: 1.24, maxLines: 3 });
        // each mission pays out twice: once for the win, once for bringing every duck home
        medal(p, x0, yy + 22, won, 'Victory', won ? 'point earned' : '+1 point');
        medal(p, x0 + 142, yy + 22, flawless, 'All home', flawless ? 'point earned' : '+1 point', '#d8dde2');
        if (locked) p.button('brief', x0, 526, W, 58, `Win mission ${camp.unlocked} first`, null, { enabled: false, size: 22 });
        else p.button('brief', x0, 526, W, 58, won ? 'Replay mission' : 'Briefing', () => app.show('briefing', { mission: m, sel }), { primary: !won, size: 26 });
      }
      pointsBadge(p, x0, 598, camp.points);
      p.button('barr', x0 + 130, 598, W - 130, 50, 'Barracks', () => app.show('barracks', { from: 'campaign', sel }), { primary: camp.points > 0, size: 24 });
      p.button('back', x0, 658, W, 42, 'Main menu', () => app.show('main'), { size: 21, back: true });
    },
  };

  S.briefing = {
    render(p, st) {
      const m = st.mission, camp = ctx.save.campaign;
      frame(p, `Mission ${m.id} · ${m.place}`, m.name);
      p.box(48, 160, 928, 84, { fill: 'rgba(242,194,48,0.12)', border: C.accent, r: 14 });
      p.eyebrow('Objective', 72, 194, C.accent);
      p.text(m.objective.text, 72, 230, { size: 30, weight: 600 });
      p.text(m.briefing, 48, 296, { size: 27, maxW: 560, lineH: 1.32, color: C.text });
      // intel column
      const ix = 640;
      p.eyebrow('Intel', ix, 296, C.dim);
      const f = m.enemy ? FACTIONS[m.enemy] : null;
      const rows = [
        ['Enemy', f ? `${f.name} (${m.enemies.length})` : 'None'],
        ['Ground', { marsh: 'Reed marsh', farm: 'Farmland', snow: 'Snow and ice', canyon: 'Canyon', weir: 'River and weir' }[m.biome]],
        ['Wind', m.windMax === 0 ? 'Calm' : m.windMax > 6 ? 'Gale' : m.windMax > 4 ? 'Strong' : 'Light'],
        ['Squad', deployedRoster(camp).map(d => d.name).join(', ')],
      ];
      let y = 334;
      for (const [k, v] of rows) {
        p.text(k, ix, y, { size: 22, kind: 'mono', color: C.dim });
        const used = p.text(v, ix + 110, y, { size: 25, maxW: 226, lineH: 1.2 });
        y += Math.max(40, used + 8);
      }
      p.button('go', 48, 620, 360, 70, 'Deploy', () => app.startMission(m), { primary: true, size: 34 });
      p.button('squad', 426, 620, 240, 70, 'Barracks', () => app.show('barracks', { from: 'briefing', mission: m, sel: st.sel }));
      p.button('back', 684, 620, 200, 70, 'Map', () => app.show('campaign', { sel: st.sel ?? regionForMission(m.id).id }), { back: true });
    },
  };

  // kit summary for a rank, e.g. "Bazooka ∞ · Mortar ×2" (the slap and pellet rifle are always carried)
  const kitText = (rank, branch) => {
    const k = loadoutFor(rank, branch);
    return Object.keys(k).filter(w => w !== 'slap' && w !== 'rifle').map(w => `${WEAPONS[w].name} ${k[w] === Infinity ? '∞' : '×' + k[w]}`).join(' · ');
  };
  const an = (t) => (/^[AEIOU]/.test(t) ? 'an ' : 'a ') + t;
  // the light medic colour needs a darker partner on light fills
  const ink = (col) => col === BRANCHES.medic.color ? C.text : col;

  // The squad: who deploys, and where promotion points go.
  S.barracks = {
    render(p, st) {
      const camp = ctx.save.campaign;
      frame(p, 'Squad roster · up to four deploy', 'Barracks');
      const back = st.from === 'briefing' ? () => app.show('briefing', { mission: st.mission, sel: st.sel })
        : st.from === 'results' || st.from === 'campaign' ? () => app.show('campaign', { sel: st.sel, captured: st.captured })
        : () => app.show('main');
      pointsBadge(p, 612, 72, camp.points, 188, 56);
      p.button('back', 816, 72, 160, 56, 'Done', back, { size: 26, back: true });
      const cw = 452, ch = 156, rows = Math.ceil(camp.roster.length / 2), gap = rows > 2 ? 10 : 14;
      camp.roster.forEach((d, i) => {
        const x = 48 + (i % 2) * (cw + 24), y = 154 + Math.floor(i / 2) * (ch + gap);
        const col = classColor(d.rank, d.spec), promo = promotionFor(d), choose = !!(promo && promo.needsSpec), afford = canPromote(camp, d);
        p.box(x, y, cw, ch, { fill: 'rgba(239,231,207,0.05)', border: d.deploy !== false ? C.mallard : C.line, r: 16, bw: 3 });
        p.box(x + 4, y + 14, 8, ch - 28, { fill: col, r: 4 });
        // the card itself opens the duck's career tree
        p.hotspot('card' + i, x, y, cw, ch, () => app.show('career', { id: d.id, from: st }));
        p.text(displayName(d), x + 26, y + 40, { size: 28, weight: 600, maxW: 270, maxLines: 1 });
        const title = classTitle(d.rank, d.spec);
        p.text(title, x + 26, y + 70, { size: 22, weight: 700, color: ink(col) });
        const tw = p.measure(title, 22, 'body', 700);
        const branch = isRecruit(d) ? 'no career yet' : d.rank >= 5 ? `ex-${BRANCHES[d.spec].short}` : BRANCHES[d.spec].name;
        p.text(`${branch} · ${maxHpFor(d)} HP`, x + 34 + tw, y + 70, { size: 19, color: C.dim, maxW: cw - 60 - tw, maxLines: 1 });
        const next = !promo ? 'Highest rank' : choose ? 'Next: choose a career' : `Next: ${classTitle(promo.rank, d.spec)}`;
        p.text(next, x + 26, y + 104, { size: 19, color: promo && afford ? C.accent : C.dim, weight: promo && afford ? 600 : 400, maxW: 250, maxLines: 1 });
        p.text(`${d.kills} knockouts · ${d.missions} missions`, x + 26, y + 136, { size: 17, color: C.dim });
        const deployed = camp.roster.filter(r => r.deploy !== false).length;
        p.button('dep' + i, x + cw - 148, y + 12, 130, 40, d.deploy !== false ? 'Deployed' : 'Reserve', () => {
          if (d.deploy !== false) { if (deployed > 1) d.deploy = false; }
          else if (deployed < 4) d.deploy = true;
          writeSave();
        }, { size: 21, selected: d.deploy !== false });
        if (choose) p.button('car' + i, x + cw - 196, y + 88, 178, 56, 'Choose career', () => app.show('career', { id: d.id, from: st }), { size: 21, primary: afford, enabled: afford, sub: pts(promo.cost) });
        else if (promo) p.button('pr' + i, x + cw - 158, y + 88, 140, 56, 'Promote', () => {
          if (promote(camp, d)) { writeSave(); app.refreshSquad(); app.show('career', { id: d.id, from: st, promoted: true }); }
        }, { size: 21, primary: afford, enabled: afford, sub: pts(promo.cost) });
      });
      p.text('Win missions for promotion points: +1 for the win, +1 more if every duck comes home.', 48, 694, { size: 18, color: C.dim, maxW: 928, maxLines: 1 });
    },
  };

  // One duck's career tree: privates pick their career here, anyone can be promoted along it, and every
  // rank's kit and bonuses can be looked over.
  S.career = {
    render(p, st) {
      const camp = ctx.save.campaign, d = camp.roster.find(r => r.id === st.id);
      if (!d) { app.show('barracks', st.from || {}); return; }
      const promo = promotionFor(d), choosing = !!(promo && promo.needsSpec), recruit = isRecruit(d), afford = canPromote(camp, d);
      frame(p, `${displayName(d)} · ${classTitle(d.rank, d.spec)} · ${pts(camp.points)} to spend`, choosing ? 'Choose a career' : st.promoted ? 'Promoted!' : 'Career');
      p.button('back', 816, 72, 160, 56, 'Back', () => app.show('barracks', st.from || {}), { size: 26, back: true });
      const sel = st.sel || (choosing ? null : { rank: d.rank, branch: recruit ? null : d.spec });
      const same = (a, b) => a.rank === b.rank && (a.rank <= 1 || a.rank >= 5 || a.branch === b.branch);
      const mine = { rank: d.rank, branch: d.spec };
      const node = (id, x, y, w, h, rank, branch) => {
        const at = { rank, branch }, col = classColor(rank, branch);
        const isSel = (sel && same(sel, at)) || p.p.hover === id, now = same(mine, at);
        const done = rank < d.rank && (rank <= 1 || rank >= 5 || branch === d.spec);
        const closed = !recruit && rank >= 2 && rank <= 4 && branch !== d.spec;
        p.box(x, y, w, h, {
          fill: now ? 'rgba(242,194,48,0.20)' : done ? 'rgba(239,231,207,0.10)' : 'rgba(239,231,207,0.03)',
          border: isSel || now ? C.accent : done ? col : 'rgba(239,231,207,0.18)', r: 12, bw: isSel ? 4 : now ? 3 : 2,
        });
        p.text(classTitle(rank, branch), x + w / 2, y + 29, { size: 22, weight: 700, align: 'center', color: closed ? 'rgba(239,231,207,0.35)' : ink(col) });
        const tag = now ? 'NOW' : done ? '✓' : rank > 1 ? pts(RANKS[rank].cost) : '';
        p.text(`${tag}${tag ? ' · ' : ''}${hpFor(rank, branch)} HP`, x + w / 2, y + 51, { size: 15, align: 'center', color: C.dim, kind: 'mono' });
        p.hotspot(id, x, y, w, h, () => app.show('career', { ...st, promoted: false, sel: at }));
      };
      // elite ranks along the top, the four careers below them, the private at the root
      [5, 6, 7].forEach((r, k) => {
        const x = 136 + k * 268;
        if (k) p.text('›', x - 34, 186, { size: 34, color: C.dim, align: 'center' });
        node('e' + r, x, 150, 216, 60, r, d.spec);
      });
      BRANCH_ORDER.forEach((bid, c) => {
        const B = BRANCHES[bid], x = 48 + c * 236;
        p.text(B.name.toUpperCase(), x + 110, 240, { size: 16, weight: 700, align: 'center', color: !recruit && bid !== d.spec ? 'rgba(239,231,207,0.35)' : ink(B.color) });
        for (let lv = 3; lv >= 1; lv--) node(`n${bid}${lv}`, x, 250 + (3 - lv) * 68, 220, 60, lv + 1, bid);
      });
      node('r1', 412, 456, 200, 58, 1, null);
      // the chosen rank in detail
      p.box(48, 528, 928, 180, { fill: 'rgba(239,231,207,0.05)', border: C.line, r: 14 });
      if (sel) {
        const r = sel.rank, br = r <= 1 ? null : r >= 5 ? (recruit ? null : d.spec) : sel.branch, col = classColor(r, br);
        const where = r <= 1 ? 'where every duck starts' : r >= 5 ? (r === 7 ? 'the highest rank of all' : 'elite rank, open to every career') : `${BRANCHES[br].name}, level ${r - 1} of 3`;
        p.text(`${classTitle(r, br)}`, 72, 566, { size: 28, weight: 700, color: ink(col) });
        p.text(where, 80 + p.measure(classTitle(r, br), 28, 'body', 700), 566, { size: 20, color: C.dim });
        // the next step up for this duck can be bought right here
        const isNext = promo && r === promo.rank && (choosing ? r === 2 : (r >= 5 || br === d.spec));
        const wide = isNext ? 600 : 880;
        p.text('Kit  ' + kitText(r, br) + ' · Pellet rifle ∞ · Wing slap ∞', 72, 604, { size: 19, maxW: wide, maxLines: 2, lineH: 1.3 });
        const perks = perkLines(r, br);
        const blurb = r >= 2 && r <= 4 && choosing ? BRANCHES[br].blurb : perks.length ? perks.join(' · ') : r <= 1 ? 'Basic kit. One promotion point makes a private the first rank of a career.' : '';
        p.text(blurb, 72, 664, { size: 18, color: C.dim, maxW: wide, maxLines: 2, lineH: 1.3 });
        if (isNext) {
          const label = choosing ? `Become ${an(classTitle(2, br))}` : `Promote to ${classTitle(r, d.spec)}`;
          p.button('confirm', 696, 576, 258, 96, label, () => {
            if (promote(camp, d, choosing ? br : null)) { writeSave(); app.refreshSquad(); app.show('career', { id: d.id, from: st.from, promoted: true }); }
          }, { primary: afford, enabled: afford, size: label.length > 20 ? 21 : 24, sub: afford ? pts(promo.cost) : `needs ${pts(promo.cost)}` });
        } else if (choosing && r !== 2) p.text('Pick a level 1 career to choose it.', 72, 700, { size: 17, color: C.accent });
      } else p.text(choosing ? (afford ? 'Pick one of the four careers (bottom row of each column) to see its kit, then confirm. A career is for life; every career later goes on to Commando.' : 'Promoting a private to a career costs 1 promotion point. Win a mission to earn one.') : '', 72, 580, { size: 22, color: C.dim, maxW: 880, lineH: 1.3 });
    },
  };

  S.settings = {
    render(p, st) {
      frame(p, 'Comfort, controls and graphics', 'Settings');
      p.button('back', 816, 72, 160, 56, 'Done', () => app.show(st.from || 'main', st.fromState || {}), { size: 26, back: true });
      const left = [['loco', 'Movement', 'locomotion'], ['turn', 'Turning', 'turning'], ['vig', 'Comfort vignette', 'vignette'], ['hgt', 'View height', 'heightMode'], ['hand', 'Weapon hand', 'hand'], ['body', 'Your body', 'vrBody'], ['aim', 'Aim guide', 'aimGuide'], ['time', 'Turn timer', 'turnTime']];
      const right = [['diff', 'Enemy skill', 'difficulty'], ['qual', 'Graphics', 'quality'], ['fps', 'Show frame rate', 'showFps'], ['mvol', 'Master volume', 'master'], ['mus', 'Music', 'music'], ['sfx', 'Effects', 'sfx'], ['sens', 'Mouse speed', 'mouseSens']];
      left.forEach(([id, label, key], i) => stepper(p, id, 48, 156 + i * 58, 452, label, key, app.settingChanged));
      right.forEach(([id, label, key], i) => stepper(p, id, 524, 156 + i * 58, 452, label, key, app.settingChanged));
      const t = TIERS[ctx.settings.quality] || null;
      p.text(`Graphics: ${t ? t.label : 'auto, ' + ctx.quality.label}, from the next battle`, ctx.isXR ? 370 : 48, 676, { size: 22, color: C.dim });
      if (ctx.isXR) p.button('rec', 48, 646, 300, 44, 'Reset view height', () => app.recenter(), { size: 22 });
    },
  };

  S.howto = {
    render(p, st) {
      frame(p, 'Field manual', 'How to play');
      p.button('back', 816, 72, 160, 56, 'Back', () => app.show(st.from || 'main', st.fromState || {}), { size: 26, back: true });
      const vr = [
        ['R trigger', 'Hold to charge, let go to fire'],
        ['R stick ↑ ↓', 'Change weapon'],
        ['R stick ← →', 'Turn'],
        ['L stick', 'Hop: push, aim, let go'],
        ['A', 'Jump'],
        ['B (hold)', 'End your turn'],
        ['X', 'Switch duck before moving'],
        ['Y', 'Pause'],
        ['L grip', 'Big map'],
      ];
      const kb = [
        ['Mouse', 'Look and aim'],
        ['Click / F', 'Hold to charge, let go to fire'],
        ['W A S D', 'Walk (arrow keys look)'],
        ['Q / E, wheel', 'Change weapon'],
        ['Space', 'Jump'],
        ['Tab', 'Switch duck'],
        ['Enter (hold)', 'End your turn'],
        ['M', 'Big map'],
        ['Esc', 'Pause'],
      ];
      p.eyebrow('Quest controllers', 48, 180, C.accent);
      vr.forEach(([k, v], i) => { p.text(k, 48, 222 + i * 40, { size: 21, kind: 'mono', color: C.accent }); p.text(v, 206, 222 + i * 40, { size: 22, maxW: 280, maxLines: 1 }); });
      p.eyebrow('Mouse and keyboard', 524, 180, C.accent);
      kb.forEach(([k, v], i) => { p.text(k, 524, 222 + i * 40, { size: 21, kind: 'mono', color: C.accent }); p.text(v, 704, 222 + i * 40, { size: 22, maxW: 272, maxLines: 1 }); });
      p.text('Each turn one duck may go anywhere and fire once before the turn timer runs out. Explosions dig craters and knock ducks flying. Winning a mission earns a promotion point, and one more if every duck comes home: spend them in the barracks. A private’s first promotion picks a career for life, and every rank adds kit. Camouflage, sandbags, jetpacks and parachutes don’t end your turn.', 48, 590, { size: 21, maxW: 928, color: C.dim, lineH: 1.28 });
    },
  };

  S.skirmish = {
    state: { biome: 0, enemy: 0, size: 3, rank: 1, hotseat: 0 },
    render(p, st) {
      const s = S.skirmish.state;
      frame(p, 'Quick battle on a random map', 'Skirmish');
      p.button('back', 816, 72, 160, 56, 'Back', () => app.show('main'), { size: 26, back: true });
      const enemies = ['teal', 'eider', 'merganser', 'muscovy'];
      const row = (id, y, label, value, dec, inc) => {
        p.text(label, 48, y + 36, { size: 28 });
        p.button(id + '-', 520, y + 4, 52, 48, '‹', dec, { size: 30 });
        p.text(value, 760, y + 37, { size: 28, align: 'center', weight: 600, color: C.accent });
        p.button(id + '+', 924, y + 4, 52, 48, '›', inc, { size: 30 });
      };
      const cyc = (k, n, d) => () => { s[k] = (s[k] + d + n) % n; };
      row('bio', 170, 'Battlefield', BIOME_CHOICES[s.biome][1], cyc('biome', BIOME_CHOICES.length, -1), cyc('biome', BIOME_CHOICES.length, 1));
      row('ene', 240, 'Opponents', FACTIONS[enemies[s.enemy]].name, cyc('enemy', 4, -1), cyc('enemy', 4, 1));
      row('siz', 310, 'Ducks per side', String(s.size + 1), () => { s.size = clamp(s.size - 1, 1, 4); }, () => { s.size = clamp(s.size + 1, 1, 4); });
      row('rnk', 380, 'Squad rank', ['Privates', 'Career level 1', 'Career level 2', 'Career level 3', 'Commandos', 'War Heroes'][s.rank], () => { s.rank = clamp(s.rank - 1, 0, 5); }, () => { s.rank = clamp(s.rank + 1, 0, 5); });
      row('hot', 450, 'Opponent control', s.hotseat ? 'Pass and play' : 'Computer', cyc('hotseat', 2, -1), cyc('hotseat', 2, 1));
      p.text(s.hotseat ? 'Two players share one headset or keyboard and take turns.' : `Computer skill follows Settings (${ctx.settings.difficulty}).`, 48, 560, { size: 23, color: C.dim });
      p.button('go', 48, 610, 360, 76, 'Start battle', () => app.startSkirmish({
        biome: BIOME_CHOICES[s.biome][0], enemy: enemies[s.enemy], size: s.size + 1, rank: s.rank + 1, hotseat: !!s.hotseat, difficulty: ctx.settings.difficulty,
      }), { primary: true, size: 34 });
    },
  };

  S.pause = {
    render(p, st) {
      const b = ctx.battle;
      frame(p, b ? (b.mission.mode === 'campaign' ? `Mission ${b.mission.id} · ${b.mission.name}` : 'Skirmish') : 'Paused', 'Paused');
      let y = 170;
      const bw = 440, bh = 66;
      p.button('res', 48, y, bw, bh, 'Resume', () => app.resume(), { primary: true }); y += bh + 14;
      p.button('end', 48, y, bw, bh, 'End this turn', () => { app.resume(); b?.skipTurn(); }, { enabled: !!b && b.isHumanTurn() && b.phase === 'act' }); y += bh + 14;
      p.button('set', 48, y, bw, bh, 'Settings', () => app.show('settings', { from: 'pause' })); y += bh + 14;
      p.button('how', 48, y, bw, bh, 'How to play', () => app.show('howto', { from: 'pause' })); y += bh + 14;
      p.button('rst', 48, y, bw / 2 - 7, bh, 'Restart', () => app.confirm('Restart this battle from the beginning?', () => app.restartBattle(), 'pause'));
      p.button('quit', 48 + bw / 2 + 7, y, bw / 2 - 7, bh, 'Retreat', () => app.confirm('Retreat to the menu? This battle will be lost.', () => app.quitBattle(), 'pause'), { back: true });
      if (b) {
        const ox = 540;
        p.eyebrow('Objective', ox, 196, C.accent);
        p.text(b.mission.objective?.text || '', ox, 236, { size: 27, maxW: 430, lineH: 1.25 });
        let y2 = 330;
        for (const t of b.teams) {
          const alive = t.ducks.filter(d => d.alive).length;
          p.text(t.name, ox, y2, { size: 25, weight: 600, color: t.tagColor });
          p.text(`${alive} of ${t.ducks.length} standing`, ox, y2 + 32, { size: 22, color: C.dim });
          y2 += 80;
        }
      }
    },
  };

  S.confirm = {
    render(p, st) {
      p.bg();
      p.title('Are you sure?', 48, 140, 54);
      p.text(st.text, 48, 220, { size: 30, maxW: 900, lineH: 1.3 });
      p.button('yes', 48, 560, 360, 76, 'Yes', () => st.yes(), { primary: true });
      p.button('no', 428, 560, 300, 76, 'Cancel', () => app.show(st.back || 'main'), { back: true });
    },
  };

  S.results = {
    render(p, st) {
      const r = st.summary, camp = ctx.save.campaign, P = r.points;
      p.bg({ border: r.won ? C.good : C.bad });
      p.eyebrow(st.missionName || '', 48, 64);
      p.title(r.won ? 'VICTORY' : 'DEFEAT', 48, 138, 78, r.won ? C.accent : C.bad);
      p.text(r.reason, 48, 186, { size: 28, maxW: 900 });
      if (r.rows) {
        const cols = [48, 330, 440, 520];
        ['Duck', 'Damage', 'KOs', ''].forEach((h, i) => p.text(h, cols[i], 246, { size: 20, kind: 'mono', color: C.dim }));
        r.rows.forEach((row, i) => {
          const y = 290 + i * 46;
          p.text(row.name, cols[0], y, { size: 26, weight: 600, color: row.alive ? C.text : C.dim, maxW: 270, maxLines: 1 });
          p.text(String(Math.round(row.damage)), cols[1], y, { size: 26, kind: 'mono' });
          p.text(String(row.kills), cols[2], y, { size: 26, kind: 'mono' });
          p.text(row.alive ? 'came home' : 'knocked out', cols[3], y, { size: 21, color: row.alive ? C.good : C.bad });
        });
      }
      // promotion points from this mission: a medal for the win and one for bringing everyone home
      if (P) {
        const x = 676, y = 232;
        p.box(x, y, 300, 300, { fill: 'rgba(239,231,207,0.05)', border: C.line, r: 16 });
        p.eyebrow('Promotion points', x + 20, y + 34, C.accent);
        const won = r.won;
        medal(p, x + 20, y + 58, P.victory > 0, P.victory ? 'Victory' : won ? 'Victory' : 'No victory',
          P.victory ? `+${pts(P.victory)}` : P.wonBefore ? 'already won before' : 'win to earn 1 point');
        const lostTxt = P.lost === 1 ? '1 duck knocked out' : `${P.lost} ducks knocked out`;
        medal(p, x + 20, y + 118, P.survival > 0, 'All home',
          P.survival ? `+${pts(P.survival)}` : P.bonusBefore ? 'already earned before' : !won ? 'win with every duck alive' : lostTxt, '#d8dde2');
        p.rule(x + 20, y + 186, 260);
        p.text(String(camp?.points ?? P.total), x + 52, y + 248, { size: 54, kind: 'display', weight: 700, align: 'center', color: (camp?.points ?? P.total) > 0 ? C.accent : C.dim });
        p.text('to spend in', x + 96, y + 226, { size: 19, color: C.dim });
        p.text('the barracks', x + 96, y + 250, { size: 19, color: C.dim });
      }
      if (r.reward) p.text(r.reward, 48, 580, { size: 23, color: C.good, maxW: 920, maxLines: 1 });
      if (st.mode === 'campaign') {
        const captured = P?.victory ? r.missionId : null, spend = (camp?.points || 0) > 0;
        if (r.won) {
          p.button('map', 48, 612, 330, 76, 'Campaign map', () => app.afterResults('campaign', { captured }), { primary: !spend, size: 30 });
          p.button('promo', 396, 612, 330, 76, 'Promote ducks', () => app.afterResults('barracks', { captured }), { primary: spend, size: 30, enabled: spend });
        } else {
          p.button('retry', 48, 612, 300, 76, 'Try again', () => app.restartBattle(), { primary: true, size: 30 });
          p.button('map', 366, 612, 300, 76, 'Campaign map', () => app.afterResults('campaign', {}), { size: 28 });
        }
      } else {
        p.button('again', 48, 612, 340, 76, 'Play again', () => app.restartBattle(), { primary: true, size: 32 });
        p.button('menu', 406, 612, 260, 76, 'Main menu', () => app.quitBattle());
      }
    },
  };

  S.handoff = {
    render(p, st) {
      p.bg({ border: st.color });
      p.eyebrow('Pass and play', 48, 64);
      p.title(`${st.team}`, 48, 140, 58, st.color);
      p.text('Hand over the headset or keyboard. Press Ready when the next player is set.', 48, 210, { size: 30, maxW: 900, lineH: 1.3 });
      p.button('ready', 48, 560, 360, 80, 'Ready', () => app.handoffReady(), { primary: true, size: 34 });
    },
  };

  S.loading = {
    render(p, st) {
      p.bg();
      p.eyebrow('Deploying', 48, 64);
      p.title(st.title || 'Loading', 48, 150, 64);
      p.text(st.sub || 'Digging trenches…', 48, 210, { size: 30, color: C.dim });
    },
  };

  return S;
}
