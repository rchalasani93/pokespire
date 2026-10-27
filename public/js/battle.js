// Turn-based single battle engine. The battle object is plain JSON so it can be saved mid-fight.
// Damage, accuracy, stat stages, status, critical hits, experience and catching follow the
// main-series formulas (Gen 5+).
import { DEX, MOVES, typeEffect } from './data.js';
import {
  calcStats, maxHp, monName, expYield, gainExp, addEvs, catchAttempt, rand, pick, uid,
} from './mechanics.js';
import { ITEMS } from './content.js';

const STRUGGLE = { n: 'Struggle', t: '???', c: 'P', p: 50, a: 0, pp: 1, recoilMax: 0.25 };
const STAGE_NAMES = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed', accuracy: 'accuracy', evasion: 'evasiveness' };
const STATUS_NAMES = { brn: 'burned', par: 'paralyzed', psn: 'poisoned', tox: 'badly poisoned', slp: 'asleep', frz: 'frozen' };

const freshVolatile = () => ({ stg: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }, conf: 0, flinch: false, protect: false, protectChain: 0, charging: null, recharge: false, tox: 1 });

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
    caughtMon: null, exp: {},
  };
  run.battle = b;
  const out = [];
  const E = b.enemy[0];
  if (b.trainer) {
    say(run, out, `${b.trainer.title} ${b.trainer.name} wants to battle!`);
    say(run, out, `${b.trainer.title} ${b.trainer.name} sent out ${monName(E)}!`, { send: 'e' });
  } else {
    say(run, out, spec.intro || `A wild ${monName(E)} appeared!`, { send: 'e', sfx: 'cry' });
  }
  say(run, out, `Go! ${monName(run.party[pi])}!`, { send: 'p' });
  entryAbility(run, out, 'p');
  entryAbility(run, out, 'e');
  return out;
}

// ---------- View snapshots for the UI ----------
const sideMon = (run, side) => side === 'p' ? run.party[run.battle.pi] : run.battle.enemy[run.battle.ei];
const oppSide = side => (side === 'p' ? 'e' : 'p');
function snap(mon) {
  return mon ? { uid: mon.uid, id: mon.id, name: monName(mon), lv: mon.lv, hp: mon.hp, max: maxHp(mon), st: mon.st, shiny: mon.shiny } : null;
}
function say(run, out, text, extra = {}) {
  out.push({ text, view: { p: snap(sideMon(run, 'p')), e: snap(sideMon(run, 'e')) }, ...extra });
}

// ---------- Stats in battle ----------
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
  return Math.max(1, v);
}

// ---------- Player actions ----------
export function playerAction(run, action) {
  const b = run.battle;
  const out = [];
  if (b.over || b.phase !== 'choose') return out;
  b.turn++;
  const P = sideMon(run, 'p');

  // Moves that lock the user in
  if (b.pv.recharge || b.pv.charging) action = { type: 'move', locked: true };

  const enemyAction = chooseEnemyAction(run);

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
    const order = turnOrder(run, pMove, enemyAction);
    for (const side of order) {
      if (b.over) break;
      const mon = sideMon(run, side);
      if (mon.hp <= 0 || sideMon(run, oppSide(side)).hp <= 0) continue;
      if (side === 'p') useMove(run, out, 'p', pMove);
      else doEnemyAction(run, out, enemyAction);
    }
  } else if (!b.over) {
    doEnemyAction(run, out, enemyAction);
  }

  endOfTurn(run, out);
  return out;
}

function turnOrder(run, pMoveIdx, enemyAction) {
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
  switchIn(run, out, 'p', index);
  if (b.pendingEnemy != null) { const n = b.pendingEnemy; b.pendingEnemy = null; switchIn(run, out, 'e', n); }
  return out;
}

