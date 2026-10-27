// Run structure: three acts of branching map nodes, encounters, rewards and progression.
import { DEX, MOVES, REGIONS, idOf, movesAtLevel, regionOf } from './data.js';
import { createMon, stageForLevel, healMon, rand, pick, uid, maxHp, expForLevel } from './mechanics.js';
import {
  ITEMS, DIFFICULTIES, diffOf, CLASSIC, GAME_MODES, modeOf, TRAINER_CLASSES, TRAINER_NAMES, GYM_LEADERS, VILLAINS, ELITE_FOUR, CHAMPIONS, STONE_LIST, EVO_ITEM_LIST,
} from './content.js';

export const ACTS = [
  { name: 'Act I · Route of Beginnings', from: 3, to: 14, boss: 'gym', bossLv: 16 },
  { name: 'Act II · The Shadow Syndicate', from: 15, to: 27, boss: 'villainBoss', bossLv: 30 },
  { name: 'Act III · Victory Road', from: 28, to: 39, boss: 'league', bossLv: 41 },
];
export const ROWS = 12; // rows 0..10 are regular, row 11 is the boss
const COLS = 7;

export const NODE_INFO = {
  wild: { icon: '🌿', label: 'Wild Pokémon', desc: 'A random wild Pokémon. Catch it or defeat it.' },
  trainer: { icon: '🧢', label: 'Trainer', desc: 'A Pokémon Trainer challenges you. Earn prize money.' },
  villain: { icon: '💀', label: 'Villain Team', desc: 'Grunts or admins of an evil team block the way.' },
  elite: { icon: '⭐', label: 'Elite Pokémon', desc: 'A powerful wild Pokémon with superior stats. Rare rewards.' },
  gym: { icon: '🏅', label: 'Gym Battle', desc: 'A Gym Leader from any region. Win a badge.' },
  legendary: { icon: '✨', label: 'Legendary Pokémon', desc: 'A Legendary Pokémon appears! Your chance to catch it.' },
  stop: { icon: '🔷', label: 'PokéStop', desc: 'Spin for free items.' },
  mart: { icon: '🏪', label: 'PokéMart', desc: 'Buy Poké Balls, medicine and evolution items.' },
  center: { icon: '🏥', label: 'Pokémon Center', desc: 'Fully heal your team and use the PC Box.' },
  boss: { icon: '👑', label: 'Boss', desc: 'The act boss.' },
};

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
export function newRun(starterId, difficulty = 'medium', mode = 'classic', choice = {}) {
  const starter = createMon(starterId, 5);
  starter.fr = 70;
  if (Number.isInteger(choice.nat) && choice.nat >= 0 && choice.nat < 25) starter.nat = choice.nat;
  if (choice.ab && [...DEX[starterId].a, DEX[starterId].h].includes(choice.ab)) starter.ab = choice.ab;
  if (choice.shiny) starter.shiny = true;
  starter.hp = maxHp(starter);
  const diff = DIFFICULTIES[difficulty] ? difficulty : 'medium';
  const run = {
    v: 1, id: uid(), startedAt: new Date().toISOString(), starter: starterId, difficulty: diff,
    mode: GAME_MODES[mode] ? mode : 'classic', region: regionOf(starterId),
    act: 1, map: generateMap(1), pos: null, visited: [],
    party: [starter], box: [], bag: { ...DIFFICULTIES[diff].bag }, money: 100, fallen: [],
    badges: [], beatenGyms: [], caught: [], league: null, battle: null, node: null,
    stats: { battles: 0, wins: 0, caught: 0, nodes: 0 }, score: 0,
  };
  return run;
}

// ---------- Map generation (branching paths, Slay-the-Spire style) ----------
export function generateMap(act) {
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
    wild: 28, trainer: 20, villain: act >= 2 ? 12 : 8, elite: r >= 3 ? 7 : 0, gym: r >= 3 ? 6 : 0,
    stop: 9, mart: r >= 2 ? 7 : 3, center: r >= 3 && r <= 8 ? 7 : 0,
  });
  let gyms = 0;
  for (const n of ordered) {
    if (n.r === 0) { n.type = 'wild'; continue; }
    if (n.r === ROWS - 2) { n.type = 'center'; continue; }
    for (let tries = 0; tries < 20; tries++) {
      const w = weights(n.r);
      if (gyms >= 2) w.gym = 0;
      const t = weighted(w);
      const parentTypes = (parents[n.id] || []).map(p => nodes[p].type);
      if (['stop', 'mart', 'center', 'gym', 'elite'].includes(t) && parentTypes.includes(t)) continue;
      n.type = t;
      break;
    }
    n.type ||= 'wild';
    if (n.type === 'gym') gyms++;
  }
  // Exactly one Legendary encounter per act, in the middle rows
  const mid = ordered.filter(n => n.r >= 4 && n.r <= 8 && n.type !== 'gym');
  if (mid.length) pick(mid).type = 'legendary';
  return { act, nodes };
}

