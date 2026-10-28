// Turn-based single battle engine. The battle object is plain JSON so it can be saved mid-fight.
// Damage, accuracy, stat stages, status, critical hits, experience and catching follow the
// main-series formulas (Gen 5+).
import { DEX, MOVES, FORMS, typeEffect } from './data.js';
import {
  calcStats, maxHp, monName, expYield, gainExp, addEvs, catchAttempt, rand, pick, uid, typesOf, teraType,
} from './mechanics.js';
import { ITEMS, diffOf, GIMMICK_KEY, Z_MOVES, MAX_MOVES } from './content.js';

// Moves that thaw a frozen user (and, for some, a frozen target), and powder moves Grass types ignore
const THAW_USER = new Set(['flamewheel', 'sacredfire', 'flareblitz', 'fusionflare', 'scald', 'steameruption', 'burnup', 'pyroball', 'scorchingsands', 'matchagotcha']);
const THAW_TARGET = new Set(['scald', 'steameruption', 'scorchingsands']);
const POWDER = new Set(['sleeppowder', 'stunspore', 'poisonpowder', 'spore', 'ragepowder', 'cottonspore', 'magicpowder', 'powder']);
const STAT_KEYS_LONG = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
const STRUGGLE = { n: 'Struggle', t: '???', c: 'P', p: 50, a: 0, pp: 1, recoilMax: 0.25 };
const STAGE_NAMES = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed', accuracy: 'accuracy', evasion: 'evasiveness' };
const STATUS_NAMES = { brn: 'burned', par: 'paralyzed', psn: 'poisoned', tox: 'badly poisoned', slp: 'asleep', frz: 'frozen' };

const freshVolatile = () => ({ stg: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }, conf: 0, flinch: false, protect: false, protectChain: 0, charging: null, recharge: false, tox: 1, lock: null, maxguard: false });
const WEATHER = {
  sun: ['The sunlight turned harsh!', 'The harsh sunlight faded.'], rain: ['It started to rain!', 'The rain stopped.'],
  sand: ['A sandstorm kicked up!', 'The sandstorm subsided.'], snow: ['It started to snow!', 'The snow stopped.'],
};
const TERRAIN = {
  electric: ['An electric current ran across the battlefield!', 'The electricity disappeared from the battlefield.'],
  grassy: ['Grass grew to cover the battlefield!', 'The grass disappeared from the battlefield.'],
  psychic: ['The battlefield got weird!', 'The weirdness disappeared from the battlefield.'],
  misty: ['Mist swirled around the battlefield!', 'The mist disappeared from the battlefield.'],
};
const WEATHER_ABILITY = { Drought: 'sun', Drizzle: 'rain', 'Sand Stream': 'sand', 'Snow Warning': 'snow', 'Primordial Sea': 'rain', 'Desolate Land': 'sun', 'Orichalcum Pulse': 'sun' };
const TERRAIN_ABILITY = { 'Electric Surge': 'electric', 'Grassy Surge': 'grassy', 'Psychic Surge': 'psychic', 'Misty Surge': 'misty', 'Hadron Engine': 'electric' };

// ---------- Held items ----------
const fx = mon => (mon?.item && ITEMS[mon.item]?.kind === 'held' ? ITEMS[mon.item].fx : null);
const heldItem = mon => (mon?.item ? ITEMS[mon.item] : null);
const grounded = mon => !typesOf(mon).includes('Flying') && mon.ab !== 'Levitate';
const canEvolve = mon => !!DEX[mon.id].e?.length;

// ---------- Battle forms (Mega Evolution, Primal Reversion, Dynamax, Terastallization) ----------
export function megaFormFor(mon) {
  return (FORMS[mon.id]?.mega || []).find(f => f.kind === 'mega' && ((f.item && mon.item === f.item) || (f.move && mon.moves.some(m => m.id === f.move)))) || null;
}
const primalFormFor = mon => (FORMS[mon.id]?.mega || []).find(f => f.kind === 'primal' && mon.item === f.item) || null;
const gmaxFor = mon => (mon.gf && FORMS[mon.id]?.gmax) || null;

function takeForm(mon, form) {
  mon.bf = { ...(mon.bf || {}), n: form.n, t: form.t, b: form.b, s: form.s, ab0: mon.bf?.ab0 ?? mon.ab };
  mon.ab = form.ab;
}
function endDynamax(mon) {
  if (!mon.bf || !('dmax' in mon.bf)) return;
  const hp = mon.hp;
  delete mon.bf.dmax; delete mon.bf.gmax; delete mon.bf.gs;
  mon.hp = hp > 0 ? Math.max(1, Math.ceil(hp / 2)) : 0;
  if (!Object.keys(mon.bf).length) delete mon.bf;
}
/** Back to normal after battle. */
export function clearBattleForm(mon) {
  if (!mon?.bf) return;
  endDynamax(mon);
  if (mon.bf?.ab0) mon.ab = mon.bf.ab0;
  delete mon.bf;
  mon.hp = Math.min(mon.hp, maxHp(mon));
}

/** Gimmicks the player can use this turn (one per battle, like the main games). */
export function gimmickOptions(run) {
  const b = run.battle;
  if (!b || b.gim?.p || b.phase !== 'choose') return [];
  const P = sideMon(run, 'p');
  if (P.hp <= 0) return [];
  const has = g => (run.bag[GIMMICK_KEY[g]] || 0) > 0 || run.god;
  const out = [];
  if (has('mega') && !P.bf?.n && megaFormFor(P)) out.push('mega');
  const z = heldItem(P);
  if (has('z') && z?.kind === 'z' && P.moves.some(m => m.pp > 0 && MOVES[m.id].t === z.type)) out.push('z');
  if (has('dmax') && !P.bf?.n && !P.bf?.dmax) out.push('dmax');
  if (has('tera') && !P.bf?.tera) out.push('tera');
  return out;
}

