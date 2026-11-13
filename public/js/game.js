// Run structure: three acts of branching map nodes, encounters, rewards and progression.
import { DEX, MOVES, FORMS, MACHINES, REGIONS, idOf, movesAtLevel, regionOf, familyRoot, eggMovesFor } from './data.js';
import { createMon, stageForLevel, healMon, rand, pick, uid, maxHp, expForLevel, evoItemFor, starterMoves } from './mechanics.js';
import {
  ITEMS, DIFFICULTIES, diffOf, CLASSIC, GAME_MODES, modeOf, TRAINER_CLASSES, TRAINER_NAMES, GYM_LEADERS, VILLAINS, ELITE_FOUR, CHAMPIONS, STONE_LIST, EVO_ITEM_LIST,
  TYPE_BOOSTERS, Z_CRYSTALS, KEY_ITEMS, TYPE_LIST, MINT_NATURES, TM_BY_MOVE,
} from './content.js';

export const ACTS = [
  { name: 'Act I · Route of Beginnings', from: 3, to: 14, boss: 'gym', bossLv: 16 },
  { name: 'Act II · The Shadow Syndicate', from: 15, to: 27, boss: 'gym', bossLv: 30 },
  // Act III ends with a Gym Leader, then the Elite Four and the Champion
  { name: 'Act III · Victory Road', from: 28, to: 39, boss: 'gymLeague', bossLv: 41 },
];
export const ROWS = 12; // rows 0..10 are regular, row 11 is the boss
const COLS = 7;

export const NODE_INFO = {
  wild: { icon: '🌿', label: 'Wild Pokémon', desc: 'A random wild Pokémon. Catch it or defeat it.' },
  trainer: { icon: '🧢', label: 'Trainer', desc: 'A Pokémon Trainer challenges you. Earn prize money.' },
  villain: { icon: '💀', label: 'Villain Team', desc: 'Grunts or admins of an evil team block the way.' },
  elite: { icon: '⭐', label: 'Elite Pokémon', desc: 'A powerful wild Pokémon with superior stats. Rare rewards.' },
  gym: { icon: '🏅', label: 'Gym Battle', desc: 'A Gym Leader from any region. Win a badge.' },
  villainBoss: { icon: '☠️', label: 'Villain Boss', desc: 'The villain team\'s leader. Beat them for a big reward.' },
  legendary: { icon: '✨', label: 'Legendary Pokémon', desc: 'A Legendary Pokémon appears! Your chance to catch it.' },
  tutor: { icon: '📖', label: 'Move Tutor', desc: 'Teach new moves for a fee, or relearn old ones for free.' },
  stop: { icon: '📖', label: 'Move Tutor', desc: 'Teach new moves for a fee, or relearn old ones for free.' }, // old saves
  mart: { icon: '🏪', label: 'PokéMart', desc: 'Buy Poké Balls, medicine and evolution items.' },
  center: { icon: '🏥', label: 'Pokémon Center', desc: 'Fully heal your team and use the PC Box.' },
  recruit: { icon: '🔴', label: 'Poké Ball', desc: 'Three Pokémon are offered. Recruit one of them.' },
  boss: { icon: '👑', label: 'Boss', desc: 'The act boss.' },
};