function weighted(w) {
  const entries = Object.entries(w).filter(([, v]) => v > 0);
  let x = Math.random() * entries.reduce((a, [, v]) => a + v, 0);
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
function regional(run, list) {
  if (!isClassic(run)) return list;
  const r = run.region ?? regionOf(run.starter);
  const f = list.filter(id => regionOf(id) === r);
  return f.length >= 3 ? f : list;
}

function randomOfTypes(run, types) {
  const p = getPools();
  const pool = types ? regional(run, [...new Set(types.flatMap(t => p.byType[t] || []))]) : [];
  return pick(pool.length && (!isClassic(run) || pool.some(id => regionOf(id) === run.region)) ? pool : regional(run, p.wildBase));
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
      const regionLegends = isClassic(run) ? P.legends.filter(x => regionOf(x) === run.region) : [];
      const id = pick(regionLegends.length ? regionLegends : act === 1 ? P.subLegends : P.legends);
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

export function bossEncounter(run) {
  const a = ACTS[run.act - 1];
  if (a.boss === 'gym') {
    const leader = pickGym(run);
    return gymSpec(leader, bossTeam(run, leader.team, 3, a.bossLv - 3, 3, { perfectIvs: 2 }));
  }
  if (a.boss === 'villainBoss') {
    const v = pickVillain(run);
    const enemy = bossTeam(run, v.boss.team, 4, a.bossLv - 3, 3, { perfectIvs: 3 });
    return {
      kind: 'villainBoss', enemy, ai: 2, fullRestores: 1,
      trainer: { name: v.boss.name, title: v.boss.title, sprite: v.boss.sprite, prize: 40 * a.bossLv, quote: 'This is not the end...', team: v.team },
    };
  }
  return null; // league is handled separately
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

export function spinPokeStop(run) {
  const act = run.act;
  const ball = act === 1 ? 'Poké Ball' : act === 2 ? pick(['Poké Ball', 'Great Ball', 'Great Ball']) : pick(['Great Ball', 'Ultra Ball']);
  const potion = act === 1 ? 'Potion' : act === 2 ? 'Super Potion' : 'Hyper Potion';
  const items = [[ball, 2 + rand(3)], [potion, 1 + rand(2)]];
  const r = Math.random();
  if (r < 0.06) items.push(['Rare Candy', 1]);
  else if (r < 0.1) items.push([act === 3 ? 'Gold Bottle Cap' : 'Bottle Cap', 1]);
  else if (r < 0.22) items.push([pick(STONE_LIST), 1]);
  else if (r < 0.28) items.push([act >= 2 ? pick(EVO_ITEM_LIST) : 'Linking Cord', 1]);
  else if (r < 0.45) items.push([act === 3 ? 'Exp. Candy L' : act === 2 ? 'Exp. Candy M' : 'Exp. Candy S', 1 + rand(2)]);
  else if (r < 0.6) items.push([diffOf(run).permadeath ? 'Full Heal' : 'Revive', 1]);
  else items.push([pick(['Antidote', 'Paralyze Heal', 'Awakening', 'Burn Heal', 'Full Heal']), 1]);
  if (Math.random() < 0.25) items.push(['Quick Ball', 1]);
  for (const [it, n] of items) addItem(run, it, n);
  let money = 0;
  if (Math.random() < 0.3) { money = 50 * act + rand(4) * 25; run.money += money; }
  return { items, money };
}

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

/** Add a caught Pokémon to the party (or the Box when the party is full). */
export function storeCaught(run, mon) {
  delete mon.elite;
  run.stats.caught++;
  if (!run.caught.includes(mon.id)) run.caught.push(mon.id);
  if (run.party.length < 6) { run.party.push(mon); return 'party'; }
  run.box.push(mon); return 'box';
}

export function partySummary(party) {
  return party.map(m => ({ id: m.id, lv: m.lv, name: m.nick || DEX[m.id].n, shiny: !!m.shiny }));
}

export { REGIONS, maxHp, movesAtLevel };
