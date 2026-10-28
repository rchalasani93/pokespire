// Core Pokémon mechanics: stats, natures, experience, level-up moves, evolution, catching.
// Formulas follow the main-series games (Gen 5+ where they differ).
import { DEX, MOVES, movesAtLevel, movesLearnedAt } from './data.js';

/** A chosen starter's moves: like the games, plus any moves its species learns on evolution. */
export function starterMoves(id, lv) {
  const evo = movesLearnedAt(id, 0).filter(m => MOVES[m]).slice(0, 4);
  const rest = movesAtLevel(id, lv).filter(m => !evo.includes(m));
  const out = [...evo, ...rest.slice(Math.max(0, rest.length - (4 - evo.length)))];
  return out.some(m => MOVES[m].c !== 'S') ? out : movesAtLevel(id, lv);
}

export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_LABELS = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];

export const NATURES = ['Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
  'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
  'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky'];
const NATURE_STAT = [1, 2, 5, 3, 4]; // atk, def, spe, spa, spd
export function natureMod(nature, statIdx) {
  const up = NATURE_STAT[Math.floor(nature / 5)], down = NATURE_STAT[nature % 5];
  if (up === down) return 1;
  return statIdx === up ? 1.1 : statIdx === down ? 0.9 : 1;
}

export const STAT_SHORT = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
/** e.g. "Adamant (+Atk, −SpA)" or "Hardy (neutral)" */
export function natureLabel(n) {
  const up = NATURE_STAT[Math.floor(n / 5)], down = NATURE_STAT[n % 5];
  return up === down ? `${NATURES[n]} (neutral)` : `${NATURES[n]} (+${STAT_SHORT[up]}, −${STAT_SHORT[down]})`;
}
/** The games' IV judge wording (Scarlet/Violet). */
export function ivJudge(v) {
  return v === 31 ? 'Best' : v === 30 ? 'Fantastic' : v >= 26 ? 'Very good' : v >= 16 ? 'Pretty good' : v >= 1 ? 'Decent' : 'No good';
}

export const rand = n => Math.floor(Math.random() * n);
export const pick = arr => arr[rand(arr.length)];
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------- Experience ----------
export function expForLevel(rate, n) {
  if (n <= 1) return 0;
  const n3 = n ** 3;
  switch (rate) {
    case 'fast': return Math.floor(4 * n3 / 5);
    case 'slow': return Math.floor(5 * n3 / 4);
    case 'mediumslow': return Math.max(0, Math.floor(6 / 5 * n3 - 15 * n * n + 100 * n - 140));
    case 'erratic':
      if (n < 50) return Math.floor(n3 * (100 - n) / 50);
      if (n < 68) return Math.floor(n3 * (150 - n) / 100);
      if (n < 98) return Math.floor(n3 * Math.floor((1911 - 10 * n) / 3) / 500);
      return Math.floor(n3 * (160 - n) / 100);
    case 'fluctuating':
      if (n < 15) return Math.floor(n3 * (Math.floor((n + 1) / 3) + 24) / 50);
      if (n < 36) return Math.floor(n3 * (n + 14) / 50);
      return Math.floor(n3 * (Math.floor(n / 2) + 32) / 50);
    default: return n3; // medium (fast)
  }
}

/** Gen 7+ experience formula. `share` = true for Exp. Share recipients that did not battle. */
export function expYield(defeated, receiverLevel, { trainer = false, share = false } = {}) {
  const b = DEX[defeated.id].xp;
  const L = defeated.lv;
  const scaled = (b * L / 5) * (share ? 0.5 : 1) * Math.pow((2 * L + 10) / (L + receiverLevel + 10), 2.5);
  return Math.max(1, Math.floor((Math.floor(scaled) + 1) * (trainer ? 1.5 : 1)));
}

// ---------- Stats ----------
export function calcStats(mon) {
  // A battle form (Mega Evolution, Primal Reversion) brings its own base stats
  const base = mon.bf?.b || DEX[mon.id].b;
  return base.map((b, i) => {
    const core = Math.floor((2 * b + mon.iv[i] + Math.floor(mon.ev[i] / 4)) * mon.lv / 100);
    if (i === 0) return mon.id === 292 ? 1 : core + mon.lv + 10; // Shedinja always has 1 HP
    return Math.floor((core + 5) * natureMod(mon.nat, i));
  });
}
// Dynamax doubles HP (Dynamax Level 10)
export const maxHp = mon => calcStats(mon)[0] * (mon.bf?.dmax ? 2 : 1);
/** Types in battle: Terastallized Pokémon have only their Tera Type defensively. */
export const typesOf = mon => (mon.bf?.tera ? [mon.bf.tera] : mon.bf?.t || DEX[mon.id].t);
/** Tera Type: one of the species' own types unless changed with a Tera Shard. */
export const teraType = mon => mon.tt || DEX[mon.id].t[0];