// ---------- Map seeds ----------
// A seed fixes each act's map layout and node types, so a route can be shared or replayed.
// Battles, offers and rewards stay random.
export const SEED_RE = /^[A-Z0-9-]{1,16}$/;
export function normalizeSeed(s) {
  const v = String(s ?? '').trim().toUpperCase();
  return SEED_RE.test(v) ? v : null;
}
export const randomSeed = () => Math.floor(Math.random() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0');
export const dailySeed = (d = new Date()) => `D-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
/** Small deterministic generator (mulberry32) seeded from a string. */
export function seededRng(str) {
  let h = 1779033703 ^ str.length;
  for (const c of str) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Species pools ----------
let pools = null;
function getPools() {
  if (pools) return pools;
  const all = Object.values(DEX);
  const special = s => s.L || s.M || s.U || s.X;
  const normal = all.filter(s => !special(s));
  const byType = {};
  for (const s of normal) for (const t of s.t) (byType[t] ||= []).push(s.id);
  pools = {
    wildBase: normal.filter(s => !s.p && !s.baby).map(s => s.id),
    byType,
    eliteFinal: normal.filter(s => !s.e && s.b.reduce((a, b) => a + b, 0) >= 470).map(s => s.id),
    subLegends: all.filter(s => s.L && s.b.reduce((a, b) => a + b, 0) <= 600).map(s => s.id),
    legends: all.filter(s => (s.L || s.M) && !s.p).map(s => s.id),
  };
  return pools;
}

export function rowLevel(act, row) {
  const a = ACTS[act - 1];
  return Math.round(a.from + (a.to - a.from) * Math.min(row, 10) / 10);
}

// ---------- New run ----------
/** A starter's moves: the egg moves picked (up to 4), then its usual Lv 5 moves in the free slots. */
export function starterMoveset(id, picked = []) {
  const pool = new Set(eggMovesFor(id));
  const chosen = [...new Set((Array.isArray(picked) ? picked : []).filter(m => pool.has(m) && MOVES[m]))].slice(0, 4);
  // Free slots keep the usual moves, attacking ones first and the most recently learned first
  const usual = starterMoves(id, 5);
  const base = usual.filter(m => !chosen.includes(m));
  const fill = chosen.length ? [...base].reverse().sort((x, y) => (MOVES[x].c === 'S') - (MOVES[y].c === 'S')) : base;
  const out = [...chosen, ...fill].slice(0, 4);
  // Never start without an attacking move
  if (!out.some(m => MOVES[m].c !== 'S')) {
    const atk = base.find(m => MOVES[m].c !== 'S') || movesAtLevel(id, 5).find(m => MOVES[m]?.c !== 'S');
    if (atk) out[Math.min(out.length, 3)] = atk;
  }
  return out;
}

export function newRun(starterId, difficulty = 'medium', mode = 'classic', choice = {}) {
  const starter = createMon(starterId, 5, { moves: starterMoveset(starterId, choice.moves) });
  starter.fr = 70;
  if (Number.isInteger(choice.nat) && choice.nat >= 0 && choice.nat < 25) starter.nat = choice.nat;
  if (choice.ab && [...DEX[starterId].a, DEX[starterId].h].includes(choice.ab)) starter.ab = choice.ab;
  if (choice.shiny) starter.shiny = true;
  starter.hp = maxHp(starter);
  const diff = DIFFICULTIES[difficulty] ? difficulty : 'medium';
  const seed = normalizeSeed(choice.seed) || randomSeed();
  const run = {
    v: 1, id: uid(), startedAt: new Date().toISOString(), starter: starterId, difficulty: diff,
    mode: GAME_MODES[mode] ? mode : 'classic', region: regionOf(starterId), seed,
    act: 1, map: generateMap(1, seed), pos: null, visited: [],
    party: [starter], box: [], bag: { ...DIFFICULTIES[diff].bag }, money: 100, fallen: [],
    badges: [], beatenGyms: [], caught: [], league: null, battle: null, node: null,
    stats: { battles: 0, wins: 0, caught: 0, nodes: 0 }, score: 0,
  };
  return run;
}

// ---------- Map generation (branching paths, Slay-the-Spire style) ----------
export function generateMap(act, seed = null) {
  const rng = seed ? seededRng(`${seed}|${act}`) : Math.random;
  const rand = n => Math.floor(rng() * n);
  const pick = arr => arr[rand(arr.length)];
  const nodes = {};
  const key = (r, c) => `${r}-${c}`;
  const edges = new Set();
  const starts = [];
  for (let p = 0; p < 6; p++) {
    let c = p < 2 ? (p === 0 ? rand(3) : 4 + rand(3)) : rand(COLS);
    starts.push(c);
    for (let r = 0; r < ROWS - 1; r++) {
      nodes[key(r, c)] ||= { id: key(r, c), r, c, next: [] };
      if (r === ROWS - 2) { edges.add(`${key(r, c)}>boss`); break; }
      let nc = Math.max(0, Math.min(COLS - 1, c + rand(3) - 1));
      // Don't let paths cross
      if (nc !== c && edges.has(`${key(r, nc)}>${key(r + 1, c)}`)) nc = c;
      edges.add(`${key(r, c)}>${key(r + 1, nc)}`);
      c = nc;
    }
  }
  nodes.boss = { id: 'boss', r: ROWS - 1, c: 3, next: [], type: 'boss' };
  for (const e of edges) {
    const [a, b] = e.split('>');
    if (!nodes[a].next.includes(b)) nodes[a].next.push(b);
  }
  // Assign node types
  const parents = {};
  for (const n of Object.values(nodes)) for (const b of n.next) (parents[b] ||= []).push(n.id);
  const ordered = Object.values(nodes).filter(n => n.id !== 'boss').sort((a, b) => a.r - b.r);
  const weights = r => ({
    wild: 24, trainer: 20, villain: act >= 2 ? 12 : 8, elite: r >= 3 ? 7 : 0, gym: r >= 3 ? 6 : 0,
    tutor: 9, mart: r >= 2 ? 7 : 3, center: r >= 3 && r <= 8 ? 7 : 0, recruit: act === 1 ? 9 : 7,
  });
  let gyms = 0;
  for (const n of ordered) {
    if (n.r === 0) { n.type = 'wild'; continue; }
    if (n.r === ROWS - 2) { n.type = 'center'; continue; }
    for (let tries = 0; tries < 20; tries++) {
      const w = weights(n.r);
      if (gyms >= 2) w.gym = 0;
      const t = weighted(w, rng);
      const parentTypes = (parents[n.id] || []).map(p => nodes[p].type);
      if (['tutor', 'mart', 'center', 'gym', 'elite', 'recruit'].includes(t) && parentTypes.includes(t)) continue;
      n.type = t;
      break;
    }
    n.type ||= 'wild';
    if (n.type === 'gym') gyms++;
  }
  // Exactly one Legendary encounter per act, in the middle rows
  const mid = ordered.filter(n => n.r >= 4 && n.r <= 8 && n.type !== 'gym');
  if (mid.length) pick(mid).type = 'legendary';
  // Act II: the villain team's boss waits on the later floors (every act now ends with a Gym Leader)
  if (act === 2) {
    const late = ordered.filter(n => n.r >= 6 && n.r <= 9 && !['gym', 'legendary', 'center'].includes(n.type));
    const villains = late.filter(n => n.type === 'villain');
    const spot = villains.length ? pick(villains) : late.length ? pick(late) : null;
    if (spot) spot.type = 'villainBoss';
  }
  return { act, nodes };
}

function weighted(w, rng = Math.random) {
  const entries = Object.entries(w).filter(([, v]) => v > 0);
  let x = rng() * entries.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of entries) { if ((x -= v) < 0) return k; }
  return entries[0][0];
}

export function availableNodes(run) {
  const { nodes } = run.map;
  if (!run.pos) return Object.values(nodes).filter(n => n.r === 0).map(n => n.id);
  return nodes[run.pos]?.next || [];
}

// ---------- Team building ----------
// Wild shiny odds: 1 in 512 (the games use 1 in 4,096; a run has far fewer encounters)
export const WILD_SHINY_ODDS = 512;

function makeTrainerMon(nameOrId, lv, { perfectIvs = 0, shinyOdds = 4096 } = {}) {
  const id0 = typeof nameOrId === 'number' ? nameOrId : idOf(nameOrId);
  const id = stageForLevel(id0, lv);
  const mon = createMon(id, lv, { perfectIvs, shinyOdds });
  mon.fr = 255;
  return mon;
}

/** Take the last `size` Pokémon of a signature team, levels rising to the ace. */
function teamFrom(list, size, baseLv, aceBonus, opts = {}) {
  const chosen = list.slice(-size);
  return chosen.map((n, i) => makeTrainerMon(n, Math.min(100, baseLv + (i === chosen.length - 1 ? aceBonus : Math.floor(i / 2))), opts));
}

// ---------- Classic vs Randomized ----------
const isClassic = run => modeOf(run) === 'classic';
export const runRegion = run => REGIONS[run.region ?? regionOf(run.starter)].name;
const classicOf = run => CLASSIC[runRegion(run)];

/** In Classic mode keep only Pokémon from the run's region (falls back to everything if too few). */
// Wild Pokémon, Elite Pokémon, Legendaries and Trainers' Pokémon come from every region in both modes
const regional = (run, list) => list;

function randomOfTypes(run, types) {
  const p = getPools();
  const pool = types ? regional(run, [...new Set(types.flatMap(t => p.byType[t] || []))]) : [];
  return pick(pool.length ? pool : p.wildBase);
}

/** A fully random team for Randomized mode, levels rising to the ace. */
function randomTeam(size, baseLv, aceBonus, opts = {}) {
  const base = getPools().wildBase;
  return Array.from({ length: size }, (_, i) => makeTrainerMon(pick(base), Math.min(100, baseLv + (i === size - 1 ? aceBonus : Math.floor(i / 2))), opts));
}

/** Signature team in Classic mode, randomized team in Randomized mode. */
const bossTeam = (run, list, size, baseLv, aceBonus, opts) =>
  isClassic(run) ? teamFrom(list, size, baseLv, aceBonus, opts) : randomTeam(size, baseLv, aceBonus, opts);

function pickVillain(run) {
  if (!isClassic(run)) return pick(VILLAINS);
  const team = pick(classicOf(run).villains);
  return VILLAINS.find(v => v.team === team);
}

// ---------- Encounters ----------
export function buildEncounter(run, node) {
  const act = run.act;
  const lv = rowLevel(act, node.r);
  const P = getPools();
  const teamSize = (min, max) => min + rand(max - min + 1);

  switch (node.type) {
    case 'wild': {
      const L = Math.max(2, lv - 1 + rand(3));
      const mon = makeTrainerMon(pick(regional(run, P.wildBase)), L, { shinyOdds: WILD_SHINY_ODDS });
      mon.fr = DEX[mon.id].bh;
      return { kind: 'wild', enemy: [mon], canCatch: true, canRun: true, ai: 0 };
    }
    case 'elite': {
      const L = lv + 4;
      const id = pick(regional(run, P.eliteFinal));
      const mon = createMon(id, L, { perfectIvs: 3, shinyOdds: WILD_SHINY_ODDS });
      mon.elite = true;
      return { kind: 'elite', enemy: [mon], canCatch: true, canRun: true, ai: 1, intro: `A towering Elite ${DEX[mon.id].n} blocks the path!` };
    }
    case 'legendary': {
      // Any region's Legendaries (lighter ones in Act I); no repeats within a run while others are left
      const pool0 = act === 1 ? P.subLegends : P.legends;
      const fresh = pool0.filter(x => !(run.legendsSeen || []).includes(x));
      const id = pick(fresh.length ? fresh : pool0);
      (run.legendsSeen ||= []).push(id);
      const L = lv + 6;
      const mon = createMon(id, L, { perfectIvs: 3, shinyOdds: WILD_SHINY_ODDS });
      return { kind: 'legendary', enemy: [mon], canCatch: true, canRun: true, ai: 1, intro: `The Legendary ${DEX[id].n} appeared!` };
    }
    case 'trainer': {
      const cls = pick(TRAINER_CLASSES.filter(c => c.minAct <= act));
      const size = act === 1 ? teamSize(1, 2) : act === 2 ? teamSize(2, 3) : teamSize(3, 4);
      const enemy = Array.from({ length: size }, (_, i) => makeTrainerMon(randomOfTypes(run, isClassic(run) ? cls.types : null), lv + (i === size - 1 ? 1 : 0)));
      const maxLv = Math.max(...enemy.map(m => m.lv));
      return {
        kind: 'trainer', enemy, ai: act >= 2 ? 2 : 1,
        trainer: { name: pick(TRAINER_NAMES), title: cls.title, sprite: cls.sprite, prize: Math.round(cls.pay * maxLv / 4) },
      };
    }
    case 'villain': {
      const v = pickVillain(run);
      const admin = Math.random() < 0.3;
      const size = admin ? teamSize(3, 4) : teamSize(2, 3);
      const L = lv + (admin ? 2 : 1);
      const pool = isClassic(run) ? v.pool : getPools().wildBase;
      const enemy = Array.from({ length: size }, () => makeTrainerMon(pick(pool), L - rand(2)));
      return {
        kind: 'villain', enemy, ai: admin ? 2 : 1,
        trainer: { name: admin ? pick(v.admins) : 'Grunt', title: admin ? `${v.team} Admin` : v.team, sprite: v.grunt, prize: (admin ? 25 : 15) * L, quote: v.quote, team: v.team },
      };
    }
    case 'gym': {
      const leader = pickGym(run);
      const size = act === 1 ? 2 + rand(2) : act === 2 ? 3 + rand(2) : 4 + rand(2);
      const enemy = bossTeam(run, leader.team, size, lv + 1, 3, { perfectIvs: act });
      return gymSpec(leader, enemy);
    }
    case 'villainBoss': return villainBossEncounter(run, lv + 3);
    case 'boss': return bossEncounter(run);
  }
  return null;
}

function pickGym(run) {
  if (isClassic(run)) {
    // The region's Gym Leaders in their original order; rematches once all eight are beaten
    const region = runRegion(run);
    const order = classicOf(run).gyms.map(n => GYM_LEADERS.find(g => g.name === n && g.region === region));
    return order.find(g => !run.beatenGyms.includes(g.name)) || pick(order);
  }
  const options = GYM_LEADERS.filter(g => !run.beatenGyms.includes(g.name));
  return pick(options.length ? options : GYM_LEADERS);
}
function gymSpec(leader, enemy) {
  const ace = Math.max(...enemy.map(m => m.lv));
  return {
    kind: 'gym', enemy, ai: 2, fullRestores: 1,
    trainer: { name: leader.name, title: leader.title || `${leader.region} Gym Leader`, sprite: leader.sprite, prize: 25 * ace, badge: `${leader.badge} Badge`, leader: leader.name, type: leader.type },
  };
}

/** The villain team's boss: ace at `aceLv`. */
export function villainBossEncounter(run, aceLv) {
  const v = pickVillain(run);
  const enemy = bossTeam(run, v.boss.team, 4, aceLv - 3, 3, { perfectIvs: 3 });
  return {
    kind: 'villainBoss', enemy, ai: 2, fullRestores: 1,
    trainer: { name: v.boss.name, title: v.boss.title, sprite: v.boss.sprite, prize: 40 * aceLv, quote: 'This is not the end...', team: v.team },
  };
}

/** Every act ends with a Gym Leader; bigger teams in later acts. */
export function bossEncounter(run) {
  const a = ACTS[run.act - 1];
  if (a.boss === 'villainBoss') return villainBossEncounter(run, a.bossLv); // runs saved before every act ended with a Gym
  const leader = pickGym(run);
  const size = run.act === 1 ? 3 : run.act === 2 ? 4 : 5;
  return gymSpec(leader, bossTeam(run, leader.team, size, a.bossLv - 3, 3, { perfectIvs: run.act + 1 }));
}
/** The Gym Leader who'll be faced next (Classic: the region's next Gym; Randomized: decided at the battle). */
export function nextGymLeader(run) {
  return isClassic(run) ? pickGym(run) : null;
}

// ---------- Map node art (sprites instead of emoji, like PokéRez) ----------
const ITEM_ART = { wild: 'revival-herb', elite: 'star-piece', legendary: 'master-ball', tutor: 'tm-normal', stop: 'tm-normal', recruit: 'poke-ball' };
const MON_ART = { mart: 52, center: 113 }; // Meowth runs the shop, Chansey the Pokémon Center
/** What a map node shows: { item | mon | trainer } plus a name for its sprite. */
export function nodeArt(run, node) {
  const t = node.type;
  if (ITEM_ART[t]) return { kind: 'item', name: ITEM_ART[t] };
  if (MON_ART[t]) return { kind: 'mon', id: MON_ART[t] };
  if (t === 'trainer') return { kind: 'trainer', name: 'youngster' };
  const villain = isClassic(run) ? VILLAINS.find(v => v.team === classicOf(run).villains[0]) : null;
  if (t === 'villain') return { kind: 'trainer', name: villain?.grunt || 'rocketgrunt' };
  if (t === 'villainBoss') return { kind: 'trainer', name: villain?.boss.sprite || 'giovanni' };
  if (t === 'gym' || t === 'boss') return { kind: 'trainer', name: nextGymLeader(run)?.sprite || 'acetrainer' };
  return { kind: 'item', name: 'poke-ball' };
}

// ---------- Pokémon League (Act III boss) ----------
export function startLeague(run) {
  if (isClassic(run)) {
    const c = classicOf(run), region = runRegion(run);
    const members = c.e4.map(n => (ELITE_FOUR.find(e => e.name === n && e.region === region) || ELITE_FOUR.find(e => e.name === n)))
      .map(e => e.name + '|' + e.region);
    const champ = CHAMPIONS.find(x => x.name === c.champion);
    run.league = { stage: 0, members, champion: champ.name + '|' + champ.region };
    return;
  }
  const members = [];
  const used = new Set();
  const shuffled = [...ELITE_FOUR].sort(() => Math.random() - 0.5);
  for (const m of shuffled) {
    if (used.has(m.name) || used.has(m.type)) continue;
    members.push(m.name + '|' + m.region);
    used.add(m.name); used.add(m.type);
    if (members.length === 4) break;
  }
  const champ = pick(CHAMPIONS);
  run.league = { stage: 0, members, champion: champ.name + '|' + champ.region };
}

export function leagueOpponent(run) {
  const L = run.league;
  const base = ACTS[2].bossLv;
  if (L.stage < 4) {
    const [name, region] = L.members[L.stage].split('|');
    const m = ELITE_FOUR.find(e => e.name === name && e.region === region);
    return { info: m, title: m.title || 'Elite Four', spec: () => ({
      kind: 'e4', enemy: bossTeam(run, m.team, 5, base + L.stage, 2, { perfectIvs: 4 }), ai: 2, fullRestores: 1,
      trainer: { name: m.name, title: m.title || 'Elite Four', sprite: m.sprite, prize: 40 * (base + L.stage + 2), type: m.type },
    }) };
  }
  const [name, region] = L.champion.split('|');
  const c = CHAMPIONS.find(e => e.name === name && e.region === region);
  return { info: c, title: 'Champion', spec: () => ({
    kind: 'champion', enemy: bossTeam(run, c.team, 6, base + 5, 3, { perfectIvs: 5 }), ai: 2, fullRestores: 2,
    trainer: { name: c.name, title: 'Champion', sprite: c.sprite, prize: 50 * (base + 8) },
  }) };
}

// ---------- Rewards ----------
export function addItem(run, item, n = 1) { run.bag[item] = (run.bag[item] || 0) + n; }

/** Moves a Move Tutor offers a Pokémon: its TM/tutor moves, a rotating selection per visit. */
export function tutorOffers(run, mon, nodeId) {
  const known = new Set(mon.moves.map(x => x.id));
  const all = [...(MACHINES[mon.id] || [])].filter(id => MOVES[id] && !known.has(id)).sort();
  if (!all.length) return [];
  const seed = [...`${nodeId}${mon.uid}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const out = [];
  for (let i = 0; i < all.length && out.length < 8; i++) {
    const id = all[(seed + i * 37) % all.length];
    if (!out.includes(id)) out.push(id);
  }
  return out.map(id => ({ id, price: tutorPrice(run, id) }));
}
export const tutorPrice = (run, id) => Math.round((100 + (MOVES[id].p || 50) * 3) * run.act * diffOf(run).priceMult / 2) * 2;