// ---------- Items ----------
function useBattleItem(run, out, { item, target, moveIndex }) {
  const it = ITEMS[item];
  const mon = run.party[target];
  if (!it || !run.bag[item] || !mon) return;
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
  const { caught, shakes } = catchAttempt(E, ball, b.turn);
  for (let i = 0; i < shakes; i++) say(run, out, '...', { sfx: 'shake' });
  if (caught) {
    E.ball = ball;
    E.fr = ball === 'Friend Ball' ? 150 : E.fr;
    say(run, out, `Gotcha! ${monName(E)} was caught!`, { sfx: 'caught', caught: true });
    b.caughtMon = E;
    b.over = 'caught';
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
  useMove(run, out, 'e', action.index);
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
  const stab = DEX[A.id].t.includes(mv.t) ? 1.5 : 1;
  const hits = Array.isArray(mv.hits) ? 3 : mv.hits || 1;
  return ((((2 * A.lv) / 5 + 2) * mv.p * atk / def) / 50 + 2) * stab * typeEffect(mv.t, DEX[D.id].t) * 0.92 * hits;
}

// ---------- Executing a move ----------
function useMove(run, out, side, moveIdx) {
  const b = run.battle;
  const vol = side === 'p' ? b.pv : b.ev;
  const ovol = side === 'p' ? b.ev : b.pv;
  const user = sideMon(run, side), target = sideMon(run, oppSide(side));
  const uname = (side === 'e' && !b.trainer ? 'The wild ' : side === 'e' ? 'The foe\'s ' : '') + monName(user);

  if (vol.recharge) { vol.recharge = false; say(run, out, `${uname} must recharge!`); return; }

  // Status that prevents moving
  if (user.st === 'frz') {
    if (Math.random() < 0.2) { user.st = null; say(run, out, `${uname} thawed out!`); }
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
      if (Math.random() < 1 / 3) {
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
    else { moveId = slot.id; mv = MOVES[moveId]; slot.pp--; }
    if (mv.charge && mv !== STRUGGLE) {
      vol.charging = moveId;
      say(run, out, `${uname} used ${mv.n}! ${uname} is charging up power!`);
      return;
    }
  }
  if (moveId === 'struggle') say(run, out, `${uname} has no moves left!`);
  say(run, out, `${uname} used ${mv.n}!`, { sfx: 'move', side, mtype: mv.t });

  // Protect
  if (mv.protect) {
    const chance = 1 / Math.pow(3, vol.protectChain);
    if (Math.random() < chance) { vol.protect = true; vol.protectChain++; say(run, out, `${uname} protected itself!`); }
    else { vol.protectChain = 0; say(run, out, 'But it failed!'); }
    return;
  }
  vol.protectChain = 0;

  const selfTarget = !!mv.self;
  const tSide = selfTarget ? side : oppSide(side);
  const tMon = selfTarget ? user : target;
  const tname = selfTarget ? uname : (side === 'p' && !b.trainer ? 'the wild ' : side === 'p' ? 'the foe\'s ' : '') + monName(target);
  if (!selfTarget && target.hp <= 0) { say(run, out, 'But there was no target...'); return; }
  if (!selfTarget && ovol.protect) { say(run, out, `${monName(target)} protected itself!`); return; }

  // Accuracy
  if (!selfTarget) {
    if (mv.ohko) {
      if (target.lv > user.lv || Math.random() * 100 >= 30 + user.lv - target.lv) { say(run, out, `${uname}'s attack missed!`); return; }
    } else if (mv.a) {
      const chance = mv.a * accMult(vol.stg.accuracy - ovol.stg.evasion);
      if (Math.random() * 100 >= chance) { say(run, out, `${uname}'s attack missed!`); return; }
    }
  }

  if (mv.c === 'S') { statusMove(run, out, side, mv, tSide, tMon, tname); return; }

  // Immunities
  const eff = mv === STRUGGLE ? 1 : typeEffect(mv.t, DEX[target.id].t);
  const immune = absorbs(target.ab, mv.t);
  if (eff === 0 && !mv.dmg) { say(run, out, `It doesn't affect ${tname}...`); return; }
  if (immune) {
    say(run, out, `${monName(target)}'s ${target.ab} made the attack useless!`);
    if (immune === 'heal') target.hp = Math.min(maxHp(target), target.hp + Math.floor(maxHp(target) / 4));
    return;
  }

  // Hits
  let hits = 1;
  if (Array.isArray(mv.hits)) hits = mv.hits[0] === 2 && mv.hits[1] === 5 ? [2, 2, 2, 3, 3, 3, 4, 5][rand(8)] : mv.hits[0] + rand(mv.hits[1] - mv.hits[0] + 1);
  else if (mv.hits) hits = mv.hits;
  if (user.ab === 'Skill Link' && Array.isArray(mv.hits)) hits = mv.hits[1];

  let total = 0, landed = 0, crit = false;
  for (let h = 0; h < hits && target.hp > 0; h++) {
    const r = computeDamage(run, side, mv, eff);
    let dmg = r.dmg;
    if (target.ab === 'Sturdy' && target.hp === maxHp(target) && dmg >= target.hp) {
      dmg = target.hp - 1;
      say(run, out, `${monName(target)} endured the hit!`);
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

  // Secondary effects
  for (const s of mv.sec || []) {
    if (Math.random() * 100 >= s.ch * (user.ab === 'Serene Grace' ? 2 : 1)) continue;
    if (s.selfBoosts && user.hp > 0) boost(run, out, side, s.selfBoosts, user);
    if (target.hp <= 0 || target.ab === 'Shield Dust') continue;
    if (s.status) inflict(run, out, oppSide(side), target, s.status, true);
    // Flinch is cleared at end of turn, so it only matters if the target hasn't moved yet
    if (s.flinch) (side === 'p' ? b.ev : b.pv).flinch = true;
    if (s.confuse) confuse(run, out, oppSide(side), target);
    if (s.boosts) boost(run, out, oppSide(side), s.boosts, target);
  }
  if (mv.selfBoosts && user.hp > 0) boost(run, out, side, mv.selfBoosts, user);
  if (mv.recharge) vol.recharge = true;
  // Fire moves thaw a frozen target
  if (mv.t === 'Fire' && target.st === 'frz' && target.hp > 0) { target.st = null; say(run, out, `${monName(target)} thawed out!`); }
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
  if (mv.dmg === 'level') return { dmg: A.lv, crit: false };
  if (typeof mv.dmg === 'number') return { dmg: mv.dmg, crit: false };
  if (mv.half) return { dmg: Math.max(1, Math.floor(D.hp / 2)), crit: false };
  if (mv.ohko) return { dmg: D.hp, crit: false };

  const critStage = Math.min(3, (mv.crit ? mv.crit - 1 : 0) + (A.ab === 'Super Luck' ? 1 : 0));
  const crit = mv.crit >= 99 || Math.random() < [1 / 24, 1 / 8, 1 / 2, 1][critStage];
  const phys = mv.c === 'P';
  let atk = effStat(A, vol, phys ? 'atk' : 'spa', { crit, attacking: true });
  const def = effStat(D, ovol, phys ? 'def' : 'spd', { crit });
  let power = mv.p;
  if (A.ab === 'Technician' && power <= 60) power = Math.floor(power * 1.5);
  const pinch = { Overgrow: 'Grass', Blaze: 'Fire', Torrent: 'Water', Swarm: 'Bug' }[A.ab];
  if (pinch === mv.t && A.hp <= maxHp(A) / 3) atk = Math.floor(atk * 1.5);
  if (A.ab === 'Guts' && A.st) atk = Math.floor(atk * 1.5);

  let dmg = Math.floor(Math.floor(Math.floor(2 * A.lv / 5 + 2) * power * atk / def) / 50) + 2;
  if (crit) dmg = Math.floor(dmg * 1.5);
  dmg = Math.floor(dmg * (85 + rand(16)) / 100);
  if (DEX[A.id].t.includes(mv.t)) dmg = Math.floor(dmg * (A.ab === 'Adaptability' ? 2 : 1.5));
  dmg = Math.floor(dmg * eff);
  if (phys && A.st === 'brn' && A.ab !== 'Guts') dmg = Math.floor(dmg / 2);
  if (D.ab === 'Thick Fat' && (mv.t === 'Fire' || mv.t === 'Ice')) dmg = Math.floor(dmg / 2);
  if ((D.ab === 'Filter' || D.ab === 'Solid Rock') && eff > 1) dmg = Math.floor(dmg * 0.75);
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
    if (mv.t === 'Electric' && typeEffect('Electric', DEX[tMon.id].t) === 0) { say(run, out, `It doesn't affect ${tname}...`); return; }
    did = inflict(run, out, tSide, tMon, mv.status, false) || did;
  }
  if (mv.confuse) did = confuse(run, out, tSide, tMon) || did;
  if (mv.boosts) did = boost(run, out, tSide, mv.boosts, tMon) || did;
  if (mv.selfBoosts) did = boost(run, out, side, mv.selfBoosts, user) || did;
  if (!did && !mv.status && !mv.boosts && !mv.confuse) say(run, out, 'But nothing happened!');
}

function inflict(run, out, tSide, mon, st, secondary) {
  const types = DEX[mon.id].t;
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
  return did;
}

// ---------- End of turn & fainting ----------
function endOfTurn(run, out) {
  const b = run.battle;
  if (b.over) return;
  for (const side of ['p', 'e']) {
    const mon = sideMon(run, side);
    const vol = side === 'p' ? b.pv : b.ev;
    vol.protect = false; vol.flinch = false;
    if (mon.hp <= 0 || !mon.st || mon.ab === 'Magic Guard') continue;
    const m = maxHp(mon);
    if (mon.st === 'brn') { mon.hp = Math.max(0, mon.hp - Math.max(1, Math.floor(m / 16))); say(run, out, `${monName(mon)} was hurt by its burn!`); }
    if (mon.st === 'psn') { mon.hp = Math.max(0, mon.hp - Math.max(1, Math.floor(m / 8))); say(run, out, `${monName(mon)} was hurt by poison!`); }
    if (mon.st === 'tox') { mon.hp = Math.max(0, mon.hp - Math.max(1, Math.floor(m * vol.tox / 16))); vol.tox = Math.min(15, vol.tox + 1); say(run, out, `${monName(mon)} was hurt by poison!`); }
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
        const prize = b.trainer.prize || 0;
        if (prize) { run.money += prize; say(run, out, `You got ₽${prize.toLocaleString()} for winning!`); }
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

function awardExp(run, out, defeated) {
  const b = run.battle;
  const trainer = !!b.trainer;
  for (const mon of run.party) {
    if (mon.hp <= 0 || mon.lv >= 100) continue;
    const participated = b.participants.includes(mon.uid);
    const amount = expYield(defeated, mon.lv, { trainer, share: !participated });
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
  return { p: snap(sideMon(run, 'p')), e: snap(sideMon(run, 'e')) };
}