export function addEvs(mon, defeatedId) {
  const y = DEX[defeatedId].ev;
  let total = mon.ev.reduce((a, b) => a + b, 0);
  STAT_KEYS.forEach((k, i) => {
    const add = Math.min(y[k] || 0, 252 - mon.ev[i], 510 - total);
    if (add > 0) { mon.ev[i] += add; total += add; }
  });
}

// ---------- Creation ----------
export function createMon(id, lv, { perfectIvs = 0, moves = null, shinyOdds = 4096 } = {}) {
  const sp = DEX[id];
  const iv = STAT_KEYS.map(() => rand(32));
  // Guarantee some 31 IVs (legendaries/elite Pokémon, like the games' fixed-IV encounters)
  const idx = [0, 1, 2, 3, 4, 5].sort(() => Math.random() - 0.5);
  for (let i = 0; i < perfectIvs; i++) iv[idx[i]] = 31;
  const mon = {
    uid: uid(), id, lv, exp: expForLevel(sp.gr, lv), nat: rand(25), iv, ev: [0, 0, 0, 0, 0, 0],
    st: null, sl: 0, fr: sp.bh, shiny: rand(shinyOdds) === 0,
    ab: Math.random() < 0.05 && sp.h ? sp.h : pick(sp.a),
    tt: pick(sp.t),
    moves: (moves || movesAtLevel(id, lv)).map(m => ({ id: m, pp: MOVES[m].pp })),
  };
  mon.hp = maxHp(mon);
  return mon;
}

export const monName = mon => mon.nick || DEX[mon.id].n;

export function healMon(mon) {
  mon.hp = maxHp(mon);
  mon.st = null; mon.sl = 0;
  mon.moves.forEach(m => { m.pp = MOVES[m.id].pp; });
}

// ---------- Leveling ----------
/**
 * Adds experience and processes level-ups.
 * Returns events: [{type:'level', lv}, {type:'learn', move}, {type:'learnFull', move}]
 * Moves are auto-learned while there is a free slot; otherwise a 'learnFull' event asks the player.
 */
export function gainExp(mon, amount) {
  const sp = DEX[mon.id];
  const events = [];
  if (mon.lv >= 100) return events;
  mon.exp = Math.min(mon.exp + amount, expForLevel(sp.gr, 100));
  while (mon.lv < 100 && mon.exp >= expForLevel(sp.gr, mon.lv + 1)) {
    events.push(...levelUp(mon));
  }
  return events;
}

export function levelUp(mon) {
  const before = maxHp(mon);
  mon.lv += 1;
  if (mon.exp < expForLevel(DEX[mon.id].gr, mon.lv)) mon.exp = expForLevel(DEX[mon.id].gr, mon.lv);
  if (mon.hp > 0) mon.hp += maxHp(mon) - before;
  mon.fr = Math.min(255, mon.fr + (mon.fr < 100 ? 5 : mon.fr < 200 ? 4 : 3));
  const events = [{ type: 'level', lv: mon.lv }];
  for (const m of movesLearnedAt(mon.id, mon.lv)) events.push(tryLearn(mon, m));
  return events.filter(Boolean);
}

export function tryLearn(mon, moveId) {
  if (!MOVES[moveId] || mon.moves.some(m => m.id === moveId)) return null;
  if (mon.moves.length < 4) {
    mon.moves.push({ id: moveId, pp: MOVES[moveId].pp });
    return { type: 'learn', move: moveId };
  }
  return { type: 'learnFull', move: moveId };
}

export function replaceMove(mon, slot, moveId) {
  mon.moves[slot] = { id: moveId, pp: MOVES[moveId].pp };
}

// ---------- Evolution ----------
const isDay = () => { const h = new Date().getHours(); return h >= 6 && h < 18; };

function condOk(evo, mon, party) {
  const c = evo.cond || '';
  if (c.includes('during the day') && !isDay()) return false;
  if (c.includes('at night') && isDay()) return false;
  if (c.includes('Atk stat >') || c.includes('Atk stat <') || c.includes('equal')) {
    const s = calcStats(mon);
    if (c.includes('>')) return s[1] > s[2];
    if (c.includes('<')) return s[1] < s[2];
    return s[1] === s[2];
  }
  if (c.includes('Dark-type in the party')) return party.some(p => p !== mon && DEX[p.id].t.includes('Dark'));
  if (c.includes('Fairy-type move')) return mon.moves.some(m => MOVES[m.id].t === 'Fairy');
  return true;
}