export function martStock(run) {
  const act = run.act;
  const list = ['Poké Ball', 'Great Ball', 'Potion', 'Super Potion', 'Antidote', 'Paralyze Heal', 'Awakening', 'Burn Heal', 'Ice Heal', 'Revive', 'Exp. Candy S'];
  list.push('HP Up', 'Protein', 'Iron', 'Calcium', 'Zinc', 'Carbos');
  if (act >= 2) list.push('Ultra Ball', 'Quick Ball', 'Dusk Ball', 'Hyper Potion', 'Full Heal', 'Elixir', 'Exp. Candy M', 'Linking Cord');
  if (act >= 3) list.push('Max Potion', 'Full Restore', 'Max Revive', 'Max Elixir', 'Exp. Candy L');
  list.push(...STONE_LIST);
  if (act >= 2) {
    // A rotating selection of held evolution items
    const seed = (run.pos || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const extra = EVO_ITEM_LIST.filter(i => !STONE_LIST.includes(i));
    for (let i = 0; i < 4; i++) list.push(extra[(seed + i * 7) % extra.length]);
  }
  const hell = diffOf(run).permadeath;
  return [...new Set(list)].filter(n => !(hell && ITEMS[n].kind === 'revive')).map(name => ({ name, price: priceOf(run, name) }));
}

export const priceOf = (run, name) => Math.max(1, Math.round(ITEMS[name].price * diffOf(run).priceMult));

export function eliteReward(run) {
  const options = [['Rare Candy', 1], ['Bottle Cap', 1], ['Bottle Cap', 1], ['Gold Bottle Cap', 1], [pick(STONE_LIST), 1], [pick(EVO_ITEM_LIST), 1], ['Ultra Ball', 3], [diffOf(run).permadeath ? 'Full Restore' : 'Max Revive', 1]];
  const r = pick(options);
  addItem(run, r[0], r[1]);
  return r;
}

// ---------- Difficulty ----------
const WILD_PAY = { wild: 2, elite: 5, legendary: 8 };

/** Adjust a freshly built encounter for the run's difficulty: levels, IVs/EVs, AI, items and money. */
export function applyDifficulty(run, spec) {
  const d = diffOf(run);
  const trainer = !!spec.trainer;
  const keepSpecies = spec.kind === 'legendary' || spec.kind === 'elite';
  for (const m of spec.enemy) {
    const lv = Math.max(2, Math.min(100, Math.round(m.lv * d.levelMult)));
    if (lv !== m.lv) {
      const id = keepSpecies ? m.id : stageForLevel(m.id, lv);
      if (id !== m.id) { m.id = id; m.ab = pick(DEX[id].a); }
      m.lv = lv;
      m.exp = expForLevel(DEX[m.id].gr, lv);
      m.moves = movesAtLevel(m.id, lv).map(x => ({ id: x, pp: MOVES[x].pp }));
    }
    if (d.ivs === 'low') m.iv = m.iv.map(v => Math.min(v, rand(16)));
    if (d.ivs === 'allMax' || (d.ivs === 'trainersMax' && trainer)) m.iv = [31, 31, 31, 31, 31, 31];
    if (d.evs) {
      // Trained like a competitive Pokémon: max its better attacking stat and Speed
      const b = DEX[m.id].b;
      m.ev = [4, 0, 0, 0, 0, 252];
      m.ev[b[1] >= b[3] ? 1 : 3] = 252;
    }
    m.hp = maxHp(m);
  }
  equipEnemies(run, spec);
  if (trainer) {
    if (d.ai === 'basic') spec.ai = Math.min(spec.ai ?? 1, 1);
    if (d.ai === 'smart') spec.ai = 2;
    spec.trainer.prize = Math.round((spec.trainer.prize || 0) * d.prizeMult);
    if (spec.fullRestores) spec.fullRestores += d.extraFullRestores;
    spec.noItems = !d.battleItems;
  } else {
    if (d.ai === 'smart' && spec.kind !== 'wild') spec.ai = 2;
    const maxLv = Math.max(...spec.enemy.map(m => m.lv));
    spec.wildPrize = Math.round(maxLv * (WILD_PAY[spec.kind] || 2) * d.prizeMult);
  }
  return spec;
}

export function healParty(run) { run.party.forEach(healMon); }

/** Moving to a new room: every move's PP is restored and each Pokémon still standing gets back 20% of its max HP.
 *  Fainted Pokémon stay fainted. Returns true if anything was restored. */
export const ROOM_HEAL = 0.2;
export function restOnMove(run) {
  let changed = false;
  for (const m of run.party) {
    for (const x of m.moves) { const full = MOVES[x.id]?.pp ?? x.pp; if (x.pp < full) { x.pp = full; changed = true; } }
    if (m.hp <= 0) continue;
    const max = maxHp(m);
    const hp = Math.min(max, m.hp + Math.ceil(max * ROOM_HEAL));
    if (hp !== m.hp) { m.hp = hp; changed = true; }
  }
  return changed;
}

// ---------- Opponents' held items and battle gimmicks ----------
const BOSS_KINDS = ['gym', 'villainBoss', 'e4', 'champion'];
const megaStoneOf = id => (FORMS[id]?.mega || []).find(f => f.kind === 'mega' && f.item)?.item || null;

function equipEnemies(run, spec) {
  const d = run.difficulty || 'medium';
  // Wild Pokémon that can Gigantamax sometimes have the Gigantamax Factor (Elite Pokémon always do)
  if (!spec.trainer) {
    for (const m of spec.enemy) if (FORMS[m.id]?.gmax && (spec.kind === 'elite' || Math.random() < 0.1)) m.gf = true;
    return;
  }
  // Trainers on Hard and Hell carry items
  const itemChance = { easy: 0, medium: 0.1, hard: 0.3, hell: 0.6 }[d] ?? 0.1;
  for (const m of spec.enemy) {
    if (Math.random() < itemChance) m.item = pick(['Sitrus Berry', 'Leftovers', 'Lum Berry', TYPE_BOOSTERS[DEX[m.id].t[0]]]);
  }
  if (!BOSS_KINDS.includes(spec.kind)) return;
  // Bosses use one gimmick on their ace, like the main games' Gym Leaders and Champions
  const ace = spec.enemy.reduce((a, m) => (m.lv >= a.lv ? m : a), spec.enemy[0]);
  const type = spec.trainer.type;
  const megaMon = spec.enemy.find(m => megaStoneOf(m.id));
  let g;
  if ((spec.kind === 'champion' || spec.kind === 'villainBoss') && megaMon) {
    megaMon.item = megaStoneOf(megaMon.id); megaMon.gim = 'mega'; g = 'mega';
  } else if (spec.kind === 'gym') {
    g = Math.random() < 0.6 ? 'tera' : 'dmax';
  } else if (spec.kind === 'e4') {
    g = Math.random() < 0.5 ? 'tera' : 'z';
  } else {
    g = pick(['dmax', 'tera', 'z']);
  }
  if (g !== 'mega') {
    ace.gim = g;
    if (g === 'tera') ace.tt = type && TYPE_LIST.includes(type) ? type : DEX[ace.id].t[0];
    if (g === 'z') {
      const dmg = ace.moves.map(x => MOVES[x.id]).filter(mv => mv.c !== 'S');
      const zt = (type && dmg.some(mv => mv.t === type)) ? type : (dmg.sort((a, b) => b.p - a.p)[0]?.t || DEX[ace.id].t[0]);
      ace.item = Z_CRYSTALS[zt];
    }
    if (g === 'dmax' && FORMS[ace.id]?.gmax) ace.gf = true;
    if (!ace.item && d !== 'easy') ace.item = 'Sitrus Berry';
  }
}

// ---------- Rewards after battle (PokéRogue style: pick one of three) ----------
const TIERS = ['common', 'great', 'ultra', 'rogue', 'master'];
export const TIER_COLORS = { common: '#cfd8e3', great: '#4aa3ff', ultra: '#f2c94c', rogue: '#eb5757', master: '#c77dff' };
const HELD_ULTRA = ['Leftovers', 'Shell Bell', 'Life Orb', 'Choice Band', 'Choice Specs', 'Choice Scarf', 'Expert Belt', 'Scope Lens', 'Quick Claw', 'Focus Band', 'Muscle Band', 'Wise Glasses', 'Assault Vest', 'Rocky Helmet', 'White Herb', 'Lucky Egg', 'Amulet Coin'];

const ownsItem = (run, item) => (run.bag[item] || 0) > 0 || [...run.party, ...run.box].some(m => m.item === item);
const partyMoveTypes = run => [...new Set(run.party.flatMap(m => m.moves.map(x => MOVES[x.id]).filter(mv => mv.c !== 'S').map(mv => mv.t)))];

/** Evolution items that would evolve someone on the team. */
function usefulEvoItems(run) {
  const out = new Set();
  for (const m of run.party) for (const e of DEX[m.id].e || []) {
    const it = evoItemFor(e);
    if (it && ITEMS[it]) out.add(it);
  }
  return [...out];
}

function rewardPool(run, tier) {
  const pool = [];
  const hell = diffOf(run).permadeath;
  const add = (item, qty = 1, w = 1) => { if (ITEMS[item] && !(hell && ITEMS[item].kind === 'revive')) pool.push({ item, qty, w }); };
  const types = partyMoveTypes(run);
  const hasNFE = run.party.some(m => DEX[m.id].e?.length);
  if (tier === 'common') {
    add('Poké Ball', 5, 3); add('Potion', 3, 2); add('Super Potion', 2); add('Full Heal', 2); add('Oran Berry', 1);
    add('Exp. Candy S', 2); add('Revive', 1);
    add(tmFor(run, 'common'), 1, 2.5);
  } else if (tier === 'great') {
    add('Great Ball', 5, 3); add('Hyper Potion', 2, 2); add('Revive', 2); add('Elixir', 2); add('Rare Candy', 1, 2); add('Exp. Candy M', 2);
    add('Sitrus Berry', 1, 2); add('Lum Berry', 1);
    for (const it of usefulEvoItems(run)) add(it, 1, 2);
    if (types.length) add(TYPE_BOOSTERS[pick(types)], 1, 2);
    add(pick(['HP Up', 'Protein', 'Iron', 'Calcium', 'Zinc', 'Carbos']), 2);
    add(`${pick(MINT_NATURES)} Mint`, 1);
    if (run.bag['Tera Orb']) add(`${pick(types.length ? types : TYPE_LIST)} Tera Shard`, 1, 2);
    add('Nugget', 1);
    add(tmFor(run, 'great'), 1, 3);
  } else if (tier === 'ultra') {
    add('Ultra Ball', 5, 3); add('Max Revive', 1); add('Full Restore', 2); add('Max Elixir', 1); add('Rare Candy', 3); add('Exp. Candy L', 1);
    for (const h of HELD_ULTRA) add(h, 1, 0.6);
    if (hasNFE) add('Eviolite', 1);
    add('Bottle Cap', 1); add('Ability Capsule', 1);
    // Battle gimmicks the team can use
    if (run.bag['Mega Bracelet']) for (const m of run.party) { const st = megaStoneOf(m.id); if (st && !ownsItem(run, st)) add(st, 1, 3); }
    for (const m of run.party) for (const f of FORMS[m.id]?.mega || []) if (f.kind === 'primal' && !ownsItem(run, f.item)) add(f.item, 1, 3);
    if (run.bag['Z-Ring'] && types.length) add(Z_CRYSTALS[pick(types)], 1, 2);
    if (run.bag['Dynamax Band'] && run.party.some(m => FORMS[m.id]?.gmax && !m.gf)) add('Max Mushrooms', 1, 2);
    for (const k of Object.keys(KEY_ITEMS)) if (!run.bag[k]) add(k, 1, 1.5);
    add('Big Nugget', 1, 0.5);
    add(tmFor(run, 'ultra'), 1, 3);
  } else if (tier === 'rogue') {
    add('Focus Sash', 1); add('Gold Bottle Cap', 1); add('Ability Patch', 1); add('Exp. Candy L', 3);
    for (const k of Object.keys(KEY_ITEMS)) if (!run.bag[k]) add(k, 1, 3);
    if (run.bag['Mega Bracelet']) for (const m of run.party) { const st = megaStoneOf(m.id); if (st && !ownsItem(run, st)) add(st, 1, 3); }
  } else {
    add('Master Ball', 1);
  }
  return pool;
}

/** TMs a team member can learn and doesn't know yet; stronger moves come in higher tiers (like PokéRogue). */
function tmFor(run, tier) {
  const opts = [];
  for (const m of run.party) {
    const known = new Set(m.moves.map(x => x.id));
    for (const id of MACHINES[m.id] || []) {
      const mv = MOVES[id];
      if (!mv || known.has(id) || !TM_BY_MOVE[id]) continue;
      const t = mv.c === 'S' || mv.p <= 60 ? 'common' : mv.p <= 85 ? 'great' : 'ultra';
      if (t === tier) opts.push(TM_BY_MOVE[id]);
    }
  }
  return opts.length ? pick(opts) : null;
}

function rollTier(boss) {
  const r = Math.random() * 100;
  let t = r < 2.5 ? 3 : r < 14 ? 2 : r < 45 ? 1 : 0;
  if (boss) t++;
  if (t === 3 && Math.random() < 0.08) t = 4;
  return TIERS[Math.min(4, t)];
}

/** Three reward options after a battle; bosses and Elite/Legendary Pokémon roll a tier higher. */
export function generateRewards(run, kind, lockedTiers = null) {
  const boss = ['gym', 'villainBoss', 'e4', 'champion', 'elite', 'legendary'].includes(kind);
  const out = [];
  for (let i = 0; i < 30 && out.length < 3; i++) {
    // With rarities locked, a reroll keeps each slot's tier
    const tier = lockedTiers?.[out.length] || rollTier(boss && (i === 0 || Math.random() < 0.4));
    const pool = rewardPool(run, tier).filter(o => !out.some(x => x.item === o.item));
    if (!pool.length) continue;
    const total = pool.reduce((a, o) => a + o.w, 0);
    let r = Math.random() * total;
    const o = pool.find(x => (r -= x.w) < 0) || pool[0];
    out.push({ item: o.item, qty: o.qty, tier });
  }
  return out;
}
export const rerollCost = (run, n) => Math.round(30 * (n + 1) * run.act * diffOf(run).priceMult);

/** Add a caught Pokémon to the party (or the Box when the party is full). */
export function storeCaught(run, mon) {
  delete mon.elite;
  run.stats.caught++;
  if (!run.caught.includes(mon.id)) run.caught.push(mon.id);
  if (run.party.length < 6) { run.party.push(mon); return 'party'; }
  run.box.push(mon); return 'box';
}

// ---------- Poké Ball node: recruit one of three Pokémon ----------
// Rarity comes from the strongest form the family can evolve into, so Dratini is Very rare
// and Caterpie is Common. Odds improve in later acts.
export const RECRUIT_RARITIES = [
  { key: 'common', name: 'Common', maxBst: 450 },
  { key: 'uncommon', name: 'Uncommon', maxBst: 500 },
  { key: 'rare', name: 'Rare', maxBst: 540 },
  { key: 'veryRare', name: 'Very rare', maxBst: Infinity },
];
const RECRUIT_ODDS = { 1: [60, 28, 10, 2], 2: [45, 32, 17, 6], 3: [35, 32, 23, 10] };
export const recruitOdds = act => RECRUIT_ODDS[act] || RECRUIT_ODDS[3];

const finalBstCache = {};
export function familyFinalBst(id, depth = 0) {
  if (finalBstCache[id] != null) return finalBstCache[id];
  const sp = DEX[id];
  const own = sp.b.reduce((a, b) => a + b, 0);
  const evos = depth < 4 ? (sp.e || []).map(e => e.to).filter(to => DEX[to]) : [];
  const v = Math.max(own, ...evos.map(to => familyFinalBst(to, depth + 1)));
  return (finalBstCache[id] = v);
}
export function recruitRarity(id) {
  const b = familyFinalBst(id);
  return RECRUIT_RARITIES.findIndex(r => b < r.maxBst);
}
let recruitBuckets = null;
function getRecruitBuckets() {
  if (recruitBuckets) return recruitBuckets;
  recruitBuckets = RECRUIT_RARITIES.map(() => []);
  for (const id of getPools().wildBase) recruitBuckets[recruitRarity(id)].push(id);
  return recruitBuckets;
}

/** Three different species, none already on the team, at the node's level. */
export function recruitOffers(run, node) {
  const lv = Math.max(3, rowLevel(run.act, node.r) - 1);
  const buckets = getRecruitBuckets();
  const odds = recruitOdds(run.act);
  const skip = new Set([...run.party.map(m => familyRoot(m.id))]);
  const out = [];
  for (let tries = 0; tries < 60 && out.length < 3; tries++) {
    const ri = Number(weighted(Object.fromEntries(odds.map((w, i) => [i, buckets[i].length ? w : 0]))));
    const id = pick(buckets[ri]);
    const root = familyRoot(id);
    if (skip.has(root)) continue;
    skip.add(root);
    const mon = makeTrainerMon(id, lv, { shinyOdds: WILD_SHINY_ODDS });
    mon.fr = DEX[mon.id].bh;
    mon.ball = 'Poké Ball';
    out.push({ mon, rarity: RECRUIT_RARITIES[ri].key });
  }
  return out;
}

// ---------- Pokémon League: paid full heal between battles ----------
/** Each heal costs more than the last. */
export const leagueHealPrice = run => Math.round(1200 * ((run.league?.heals || 0) + 1) * diffOf(run).priceMult);
export function canLeagueHeal(run) {
  const L = run.league;
  return !!L && L.stage >= 1 && L.stage <= 4 && L.healedAt !== L.stage;
}

export function partySummary(party) {
  return party.map(m => ({ id: m.id, lv: m.lv, name: m.nick || DEX[m.id].n, shiny: !!m.shiny }));
}

export { REGIONS, maxHp, movesAtLevel };

/** The shop row under the rewards (PokéRogue sells healing items there), stocked by act. */
export function rewardShop(run) {
  const act = run.act;
  const list = ['Potion', 'Super Potion', 'Full Heal', 'Revive', 'Elixir', 'Poké Ball'];
  if (act >= 2) list.push('Hyper Potion', 'Max Revive', 'Great Ball');
  if (act >= 3) list.push('Max Potion', 'Full Restore', 'Max Elixir', 'Ultra Ball');
  const hell = diffOf(run).permadeath;
  return list.filter(n => !(hell && ITEMS[n].kind === 'revive')).map(name => ({ name, price: priceOf(run, name) }));
}