function useGimmick(run, out, side, g) {
  const b = run.battle;
  const mon = sideMon(run, side);
  const name = (side === 'e' ? (b.trainer ? 'The foe\'s ' : 'The wild ') : '') + monName(mon);
  const who = side === 'p' ? 'You' : `${b.trainer?.title || ''} ${b.trainer?.name || ''}`.trim();
  b.gim[side] = true;
  if (g === 'mega') {
    const form = megaFormFor(mon);
    if (!form) return;
    say(run, out, `${name}'s ${form.item || MOVES[form.move].n} is reacting to ${side === 'p' ? 'your Mega Bracelet' : `${who}'s Key Stone`}!`, { sfx: 'gimmick' });
    takeForm(mon, form);
    say(run, out, `${name} has Mega Evolved into ${form.n}!`, { sfx: 'cry', send: side, gimmick: 'mega' });
    track?.('mega', side);
    entryAbility(run, out, side);
  } else if (g === 'dmax') {
    const gm = gmaxFor(mon);
    const before = maxHp(mon);
    mon.bf = { ...(mon.bf || {}), dmax: 3, ...(gm ? { gmax: gm, gs: gm.s } : {}) };
    mon.hp += maxHp(mon) - before;
    say(run, out, `${who === 'You' ? 'Your' : `${who}'s`} Dynamax Band is glowing!`, { sfx: 'gimmick' });
    say(run, out, `${name} ${gm ? 'Gigantamaxed' : 'Dynamaxed'}!`, { sfx: 'cry', send: side, gimmick: 'dmax' });
    track?.('dmax', side);
  } else if (g === 'tera') {
    const tt = teraType(mon);
    mon.bf = { ...(mon.bf || {}), tera: tt };
    say(run, out, `${name} Terastallized into the ${tt} type!`, { sfx: 'gimmick', gimmick: 'tera' });
    track?.('tera', side);
  }
}
let track = null;
/** Lets the UI count gimmick uses for missions/achievements. */
export function setBattleHooks(h) { track = h.track; }

// ---------- Weather and terrain ----------
function setWeather(run, out, kind, turns = 5) {
  const b = run.battle;
  if (!kind || b.weather?.kind === kind) return false;
  b.weather = { kind, turns };
  say(run, out, WEATHER[kind][0]);
  return true;
}
function setTerrain(run, out, kind) {
  const b = run.battle;
  if (!kind || b.terrain?.kind === kind) return false;
  b.terrain = { kind, turns: 5 };
  say(run, out, TERRAIN[kind][0]);
  return true;
}
const weatherIs = (run, k) => run.battle.weather?.kind === k;
const terrainIs = (run, k) => run.battle.terrain?.kind === k;

// ---------- Setup ----------
/**
 * spec: { kind, enemy:[mons], trainer?:{name,title,sprite,prize}, canCatch, canRun, ai (0..2), fullRestores }
 */
export function startBattle(run, spec) {
  const pi = run.party.findIndex(m => m.hp > 0);
  const b = {
    id: uid(), kind: spec.kind, enemy: spec.enemy, ei: 0, pi,
    trainer: spec.trainer || null, canCatch: !!spec.canCatch, canRun: !!spec.canRun,
    ai: spec.ai ?? (spec.trainer ? 1 : 0), fullRestores: spec.fullRestores || 0,
    pv: freshVolatile(), ev: freshVolatile(), participants: [run.party[pi].uid],
    turn: 0, runAttempts: 0, over: null, phase: 'choose', learnQueue: [], leveled: [], log: [],
    caughtMon: null, exp: {}, moneyStart: run.money, noItems: !!spec.noItems, wildPrize: spec.wildPrize || 0,
    gim: { p: false, e: false }, weather: null, terrain: null,
  };
  run.battle = b;
  const out = [];
  const E = b.enemy[0];
  if (b.trainer) {
    say(run, out, `${b.trainer.title} ${b.trainer.name} wants to battle!`);
    say(run, out, `${b.trainer.title} ${b.trainer.name} sent out ${monName(E)}!`, { send: 'e' });
  } else {
    say(run, out, spec.intro || `A wild ${monName(E)} appeared!`, { send: 'e', sfx: 'cry', shiny: E.shiny });
    if (E.shiny) say(run, out, `✨ It's a shiny ${monName(E)}!`, { sfx: 'shiny', shiny: true });
  }
  say(run, out, `Go! ${monName(run.party[pi])}!`, { send: 'p' });
  curWeather = null;
  entryAbility(run, out, 'p');
  entryAbility(run, out, 'e');
  return out;
}

// ---------- View snapshots for the UI ----------
const sideMon = (run, side) => side === 'p' ? run.party[run.battle.pi] : run.battle.enemy[run.battle.ei];
const oppSide = side => (side === 'p' ? 'e' : 'p');
function snap(mon) {
  if (!mon) return null;
  const v = { uid: mon.uid, id: mon.id, name: monName(mon), lv: mon.lv, hp: mon.hp, max: maxHp(mon), st: mon.st, shiny: mon.shiny, t: typesOf(mon) };
  if (mon.bf) Object.assign(v, { form: mon.bf.n || null, s: mon.bf.gs || mon.bf.s || null, dmax: !!mon.bf.dmax, gmax: !!mon.bf.gmax, tera: mon.bf.tera || null });
  return v;
}
function say(run, out, text, extra = {}) {
  out.push({ text, view: battleView(run), ...extra });
}

// ---------- Stats in battle ----------
let curWeather = null; // set while a battle step runs so stat lookups can see the weather
const stageMult = s => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const accMult = s => (s >= 0 ? (3 + s) / 3 : 3 / (3 - s));
function effStat(mon, vol, key, { crit = false, attacking = false } = {}) {
  const i = { atk: 1, def: 2, spa: 3, spd: 4, spe: 5 }[key];
  let v = calcStats(mon)[i];
  let s = vol.stg[key];
  if (crit && attacking && s < 0) s = 0;
  if (crit && !attacking && s > 0) s = 0;
  v = Math.floor(v * stageMult(s));
  if (key === 'spe' && mon.st === 'par') v = Math.floor(v / 2);
  if (key === 'atk' && (mon.ab === 'Huge Power' || mon.ab === 'Pure Power')) v *= 2;
  const f = fx(mon);
  // Choice items don't apply while Dynamaxed
  if (!mon.bf?.dmax) {
    if (key === 'atk' && f === 'choiceband') v = Math.floor(v * 1.5);
    if (key === 'spa' && f === 'choicespecs') v = Math.floor(v * 1.5);
    if (key === 'spe' && f === 'choicescarf') v = Math.floor(v * 1.5);
  }
  if (key === 'spd' && f === 'assaultvest') v = Math.floor(v * 1.5);
  if ((key === 'def' || key === 'spd') && f === 'eviolite' && canEvolve(mon)) v = Math.floor(v * 1.5);
  const w = curWeather;
  if (key === 'spe' && ((w === 'rain' && mon.ab === 'Swift Swim') || (w === 'sun' && mon.ab === 'Chlorophyll') || (w === 'sand' && mon.ab === 'Sand Rush') || (w === 'snow' && mon.ab === 'Slush Rush'))) v *= 2;
  if (key === 'spd' && w === 'sand' && typesOf(mon).includes('Rock')) v = Math.floor(v * 1.5);
  if (key === 'def' && w === 'snow' && typesOf(mon).includes('Ice')) v = Math.floor(v * 1.5);
  return Math.max(1, v);
}

// ---------- Player actions ----------
export function playerAction(run, action) {
  const b = run.battle;
  const out = [];
  if (b.over || b.phase !== 'choose') return out;
  b.gim ||= { p: false, e: false };
  curWeather = b.weather?.kind || null;
  b.turn++;
  const P = sideMon(run, 'p');

  // Moves that lock the user in
  if (b.pv.recharge || b.pv.charging) action = { type: 'move', locked: true };
  // Choice items lock the holder into its first move (not while Dynamaxed)
  if (action.type === 'move' && !action.locked && b.pv.lock && !P.bf?.dmax) {
    const li = P.moves.findIndex(m => m.id === b.pv.lock && m.pp > 0);
    if (li >= 0) action = { ...action, index: li };
  }

  const enemyAction = chooseEnemyAction(run);

  // Mega Evolution, Dynamax and Terastallization happen before anyone moves
  const g = action.type === 'move' && !action.locked && gimmickOptions(run).includes(action.gimmick) ? action.gimmick : null;
  if (g && g !== 'z') useGimmick(run, out, 'p', g);
  const E0 = sideMon(run, 'e');
  if (enemyAction.type === 'move' && E0.gim && E0.gim !== 'z' && !b.gim.e && E0.hp > 0 && b.trainer) useGimmick(run, out, 'e', E0.gim);
  curWeather = b.weather?.kind || null;

  if (action.type === 'run') {
    if (tryEscape(run)) {
      say(run, out, 'Got away safely!', { sfx: 'run' });
      b.over = 'run';
      return out;
    }
    say(run, out, "Can't escape!");
  } else if (action.type === 'switch') {
    switchIn(run, out, 'p', action.index, true);
  } else if (action.type === 'item') {
    useBattleItem(run, out, action);
  } else if (action.type === 'ball') {
    if (throwBall(run, out, action.item)) return out;
  }

  if (action.type === 'move') {
    const pMove = action.locked ? null : action.index;
    const order = turnOrder(run, out, pMove, enemyAction);
    for (const side of order) {
      if (b.over) break;
      const mon = sideMon(run, side);
      if (mon.hp <= 0 || sideMon(run, oppSide(side)).hp <= 0) continue;
      if (side === 'p') useMove(run, out, 'p', pMove, { z: g === 'z' });
      else doEnemyAction(run, out, enemyAction);
    }
  } else if (!b.over) {
    doEnemyAction(run, out, enemyAction);
  }

  endOfTurn(run, out);
  return out;
}

function turnOrder(run, out, pMoveIdx, enemyAction) {
  const b = run.battle;
  const prio = (side, idx) => {
    const vol = side === 'p' ? b.pv : b.ev;
    if (vol.recharge || vol.charging) return 0;
    if (side === 'e' && enemyAction.type !== 'move') return 6;
    const mon = sideMon(run, side);
    const mv = idx == null ? null : MOVES[mon.moves[idx]?.id];
    return mv?.pr || 0;
  };
  const pp = prio('p', pMoveIdx), ep = prio('e', enemyAction.index);
  if (pp !== ep) return pp > ep ? ['p', 'e'] : ['e', 'p'];
  // Quick Claw
  for (const side of ['p', 'e']) {
    const mon = sideMon(run, side);
    if (fx(mon) === 'quickclaw' && Math.random() < 0.2) {
      say(run, out, `${monName(mon)}'s Quick Claw let it move first!`);
      return side === 'p' ? ['p', 'e'] : ['e', 'p'];
    }
  }
  const ps = effStat(sideMon(run, 'p'), b.pv, 'spe'), es = effStat(sideMon(run, 'e'), b.ev, 'spe');
  if (ps !== es) return ps > es ? ['p', 'e'] : ['e', 'p'];
  return Math.random() < 0.5 ? ['p', 'e'] : ['e', 'p'];
}

function tryEscape(run) {
  const b = run.battle;
  b.runAttempts++;
  const ps = effStat(sideMon(run, 'p'), b.pv, 'spe'), es = effStat(sideMon(run, 'e'), b.ev, 'spe');
  if (ps >= es) return true;
  const f = (Math.floor(ps * 128 / es) + 30 * b.runAttempts) % 256;
  return rand(256) < f;
}

// ---------- Switching ----------
export function switchIn(run, out, side, index, voluntary = false) {
  const b = run.battle;
  const prev = sideMon(run, side);
  if (prev?.bf && 'dmax' in prev.bf) endDynamax(prev);
  if (side === 'p') {
    if (voluntary) say(run, out, `${monName(sideMon(run, 'p'))}, come back!`);
    b.pi = index;
    b.pv = freshVolatile();
    const m = run.party[index];
    if (!b.participants.includes(m.uid)) b.participants.push(m.uid);
    say(run, out, `Go! ${monName(m)}!`, { send: 'p' });
  } else {
    b.ei = index;
    b.ev = freshVolatile();
    b.participants = [sideMon(run, 'p').uid];
    const m = b.enemy[index];
    say(run, out, `${b.trainer.title} ${b.trainer.name} sent out ${monName(m)}!`, { send: 'e' });
  }
  entryAbility(run, out, side);
}

function entryAbility(run, out, side) {
  const mon = sideMon(run, side);
  // Primal Reversion happens on its own when the Pokémon holds its orb
  const primal = !mon.bf?.n && primalFormFor(mon);
  if (primal) {
    takeForm(mon, primal);
    say(run, out, `${monName(mon)}'s Primal Reversion! It reverted to its primal state!`, { sfx: 'gimmick', send: side });
  }
  if (WEATHER_ABILITY[mon.ab]) {
    const turns = ['Primordial Sea', 'Desolate Land'].includes(mon.ab) ? 99 : 5;
    if (setWeather(run, out, WEATHER_ABILITY[mon.ab], turns)) curWeather = run.battle.weather.kind;
  }
  if (TERRAIN_ABILITY[mon.ab]) setTerrain(run, out, TERRAIN_ABILITY[mon.ab]);
  if (mon.ab === 'Intimidate') {
    const target = sideMon(run, oppSide(side));
    say(run, out, `${monName(mon)}'s Intimidate!`);
    boost(run, out, oppSide(side), { atk: -1 }, target);
  }
}

/** After the player's Pokémon faints and another is chosen. */
export function forceSwitch(run, index) {
  const b = run.battle;
  const out = [];
  if (b.phase !== 'forceSwitch' || !run.party[index] || run.party[index].hp <= 0) return out;
  b.phase = 'choose';
  curWeather = b.weather?.kind || null;
  switchIn(run, out, 'p', index);
  if (b.pendingEnemy != null) { const n = b.pendingEnemy; b.pendingEnemy = null; switchIn(run, out, 'e', n); }
  return out;
}

// ---------- Items ----------
function useBattleItem(run, out, { item, target, moveIndex }) {
  const it = ITEMS[item];
  const mon = run.party[target];
  if (!it || !run.bag[item] || !mon) return;
  if (run.battle.noItems) { say(run, out, 'Items can\'t be used in trainer battles on Hell difficulty!'); return; }
  const res = applyItem(mon, item, moveIndex);
  if (!res.ok) { say(run, out, res.msg || "It won't have any effect."); return; }
  run.bag[item]--;
  say(run, out, `You used ${item}. ${res.msg}`, { sfx: 'heal' });
}

/** Shared by battle and the field. Returns {ok, msg}. */
export function applyItem(mon, item, moveIndex) {
  const it = ITEMS[item];
  const max = maxHp(mon);
  const name = monName(mon);
  if (it.kind === 'revive') {
    if (mon.hp > 0) return { ok: false };
    mon.hp = it.full ? max : Math.floor(max / 2);
    mon.st = null;
    return { ok: true, msg: `${name} was revived!` };
  }
  if (mon.hp <= 0) return { ok: false };
  if (it.kind === 'heal') {
    const cure = it.cure && mon.st;
    if (mon.hp >= max && !cure) return { ok: false };
    const before = mon.hp;
    mon.hp = Math.min(max, mon.hp + (it.amount || max));
    if (it.cure) { mon.st = null; mon.sl = 0; }
    return { ok: true, msg: mon.hp > before ? `${name} recovered ${mon.hp - before} HP!` : `${name} is healthy again!` };
  }
  if (it.kind === 'status') {
    if (!mon.st || (it.cures !== 'all' && !it.cures.includes(mon.st))) return { ok: false };
    mon.st = null; mon.sl = 0;
    return { ok: true, msg: `${name} was cured!` };
  }
  if (it.kind === 'vitamin') {
    const total = mon.ev.reduce((x, y) => x + y, 0);
    const add = Math.min(10, 252 - mon.ev[it.stat], 510 - total);
    if (add <= 0) return { ok: false, msg: `${name}'s ${STAT_KEYS_LONG[it.stat]} EVs can't go any higher.` };
    const before = maxHp(mon);
    mon.ev[it.stat] += add;
    if (it.stat === 0) mon.hp += maxHp(mon) - before;
    return { ok: true, msg: `${name}'s ${STAT_KEYS_LONG[it.stat]} EVs rose by ${add} (now ${mon.ev[it.stat]}).` };
  }
  if (it.kind === 'cap') {
    if (mon.lv < 50) return { ok: false, msg: 'Hyper Training needs a Pokémon at Lv 50 or higher.' };
    if (mon.iv.every(v => v === 31)) return { ok: false, msg: `${name}'s IVs are already perfect.` };
    const before = maxHp(mon);
    let which;
    if (it.all) { mon.iv = mon.iv.map(() => 31); which = 'all of its stats'; }
    else { const i = mon.iv.indexOf(Math.min(...mon.iv)); mon.iv[i] = 31; which = STAT_KEYS_LONG[i]; }
    mon.hp = Math.max(1, mon.hp + maxHp(mon) - before);
    return { ok: true, msg: `${name} was Hyper Trained: ${which} now ${it.all ? 'have' : 'has'} the best IVs!` };
  }
  if (it.kind === 'pp') {
    const targets = it.all ? mon.moves : [mon.moves[moveIndex ?? 0]];
    let changed = false;
    for (const m of targets) {
      const cap = MOVES[m.id].pp;
      if (m.pp < cap) { m.pp = Math.min(cap, m.pp + (it.amount || cap)); changed = true; }
    }
    return changed ? { ok: true, msg: `${name}'s PP was restored.` } : { ok: false };
  }
  return { ok: false };
}

// ---------- Catching ----------
function throwBall(run, out, ball) {
  const b = run.battle;
  if (!b.canCatch || !run.bag[ball]) return false;
  run.bag[ball]--;
  const E = sideMon(run, 'e');
  say(run, out, `You threw a ${ball}!`, { sfx: 'ball' });
  const { caught, shakes } = run.god ? { caught: true, shakes: 3 } : catchAttempt(E, ball, b.turn);
  for (let i = 0; i < shakes; i++) say(run, out, '...', { sfx: 'shake' });
  if (caught) {
    E.ball = ball;
    E.fr = ball === 'Friend Ball' ? 150 : E.fr;
    say(run, out, `Gotcha! ${monName(E)} was caught!`, { sfx: 'caught', caught: true });
    b.caughtMon = E;
    b.over = 'caught';
    payWild(run, out);
    // Catching awards experience, like Gen 6+
    awardExp(run, out, E);
    return true;
  }
  say(run, out, ['Oh no! The Pokémon broke free!', 'Aww! It appeared to be caught!', 'Argh! Almost had it!', 'Shoot! It was so close, too!'][shakes]);
  return false;
}

// ---------- Enemy move selection ----------
function usableMoves(mon) {
  return mon.moves.map((m, i) => ({ ...m, i })).filter(m => m.pp > 0);
}

function chooseEnemyAction(run) {
  const b = run.battle;
  const E = sideMon(run, 'e'), P = sideMon(run, 'p');
  if (b.ev.recharge || b.ev.charging) return { type: 'move', index: null };
  if (b.fullRestores > 0 && E.hp > 0 && E.hp <= maxHp(E) / 4 && Math.random() < 0.8) return { type: 'fullRestore' };
  const usable = usableMoves(E);
  if (!usable.length) return { type: 'move', index: -1 }; // Struggle
  if (b.ai === 0 || (b.ai === 1 && Math.random() < 0.3)) return { type: 'move', index: pick(usable).i };
  const scored = usable.map(m => {
    const mv = MOVES[m.id];
    let score;
    if (mv.c === 'S') {
      const useful = (mv.status && !P.st) || (mv.heal && E.hp < maxHp(E) * 0.5) || (mv.boosts && mv.self && Object.values(b.ev.stg).every(v => v < 2)) || (mv.confuse && !b.pv.conf);
      score = useful ? 25 + rand(25) : 0;
    } else {
      const est = estimateDamage(run, 'e', mv);
      score = est >= P.hp ? 1000 + (mv.pr || 0) * 50 : est;
      score *= (mv.a || 100) / 100;
    }
    return { m, score };
  }).sort((a, b) => b.score - a.score);
  return { type: 'move', index: scored[0].m.i };
}

function doEnemyAction(run, out, action) {
  const b = run.battle;
  const E = sideMon(run, 'e');
  if (E.hp <= 0) return;
  if (action.type === 'fullRestore') {
    b.fullRestores--;
    E.hp = maxHp(E); E.st = null;
    say(run, out, `${b.trainer.title} ${b.trainer.name} used a Full Restore!`, { sfx: 'heal' });
    return;
  }
  const z = heldItem(E);
  const useZ = E.gim === 'z' && !b.gim.e && z?.kind === 'z' && action.index >= 0 && MOVES[E.moves[action.index]?.id]?.t === z.type && MOVES[E.moves[action.index].id].c !== 'S';
  if (useZ) b.gim.e = true;
  useMove(run, out, 'e', action.index, { z: useZ });
}

function estimateDamage(run, side, mv) {
  const b = run.battle;
  const A = sideMon(run, side), D = sideMon(run, oppSide(side));
  if (mv.dmg === 'level') return A.lv;
  if (typeof mv.dmg === 'number') return mv.dmg;
  if (mv.half) return Math.floor(D.hp / 2);
  const phys = mv.c === 'P';
  const atk = effStat(A, side === 'p' ? b.pv : b.ev, phys ? 'atk' : 'spa');
  const def = effStat(D, side === 'p' ? b.ev : b.pv, phys ? 'def' : 'spd');
  const stab = typesOf(A).includes(mv.t) || DEX[A.id].t.includes(mv.t) ? 1.5 : 1;
  const hits = Array.isArray(mv.hits) ? 3 : mv.hits || 1;
  return ((((2 * A.lv) / 5 + 2) * mv.p * atk / def) / 50 + 2) * stab * typeEffect(mv.t, typesOf(D)) * 0.92 * hits;
}

// ---------- Executing a move ----------
function useMove(run, out, side, moveIdx, opts = {}) {
  const b = run.battle;
  const vol = side === 'p' ? b.pv : b.ev;
  const ovol = side === 'p' ? b.ev : b.pv;
  const user = sideMon(run, side), target = sideMon(run, oppSide(side));
  const uname = (side === 'e' && !b.trainer ? 'The wild ' : side === 'e' ? 'The foe\'s ' : '') + monName(user);

  if (run.god && side === 'p') { user.st = null; vol.conf = 0; vol.flinch = false; }
  if (vol.recharge) { vol.recharge = false; say(run, out, `${uname} must recharge!`); return; }

  // Status that prevents moving
  if (user.st === 'frz') {
    const intended = vol.charging || user.moves[moveIdx]?.id;
    if (THAW_USER.has(intended)) { user.st = null; say(run, out, `${uname} thawed out!`); }
    else if (Math.random() < 0.2) { user.st = null; say(run, out, `${uname} thawed out!`); }
    else { say(run, out, `${uname} is frozen solid!`); return; }
  }
  if (user.st === 'slp') {
    user.sl--;
    if (user.sl > 0) { say(run, out, `${uname} is fast asleep.`); vol.charging = null; return; }
    user.st = null; say(run, out, `${uname} woke up!`);
  }
  if (vol.flinch) { vol.flinch = false; say(run, out, `${uname} flinched and couldn't move!`); vol.charging = null; return; }
  if (vol.conf > 0) {
    vol.conf--;
    if (vol.conf === 0) say(run, out, `${uname} snapped out of its confusion!`);
    else {
      say(run, out, `${uname} is confused!`);
      if (Math.random() < 1 / 3 && !(run.god && side === 'p')) {
        const atk = effStat(user, vol, 'atk'), def = effStat(user, vol, 'def');
        const dmg = Math.floor(Math.floor(Math.floor(2 * user.lv / 5 + 2) * 40 * atk / def) / 50) + 2;
        user.hp = Math.max(0, user.hp - dmg);
        say(run, out, 'It hurt itself in its confusion!', { sfx: 'hit' });
        vol.charging = null;
        return;
      }
    }
  }
  if (user.st === 'par' && Math.random() < 0.25) { say(run, out, `${uname} is paralyzed! It can't move!`); vol.charging = null; return; }

  // Pick the move
  let slot = null, mv, moveId;
  if (vol.charging) {
    moveId = vol.charging; mv = MOVES[moveId]; vol.charging = null;
  } else if (moveIdx === -1 || moveIdx == null || !user.moves[moveIdx] || user.moves.every(m => m.pp <= 0)) {
    mv = STRUGGLE; moveId = 'struggle';
  } else {
    slot = user.moves[moveIdx];
    if (slot.pp <= 0) { mv = STRUGGLE; moveId = 'struggle'; }
    else {
      moveId = slot.id; mv = MOVES[moveId];
      if (mv.c === 'S' && fx(user) === 'assaultvest' && !user.bf?.dmax) { say(run, out, `${uname} can't use status moves while holding an Assault Vest!`); return; }
      slot.pp--;
    }
    const noCharge = user.bf?.dmax || ((moveId === 'solarbeam' || moveId === 'solarblade') && weatherIs(run, 'sun'));
    if (mv.charge && mv !== STRUGGLE && !noCharge) {
      vol.charging = moveId;
      say(run, out, `${uname} used ${mv.n}! ${uname} is charging up power!`);
      return;
    }
  }
  if (mv !== STRUGGLE && slot && ['choiceband', 'choicespecs', 'choicescarf'].includes(fx(user)) && !user.bf?.dmax) vol.lock = moveId;

  // Max Moves (Dynamax) and Z-Moves replace the chosen move
  let special = null; // 'max' | 'z'
  if (mv !== STRUGGLE && user.bf?.dmax) {
    special = 'max';
    if (mv.c === 'S') mv = { n: 'Max Guard', t: 'Normal', c: 'S', p: 0, a: 0, protect: 1, maxguard: 1, self: 1 };
    else {
      const gm = user.bf.gmax && user.bf.gmax.mt === mv.t ? user.bf.gmax.move : null;
      const [name, effect] = MAX_MOVES[mv.t] || ['Max Strike', {}];
      mv = { n: gm || name, t: mv.t, c: mv.c, p: mv.mx || maxPower(mv), a: 0, ct: 0, max: effect };
    }
  } else if (opts.z && mv !== STRUGGLE && heldItem(user)?.kind === 'z' && heldItem(user).type === mv.t) {
    special = 'z';
    const who = side === 'p' ? 'You' : `${b.trainer?.title || ''} ${b.trainer?.name || ''}`.trim();
    say(run, out, `${who === 'You' ? 'You' : who} unleashed full-force Z-Power!`, { sfx: 'gimmick', gimmick: 'z' });
    if (side === 'p') { b.gim.p = true; track?.('z', side); }
    if (mv.c === 'S') {
      // Status Z-Moves: the Z-Power effect first, then the move itself
      if (mv.zb) { say(run, out, `${uname} boosted its stats using its Z-Power!`); boost(run, out, side, mv.zb, user); }
      else if (mv.ze === 'clearnegativeboost') { for (const k in vol.stg) if (vol.stg[k] < 0) vol.stg[k] = 0; say(run, out, `${uname} returned its decreased stats to normal using its Z-Power!`); }
      else if (mv.ze === 'heal') { user.hp = maxHp(user); say(run, out, `${uname} restored its HP using its Z-Power!`, { sfx: 'heal' }); }
      mv = { ...mv, n: `Z-${mv.n}` };
    } else {
      mv = { n: Z_MOVES[mv.t], t: mv.t, c: mv.c, p: mv.z || zPower(mv), a: 0, ct: 0, zmove: 1 };
    }
  }
  if (moveId === 'struggle') say(run, out, `${uname} has no moves left!`);
  say(run, out, `${uname} used ${mv.n}!`, { sfx: 'move', side, mtype: mv.t });

  // God mode (admin): the opponent's moves can't touch your team
  if (run.god && side === 'e' && !mv.self) { say(run, out, `${monName(target)} is untouchable in God mode!`); return; }

  // Weather and terrain moves
  if (mv.weather || mv.terrain) {
    const done = mv.weather ? setWeather(run, out, mv.weather) : setTerrain(run, out, mv.terrain);
    if (!done) say(run, out, 'But it failed!');
    curWeather = b.weather?.kind || null;
    return;
  }

  // Protect (Max Guard also blocks Max Moves and Z-Moves)
  if (mv.protect) {
    const chance = 1 / Math.pow(3, vol.protectChain);
    if (Math.random() < chance) { vol.protect = true; vol.maxguard = !!mv.maxguard; vol.protectChain++; say(run, out, `${uname} protected itself!`); }
    else { vol.protectChain = 0; say(run, out, 'But it failed!'); }
    return;
  }
  vol.protectChain = 0;

  const selfTarget = !!mv.self;
  const tSide = selfTarget ? side : oppSide(side);
  const tMon = selfTarget ? user : target;
  const tname = selfTarget ? uname : (side === 'p' && !b.trainer ? 'the wild ' : side === 'p' ? 'the foe\'s ' : '') + monName(target);
  if (!selfTarget && target.hp <= 0) { say(run, out, 'But there was no target...'); return; }
  let throughProtect = false;
  if (!selfTarget && ovol.protect) {
    if (special && mv.c !== 'S' && !ovol.maxguard) throughProtect = true;
    else { say(run, out, `${monName(target)} protected itself!`); return; }
  }
  // Psychic Terrain stops priority moves against grounded Pokémon
  if (!selfTarget && (mv.pr || 0) > 0 && terrainIs(run, 'psychic') && grounded(target)) { say(run, out, `${monName(target)} is protected by the Psychic Terrain!`); return; }

  // Accuracy (Max Moves and Z-Moves never miss; Thunder/Hurricane in rain and Blizzard in snow can't miss)
  const sureHit = (weatherIs(run, 'rain') && (moveId === 'thunder' || moveId === 'hurricane')) || (weatherIs(run, 'snow') && moveId === 'blizzard');
  if (!selfTarget && !special && !sureHit) {
    if (mv.ohko) {
      if (target.lv > user.lv || target.bf?.dmax || Math.random() * 100 >= 30 + user.lv - target.lv) { say(run, out, `${uname}'s attack missed!`); return; }
    } else if (mv.a) {
      const chance = mv.a * accMult(vol.stg.accuracy - ovol.stg.evasion);
      if (Math.random() * 100 >= chance) { say(run, out, `${uname}'s attack missed!`); return; }
    }
  }

  // Grass types (and Overcoat) are immune to powder moves (Gen 6+)
  if (!selfTarget && POWDER.has(moveId) && (typesOf(target).includes('Grass') || target.ab === 'Overcoat')) { say(run, out, `It doesn't affect ${tname}...`); return; }

  if (mv.c === 'S') { statusMove(run, out, side, mv, tSide, tMon, tname); return; }

  // Immunities
  const eff = mv === STRUGGLE ? 1 : typeEffect(mv.t, typesOf(target));
  const immune = absorbs(target.ab, mv.t);
  const godHit = run.god && side === 'p';
  if (eff === 0 && !mv.dmg && !godHit) { say(run, out, `It doesn't affect ${tname}...`); return; }
  if (immune && !godHit) {
    say(run, out, `${monName(target)}'s ${target.ab} made the attack useless!`);
    if (immune === 'heal') target.hp = Math.min(maxHp(target), target.hp + Math.floor(maxHp(target) / 4));
    return;
  }
  if (throughProtect) say(run, out, `${monName(target)} couldn't fully protect itself and got hurt!`);

  // Hits
  let hits = 1;
  if (!special) {
    if (Array.isArray(mv.hits)) hits = mv.hits[0] === 2 && mv.hits[1] === 5 ? [2, 2, 2, 3, 3, 3, 4, 5][rand(8)] : mv.hits[0] + rand(mv.hits[1] - mv.hits[0] + 1);
    else if (mv.hits) hits = mv.hits;
    if (user.ab === 'Skill Link' && Array.isArray(mv.hits)) hits = mv.hits[1];
  }

  let total = 0, landed = 0, crit = false;
  for (let h = 0; h < hits && target.hp > 0; h++) {
    const r = computeDamage(run, side, mv, eff);
    let dmg = throughProtect ? Math.max(1, Math.floor(r.dmg / 4)) : r.dmg;
    const full = target.hp === maxHp(target);
    if (!godHit && dmg >= target.hp) {
      if (target.ab === 'Sturdy' && full) { dmg = target.hp - 1; say(run, out, `${monName(target)} endured the hit!`); }
      else if (fx(target) === 'focussash' && full) { dmg = target.hp - 1; target.item = null; say(run, out, `${monName(target)} hung on using its Focus Sash!`); }
      else if (fx(target) === 'focusband' && Math.random() < 0.1) { dmg = target.hp - 1; say(run, out, `${monName(target)} hung on using its Focus Band!`); }
    }
    target.hp = Math.max(0, target.hp - dmg);
    total += dmg; landed++; crit = crit || r.crit;
    if (r.crit) say(run, out, 'A critical hit!', { sfx: 'hit', hitSide: oppSide(side) });
    else say(run, out, '', { sfx: 'hit', hitSide: oppSide(side), silent: true });
  }
  if (mv.ohko) say(run, out, "It's a one-hit KO!");
  if (eff > 1 && !mv.dmg && !mv.half && !mv.ohko) say(run, out, "It's super effective!");
  if (eff < 1 && eff > 0 && !mv.dmg && !mv.half && !mv.ohko) say(run, out, "It's not very effective...");
  if (hits > 1) say(run, out, `The Pokémon was hit ${landed} time(s)!`);

  // Drain / recoil
  if (mv.drain && total > 0 && user.hp > 0) {
    const heal = Math.max(1, Math.floor(total * mv.drain));
    user.hp = Math.min(maxHp(user), user.hp + heal);
    say(run, out, `${monName(target)} had its energy drained!`);
  }
  if (mv.recoil && total > 0 && user.ab !== 'Rock Head') {
    user.hp = Math.max(0, user.hp - Math.max(1, Math.floor(total * mv.recoil)));
    say(run, out, `${uname} was damaged by the recoil!`);
  }
  if (mv === STRUGGLE) {
    user.hp = Math.max(0, user.hp - Math.max(1, Math.floor(maxHp(user) / 4)));
    say(run, out, `${uname} was damaged by the recoil!`);
  }
  if (mv.faint) { user.hp = 0; }

  // Held items that react to the hit
  if (total > 0) {
    if (mv.ct && fx(target) === 'rockyhelmet' && user.hp > 0 && user.ab !== 'Magic Guard') {
      user.hp = Math.max(0, user.hp - Math.max(1, Math.floor(maxHp(user) / 6)));
      say(run, out, `${uname} was hurt by the Rocky Helmet!`);
    }
    if (fx(user) === 'shellbell' && user.hp > 0 && user.hp < maxHp(user)) {
      user.hp = Math.min(maxHp(user), user.hp + Math.max(1, Math.floor(total / 8)));
      say(run, out, `${uname} restored a little HP using its Shell Bell!`);
    }
    if (fx(user) === 'lifeorb' && user.hp > 0 && user.ab !== 'Magic Guard' && !(run.god && side === 'p')) {
      user.hp = Math.max(0, user.hp - Math.max(1, Math.floor(maxHp(user) / 10)));
      say(run, out, `${uname} lost some of its HP!`);
    }
  }

  // Max Move side effects
  if (mv.max && user.hp > 0) {
    if (mv.max.weather) setWeather(run, out, mv.max.weather);
    if (mv.max.terrain) setTerrain(run, out, mv.max.terrain);
    if (mv.max.self) boost(run, out, side, mv.max.self, user);
    if (mv.max.foe && target.hp > 0) boost(run, out, oppSide(side), mv.max.foe, target);
    curWeather = b.weather?.kind || null;
  }

  // Secondary effects (Max Moves and Z-Moves have none)
  for (const s of special ? [] : mv.sec || []) {
    if (Math.random() * 100 >= s.ch * (user.ab === 'Serene Grace' ? 2 : 1)) continue;
    if (s.selfBoosts && user.hp > 0) boost(run, out, side, s.selfBoosts, user);
    if (target.hp <= 0 || target.ab === 'Shield Dust') continue;
    if (s.status) inflict(run, out, oppSide(side), target, s.status, true);
    // Flinch is cleared at end of turn, so it only matters if the target hasn't moved yet (Dynamax can't flinch)
    if (s.flinch && !target.bf?.dmax) (side === 'p' ? b.ev : b.pv).flinch = true;
    if (s.confuse) confuse(run, out, oppSide(side), target);
    if (s.boosts) boost(run, out, oppSide(side), s.boosts, target);
  }
  if (!special && mv.selfBoosts && user.hp > 0) boost(run, out, side, mv.selfBoosts, user);
  if (!special && mv.recharge) vol.recharge = true;
  // Fire moves thaw a frozen target
  if ((mv.t === 'Fire' || THAW_TARGET.has(moveId)) && target.st === 'frz' && target.hp > 0) { target.st = null; say(run, out, `${monName(target)} thawed out!`); }
  berryCheck(run, out, target);
  berryCheck(run, out, user);
}

// Max Move and Z-Move power when the data has none (Gen 7/8 tables)
function maxPower(mv) {
  const p = mv.p || 60;
  const fight = mv.t === 'Fighting' || mv.t === 'Poison';
  const table = fight ? [[40, 70], [50, 75], [60, 80], [70, 85], [100, 90], [140, 95], [999, 100]] : [[40, 90], [50, 100], [60, 110], [70, 120], [100, 130], [140, 140], [999, 150]];
  return table.find(([lim]) => p <= lim)[1];
}
function zPower(mv) {
  const p = mv.p || 60;
  return [[55, 100], [65, 120], [75, 140], [85, 160], [95, 175], [100, 180], [110, 185], [125, 190], [130, 195], [999, 200]].find(([lim]) => p <= lim)[1];
}

/** Berries: Sitrus/Oran at half HP or less, Lum for status. */
function berryCheck(run, out, mon) {
  if (!mon || mon.hp <= 0) return;
  const f = fx(mon);
  const m = maxHp(mon);
  if ((f === 'sitrus' || f === 'oran') && mon.hp <= m / 2) {
    const heal = f === 'sitrus' ? Math.floor(m / 4) : 10;
    mon.hp = Math.min(m, mon.hp + heal);
    say(run, out, `${monName(mon)} restored its health using its ${mon.item}!`, { sfx: 'heal' });
    mon.item = null;
  }
  if (f === 'lum' && mon.st) {
    mon.st = null; mon.sl = 0;
    say(run, out, `${monName(mon)}'s Lum Berry cured its status!`, { sfx: 'heal' });
    mon.item = null;
  }
}

function absorbs(ability, type) {
  const map = {
    Levitate: ['Ground'], 'Volt Absorb': ['Electric', 'heal'], 'Water Absorb': ['Water', 'heal'], 'Dry Skin': ['Water', 'heal'],
    'Flash Fire': ['Fire'], 'Sap Sipper': ['Grass'], 'Lightning Rod': ['Electric'], 'Storm Drain': ['Water'],
    'Motor Drive': ['Electric'], 'Earth Eater': ['Ground', 'heal'], 'Well-Baked Body': ['Fire'],
  }[ability];
  if (!map || map[0] !== type) return null;
  return map[1] || 'immune';
}

function computeDamage(run, side, mv, eff) {
  const b = run.battle;
  const vol = side === 'p' ? b.pv : b.ev, ovol = side === 'p' ? b.ev : b.pv;
  const A = sideMon(run, side), D = sideMon(run, oppSide(side));
  if (run.god && side === 'p') return { dmg: D.hp, crit: false };
  if (mv.dmg === 'level') return { dmg: A.lv, crit: false };
  if (typeof mv.dmg === 'number') return { dmg: mv.dmg, crit: false };
  if (mv.half) return { dmg: Math.max(1, Math.floor(D.hp / 2)), crit: false };
  if (mv.ohko) return { dmg: D.hp, crit: false };

  const critStage = Math.min(3, (mv.crit ? mv.crit - 1 : 0) + (A.ab === 'Super Luck' ? 1 : 0) + (fx(A) === 'scopelens' ? 1 : 0));
  const crit = mv.crit >= 99 || Math.random() < [1 / 24, 1 / 8, 1 / 2, 1][critStage];
  const phys = mv.c === 'P';
  let atk = effStat(A, vol, phys ? 'atk' : 'spa', { crit, attacking: true });
  const def = effStat(D, ovol, phys ? 'def' : 'spd', { crit });
  let power = mv.p;
  // Terastallized moves of the Tera Type hit with at least 60 power
  if (A.bf?.tera === mv.t && power < 60 && !mv.hits && !(mv.pr > 0)) power = 60;
  if (A.ab === 'Technician' && power <= 60) power = Math.floor(power * 1.5);
  const item = heldItem(A);
  if (item?.fx === 'boost' && item.type === mv.t) power = Math.floor(power * 1.2);
  if ((item?.fx === 'muscleband' && phys) || (item?.fx === 'wiseglasses' && !phys)) power = Math.floor(power * 1.1);
  const pinch = { Overgrow: 'Grass', Blaze: 'Fire', Torrent: 'Water', Swarm: 'Bug' }[A.ab];
  if (pinch === mv.t && A.hp <= maxHp(A) / 3) atk = Math.floor(atk * 1.5);
  if (A.ab === 'Guts' && A.st) atk = Math.floor(atk * 1.5);

  let dmg = Math.floor(Math.floor(Math.floor(2 * A.lv / 5 + 2) * power * atk / def) / 50) + 2;
  if (crit) dmg = Math.floor(dmg * 1.5);
  dmg = Math.floor(dmg * (85 + rand(16)) / 100);
  // Weather and terrain
  const w = b.weather?.kind;
  if ((w === 'sun' && mv.t === 'Fire') || (w === 'rain' && mv.t === 'Water')) dmg = Math.floor(dmg * 1.5);
  if ((w === 'sun' && mv.t === 'Water') || (w === 'rain' && mv.t === 'Fire')) dmg = Math.floor(dmg / 2);
  const tr = b.terrain?.kind;
  if (grounded(A) && ((tr === 'electric' && mv.t === 'Electric') || (tr === 'grassy' && mv.t === 'Grass') || (tr === 'psychic' && mv.t === 'Psychic'))) dmg = Math.floor(dmg * 1.3);
  if (tr === 'misty' && mv.t === 'Dragon' && grounded(D)) dmg = Math.floor(dmg / 2);
  // STAB, including Terastallization (2× when the Tera Type matches an original type)
  const orig = A.bf?.t || DEX[A.id].t;
  const tera = A.bf?.tera;
  let stab = 1;
  if (tera && mv.t === tera) stab = orig.includes(tera) ? 2 : 1.5;
  else if (orig.includes(mv.t)) stab = 1.5;
  if (stab > 1 && A.ab === 'Adaptability') stab = stab === 2 ? 2.25 : 2;
  dmg = Math.floor(dmg * stab);
  dmg = Math.floor(dmg * eff);
  if (phys && A.st === 'brn' && A.ab !== 'Guts') dmg = Math.floor(dmg / 2);
  if (D.ab === 'Thick Fat' && (mv.t === 'Fire' || mv.t === 'Ice')) dmg = Math.floor(dmg / 2);
  if ((D.ab === 'Filter' || D.ab === 'Solid Rock') && eff > 1) dmg = Math.floor(dmg * 0.75);
  if (item?.fx === 'expertbelt' && eff > 1) dmg = Math.floor(dmg * 1.2);
  if (item?.fx === 'lifeorb') dmg = Math.floor(dmg * 1.3);
  return { dmg: Math.max(1, dmg), crit };
}

function statusMove(run, out, side, mv, tSide, tMon, tname) {
  const b = run.battle;
  const user = sideMon(run, side);
  let did = false;
  if (mv.haze) {
    b.pv.stg = freshVolatile().stg; b.ev.stg = freshVolatile().stg;
    say(run, out, 'All stat changes were eliminated!'); return;
  }
  if (mv.rest) {
    if (user.hp >= maxHp(user)) { say(run, out, 'But it failed!'); return; }
    user.hp = maxHp(user); user.st = 'slp'; user.sl = 3;
    say(run, out, `${monName(user)} slept and became healthy!`); return;
  }
  if (mv.heal) {
    const m = maxHp(user);
    if (user.hp >= m) { say(run, out, `${monName(user)}'s HP is full!`); return; }
    user.hp = Math.min(m, user.hp + Math.floor(m * mv.heal));
    say(run, out, `${monName(user)} restored HP!`, { sfx: 'heal' }); return;
  }
  if (mv.status) {
    if (mv.t === 'Electric' && typeEffect('Electric', typesOf(tMon)) === 0) { say(run, out, `It doesn't affect ${tname}...`); return; }
    did = inflict(run, out, tSide, tMon, mv.status, false) || did;
  }
  if (mv.confuse) did = confuse(run, out, tSide, tMon) || did;
  if (mv.boosts) did = boost(run, out, tSide, mv.boosts, tMon) || did;
  if (mv.selfBoosts) did = boost(run, out, side, mv.selfBoosts, user) || did;
  if (!did && !mv.status && !mv.boosts && !mv.confuse) say(run, out, 'But nothing happened!');
}

function inflict(run, out, tSide, mon, st, secondary) {
  const types = typesOf(mon);
  const tr = run.battle.terrain?.kind;
  if (grounded(mon) && (tr === 'misty' || (tr === 'electric' && st === 'slp'))) {
    if (!secondary) say(run, out, `${monName(mon)} is protected by the ${tr === 'misty' ? 'Misty' : 'Electric'} Terrain!`);
    return false;
  }
  const name = monName(mon);
  const immune = (st === 'brn' && types.includes('Fire')) || (st === 'par' && types.includes('Electric')) ||
    ((st === 'psn' || st === 'tox') && (types.includes('Poison') || types.includes('Steel'))) ||
    (st === 'frz' && types.includes('Ice')) ||
    (st === 'slp' && ['Insomnia', 'Vital Spirit', 'Sweet Veil'].includes(mon.ab)) ||
    (st === 'par' && mon.ab === 'Limber') || ((st === 'psn' || st === 'tox') && mon.ab === 'Immunity') ||
    (st === 'brn' && mon.ab === 'Water Veil');
  if (mon.st || immune || mon.hp <= 0) {
    if (!secondary) say(run, out, mon.st === st ? `${name} is already ${STATUS_NAMES[st]}!` : `It doesn't affect ${name}...`);
    return false;
  }
  mon.st = st;
  if (st === 'slp') mon.sl = 1 + 1 + rand(3); // sleeps 1–3 turns
  if (st === 'tox') (tSide === 'p' ? run.battle.pv : run.battle.ev).tox = 1;
  say(run, out, `${name} ${st === 'slp' ? 'fell asleep!' : st === 'frz' ? 'was frozen solid!' : 'was ' + STATUS_NAMES[st] + '!'}`, { sfx: 'status' });
  berryCheck(run, out, mon);
  return true;
}

function confuse(run, out, tSide, mon) {
  const vol = tSide === 'p' ? run.battle.pv : run.battle.ev;
  if (vol.conf > 0 || mon.ab === 'Own Tempo' || mon.hp <= 0) { return false; }
  vol.conf = 2 + rand(4);
  say(run, out, `${monName(mon)} became confused!`);
  return true;
}

function boost(run, out, tSide, boosts, mon) {
  const vol = tSide === 'p' ? run.battle.pv : run.battle.ev;
  let did = false;
  for (const [k, raw] of Object.entries(boosts)) {
    if (!(k in vol.stg)) continue;
    const v = raw;
    const before = vol.stg[k];
    vol.stg[k] = Math.max(-6, Math.min(6, before + v));
    const name = monName(mon);
    if (vol.stg[k] === before) say(run, out, `${name}'s ${STAGE_NAMES[k]} won't go any ${v > 0 ? 'higher' : 'lower'}!`);
    else {
      did = true;
      const d = Math.abs(vol.stg[k] - before);
      say(run, out, `${name}'s ${STAGE_NAMES[k]} ${v > 0 ? 'rose' : 'fell'}${d >= 3 ? ' drastically' : d === 2 ? ' sharply' : ''}!`, { sfx: v > 0 ? 'up' : 'down' });
    }
  }
  if (fx(mon) === 'whiteherb' && Object.values(vol.stg).some(x => x < 0)) {
    for (const k in vol.stg) if (vol.stg[k] < 0) vol.stg[k] = 0;
    mon.item = null;
    say(run, out, `${monName(mon)} returned its stats to normal using its White Herb!`);
  }
  return did;
}

// ---------- End of turn & fainting ----------
function endOfTurn(run, out) {
  const b = run.battle;
  if (b.over) return;
  // Weather
  if (b.weather) {
    const w = b.weather.kind;
    if (w === 'sand') {
      for (const side of ['p', 'e']) {
        const mon = sideMon(run, side);
        const t = typesOf(mon);
        if (mon.hp <= 0 || t.includes('Rock') || t.includes('Ground') || t.includes('Steel') || ['Sand Veil', 'Sand Rush', 'Sand Force', 'Overcoat', 'Magic Guard'].includes(mon.ab) || (run.god && side === 'p')) continue;
        mon.hp = Math.max(0, mon.hp - Math.max(1, Math.floor(maxHp(mon) / 16)));
        say(run, out, `${monName(mon)} is buffeted by the sandstorm!`);
      }
    }
    if (--b.weather.turns <= 0) { say(run, out, WEATHER[w][1]); b.weather = null; }
  }
  // Terrain
  if (b.terrain) {
    if (b.terrain.kind === 'grassy') {
      for (const side of ['p', 'e']) {
        const mon = sideMon(run, side);
        if (mon.hp > 0 && grounded(mon) && mon.hp < maxHp(mon)) { mon.hp = Math.min(maxHp(mon), mon.hp + Math.max(1, Math.floor(maxHp(mon) / 16))); say(run, out, `${monName(mon)}'s HP was restored by the Grassy Terrain.`); }
      }
    }
    if (--b.terrain.turns <= 0) { say(run, out, TERRAIN[b.terrain.kind][1]); b.terrain = null; }
  }
  curWeather = b.weather?.kind || null;
  for (const side of ['p', 'e']) {
    const mon = sideMon(run, side);
    const vol = side === 'p' ? b.pv : b.ev;
    vol.protect = false; vol.flinch = false; vol.maxguard = false;
    if (mon.hp > 0 && fx(mon) === 'leftovers' && mon.hp < maxHp(mon)) {
      mon.hp = Math.min(maxHp(mon), mon.hp + Math.max(1, Math.floor(maxHp(mon) / 16)));
      say(run, out, `${monName(mon)} restored a little HP using its Leftovers!`);
    }
    if (mon.hp > 0 && mon.st && mon.ab !== 'Magic Guard' && !(run.god && side === 'p')) {
      const m = maxHp(mon);
    if (mon.st === 'brn') { mon.hp = Math.max(0, mon.hp - Math.max(1, Math.floor(m / 16))); say(run, out, `${monName(mon)} was hurt by its burn!`); }
    if (mon.st === 'psn') { mon.hp = Math.max(0, mon.hp - Math.max(1, Math.floor(m / 8))); say(run, out, `${monName(mon)} was hurt by poison!`); }
    if (mon.st === 'tox') { mon.hp = Math.max(0, mon.hp - Math.max(1, Math.floor(m * vol.tox / 16))); vol.tox = Math.min(15, vol.tox + 1); say(run, out, `${monName(mon)} was hurt by poison!`); }
    }
    berryCheck(run, out, mon);
    // Dynamax lasts three turns
    if (mon.bf?.dmax && mon.hp > 0) {
      mon.bf.dmax--;
      if (mon.bf.dmax <= 0) { endDynamax(mon); say(run, out, `${monName(mon)} returned to its normal size!`, { send: side }); }
    }
  }
  checkFaints(run, out);
}

function checkFaints(run, out) {
  const b = run.battle;
  const E = sideMon(run, 'e'), P = sideMon(run, 'p');
  if (E.hp <= 0) {
    say(run, out, `${b.trainer ? 'The foe\'s' : 'The wild'} ${monName(E)} fainted!`, { faint: 'e', sfx: 'faint' });
    awardExp(run, out, E);
    const next = b.enemy.findIndex(m => m.hp > 0);
    if (next >= 0 && b.trainer) {
      if (P.hp > 0) switchIn(run, out, 'e', next);
      else b.pendingEnemy = next;
    } else {
      b.over = 'win';
      if (b.trainer) {
        say(run, out, `You defeated ${b.trainer.title} ${b.trainer.name}!`, { sfx: 'victory' });
        if (b.trainer.quote) say(run, out, `${b.trainer.name}: "${b.trainer.quote}"`);
        const prize = (b.trainer.prize || 0) * (run.party.some(m => fx(m) === 'amuletcoin') ? 2 : 1);
        if (prize) { run.money += prize; say(run, out, `You got $${prize.toLocaleString()} for winning!`, { sfx: 'coin' }); }
      } else {
        payWild(run, out);
      }
    }
  }
  if (P.hp <= 0) {
    say(run, out, `${monName(P)} fainted!`, { faint: 'p', sfx: 'faint' });
    P.fr = Math.max(0, P.fr - 1);
    P.st = null;
    if (!b.over) {
      if (run.party.some(m => m.hp > 0)) b.phase = 'forceSwitch';
      else { b.over = 'lose'; say(run, out, 'You are out of usable Pokémon!'); say(run, out, 'You blacked out...'); }
    } else if (b.over === 'win' && !run.party.some(m => m.hp > 0)) {
      // Both fainted on the last hit: the player still wins in the games when the foe faints first.
    }
  }
  if (b.pendingEnemy != null && b.phase === 'choose' && !b.over) {
    const n = b.pendingEnemy; b.pendingEnemy = null; switchIn(run, out, 'e', n);
  }
}

function payWild(run, out) {
  const b = run.battle;
  if (!b.wildPrize || b.paid) return;
  b.paid = true;
  const prize = b.wildPrize * (run.party.some(m => fx(m) === 'amuletcoin') ? 2 : 1);
  run.money += prize;
  say(run, out, `You picked up $${prize.toLocaleString()}!`, { sfx: 'coin' });
}

function awardExp(run, out, defeated) {
  const b = run.battle;
  const trainer = !!b.trainer;
  for (const mon of run.party) {
    if (mon.hp <= 0 || mon.lv >= 100) continue;
    const participated = b.participants.includes(mon.uid);
    const amount = Math.max(1, Math.round(expYield(defeated, mon.lv, { trainer, share: !participated }) * diffOf(run).expMult * (fx(mon) === 'luckyegg' ? 1.5 : 1)));
    addEvs(mon, defeated.id);
    const before = mon.lv;
    say(run, out, `${monName(mon)} gained ${amount.toLocaleString()} Exp. Points!`, { sfx: participated ? 'exp' : null });
    const events = gainExp(mon, amount);
    for (const e of events) {
      if (e.type === 'level') say(run, out, `${monName(mon)} grew to Lv. ${e.lv}!`, { sfx: 'levelup', levelUp: mon.uid });
      if (e.type === 'learn') say(run, out, `${monName(mon)} learned ${MOVES[e.move].n}!`, { sfx: 'learn' });
      if (e.type === 'learnFull') b.learnQueue.push({ uid: mon.uid, move: e.move });
    }
    if (mon.lv > before && !b.leveled.includes(mon.uid)) b.leveled.push(mon.uid);
  }
}

export function battleView(run) {
  const b = run.battle;
  return { p: snap(sideMon(run, 'p')), e: snap(sideMon(run, 'e')), weather: b?.weather?.kind || null, terrain: b?.terrain?.kind || null };
}