/** Evolutions that need special circumstances we can't recreate are unlocked with a Linking Cord. */
export function evoItemFor(evo) {
  if (evo.type === 'useItem' || evo.type === 'levelHold') return evo.item;
  if (evo.type === 'trade') return evo.item || 'Linking Cord';
  if (evo.type === 'other' || (evo.type === 'levelExtra' && !evo.cond?.includes('Fairy'))) return 'Linking Cord';
  return null;
}

/** Check a level-up evolution (called after a level-up). Returns target species id or null. */
export function levelEvolution(mon, party = []) {
  const options = (DEX[mon.id].e || []).filter(evo => {
    if (evoItemFor(evo)) return false;
    if (!evo.type || evo.type === 'level') return evo.level && mon.lv >= evo.level && condOk(evo, mon, party);
    if (evo.type === 'levelFriendship') return mon.fr >= 160 && condOk(evo, mon, party);
    if (evo.type === 'levelMove') return mon.moves.some(m => m.id === evo.move);
    if (evo.type === 'levelExtra') return mon.fr >= 160 && condOk(evo, mon, party); // Sylveon
    return false;
  });
  return options.length ? pick(options).to : null; // e.g. Wurmple's branch is random, like its personality value
}

/** Evolution triggered by using an item from the bag. */
export function itemEvolution(mon, itemName) {
  const evo = (DEX[mon.id].e || []).find(e => evoItemFor(e) === itemName);
  return evo ? evo.to : null;
}

/** Evolves in place. Returns move events (evolution moves and moves for the new species at this level). */
export function evolve(mon, toId) {
  const before = maxHp(mon);
  mon.id = toId;
  if (mon.hp > 0) mon.hp = Math.max(1, mon.hp + maxHp(mon) - before);
  const sp = DEX[toId];
  if (!sp.a.includes(mon.ab) && mon.ab !== sp.h) mon.ab = pick(sp.a);
  const events = [];
  for (const m of [...movesLearnedAt(toId, 0), ...movesLearnedAt(toId, mon.lv)]) {
    const e = tryLearn(mon, m);
    if (e) events.push(e);
  }
  return events;
}

/** Walk the evolution line so a species fits a level (used for trainer/wild Pokémon). */
export function stageForLevel(id, lv) {
  // Devolve while the requirement is above the level
  for (let guard = 0; guard < 3; guard++) {
    const sp = DEX[id];
    if (!sp.p) break;
    const evo = (DEX[sp.p].e || []).find(e => e.to === id);
    if (lv >= evoThreshold(sp.p, evo)) break;
    id = sp.p;
  }
  // Evolve while possible
  for (let guard = 0; guard < 3; guard++) {
    const evos = (DEX[id].e || []).filter(e => lv >= evoThreshold(id, e));
    if (!evos.length) break;
    id = pick(evos).to;
  }
  return id;
}
function evoThreshold(fromId, evo) {
  if (!evo) return 0;
  if (evo.level) return evo.level;
  // Item/trade/friendship evolutions: about where trainers in the games start using them
  const prevLv = (DEX[DEX[fromId].p]?.e || []).find(e => e.to === fromId)?.level || 0;
  if (evo.type === 'levelFriendship') return Math.max(22, prevLv + 8);
  return Math.max(prevLv + 12, DEX[fromId].p ? 36 : 30);
}

// ---------- Catching (Gen 5+ formula) ----------
export const BALLS = {
  'Poké Ball': 1, 'Great Ball': 1.5, 'Ultra Ball': 2, 'Quick Ball': 1, 'Dusk Ball': 1, 'Master Ball': 255,
};
export function catchAttempt(target, ballName, turn) {
  if (ballName === 'Master Ball') return { caught: true, shakes: 3 };
  let ball = BALLS[ballName] || 1;
  if (ballName === 'Quick Ball' && turn <= 1) ball = 5;
  if (ballName === 'Dusk Ball' && !isDay()) ball = 3;
  const max = maxHp(target);
  const statusBonus = target.st === 'slp' || target.st === 'frz' ? 2.5 : target.st ? 1.5 : 1;
  const a = ((3 * max - 2 * target.hp) * DEX[target.id].cr * ball) / (3 * max) * statusBonus;
  if (a >= 255) return { caught: true, shakes: 3 };
  const b = 65536 / Math.pow(255 / a, 3 / 16);
  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    if (Math.random() * 65536 >= b) return { caught: false, shakes: Math.min(shakes, 3) };
    shakes++;
  }
  return { caught: true, shakes: 3 };
}
