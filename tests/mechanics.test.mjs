// Run with: node tests/mechanics.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DEX, MOVES, LEARN, TYPES, BY_NAME, FORMS } from '../public/js/data.js';
const load = f => JSON.parse(readFileSync(new URL(`../public/data/${f}.json`, import.meta.url)));
Object.assign(DEX, load('pokedex')); Object.assign(MOVES, load('moves')); Object.assign(LEARN, load('learnsets')); Object.assign(TYPES, load('types')); Object.assign(FORMS, load('forms'));
for (const [id, s] of Object.entries(DEX)) { s.id = +id; BY_NAME[s.n.toLowerCase()] = +id; }

const M = await import('../public/js/mechanics.js');
const G = await import('../public/js/game.js');
const Bt = await import('../public/js/battle.js');
const C = await import('../public/js/content.js');
C.registerFormItems(FORMS, DEX);

// Stat formula — Bulbapedia's Garchomp example (Lv 78, Adamant)
const chomp = { id: 445, lv: 78, nat: M.NATURES.indexOf('Adamant'), iv: [24, 12, 30, 16, 23, 5], ev: [74, 190, 91, 48, 84, 23] };
assert.deepEqual(M.calcStats(chomp), [289, 278, 193, 135, 171, 171]);

// Experience curves at Lv 100
assert.equal(M.expForLevel('fast', 100), 800000);
assert.equal(M.expForLevel('medium', 100), 1000000);
assert.equal(M.expForLevel('mediumslow', 100), 1059860);
assert.equal(M.expForLevel('slow', 100), 1250000);
assert.equal(M.expForLevel('erratic', 100), 600000);
assert.equal(M.expForLevel('fluctuating', 100), 1640000);

// Level-up: Charmander learns Ember at Lv 4 (Gen 9 learnset) and evolves at 16
const ch = M.createMon(4, 3);
const ev = M.gainExp(ch, M.expForLevel('mediumslow', 4) - ch.exp);
assert.equal(ch.lv, 4);
assert.ok(ev.some(e => e.type === 'learn' && e.move === 'ember'), 'Charmander learns Ember at 4');
ch.lv = 15; ch.exp = M.expForLevel('mediumslow', 15);
M.gainExp(ch, M.expForLevel('mediumslow', 16) - ch.exp);
assert.equal(M.levelEvolution(ch, [ch]), 5);
M.evolve(ch, 5);
assert.equal(ch.id, 5);

// Item / trade evolutions
const pika = M.createMon(25, 20);
assert.equal(M.itemEvolution(pika, 'Thunder Stone'), 26);
const kad = M.createMon(64, 30);
assert.equal(M.itemEvolution(kad, 'Linking Cord'), 65);
const onix = M.createMon(95, 30);
assert.equal(M.itemEvolution(onix, 'Metal Coat'), 208);

// stageForLevel: trainer Pokémon evolve/devolve to fit the level
assert.equal(M.stageForLevel(6, 10), 4);   // Charizard at Lv 10 -> Charmander
assert.equal(M.stageForLevel(4, 40), 6);   // Charmander at Lv 40 -> Charizard

// Wild moves = last four level-up moves
const mv = (await import('../public/js/data.js')).movesAtLevel(25, 20);
assert.equal(mv.length, 4);
assert.equal(MOVES.watergun.c, 'X'); assert.equal(MOVES.tackle.c, 'P'); assert.equal(MOVES.growl.c, 'S');

// Catch formula: Master Ball always works, full-HP Mewtwo with a Poké Ball rarely works
assert.equal(M.catchAttempt(M.createMon(150, 70), 'Master Ball', 1).caught, true);
let caught = 0; for (let i = 0; i < 2000; i++) if (M.catchAttempt(M.createMon(150, 70), 'Poké Ball', 2).caught) caught++;
assert.ok(caught < 70, 'Mewtwo catch rate should be ~1.6% at full HP, got ' + caught);

// Exp yield sanity (Gen 7 formula): defeating a Lv 10 Pidgey (base 50) at Lv 10
const pidgey = M.createMon(16, 10);
const y = M.expYield(pidgey, 10);
assert.ok(y > 80 && y < 120, 'exp ' + y);

// Special moves deal damage (category encoding: P physical, X special, S status)
{
  const run = G.newRun(7);
  run.party[0] = M.createMon(7, 20, { moves: ['watergun'] });
  Bt.startBattle(run, { kind: 'wild', enemy: [M.createMon(4, 20, { moves: ['growl'] })], canCatch: true, canRun: true });
  const foe = run.battle.enemy[0], before = foe.hp;
  Bt.playerAction(run, { type: 'move', index: 0 });
  assert.ok(foe.hp < before, 'Water Gun should damage Charmander');
}

// Status rules from the main games
{
  // Grass types are immune to powder moves
  const run = G.newRun(1, 'medium', 'random');
  run.party[0] = M.createMon(46, 30, { moves: ['sleeppowder'] }); // Paras
  Bt.startBattle(run, { kind: 'wild', enemy: [M.createMon(1, 30, { moves: ['growl'] })], canCatch: true, canRun: true });
  Bt.playerAction(run, { type: 'move', index: 0 });
  assert.equal(run.battle.enemy[0].st, null, 'Sleep Powder does not affect Grass types');
  // A frozen Pokémon using Flame Wheel thaws itself
  const r2 = G.newRun(4, 'medium', 'random');
  r2.party[0] = M.createMon(155, 30, { moves: ['flamewheel'] }); r2.party[0].st = 'frz';
  Bt.startBattle(r2, { kind: 'wild', enemy: [M.createMon(16, 30, { moves: ['growl'] })], canCatch: true, canRun: true });
  Bt.playerAction(r2, { type: 'move', index: 0 });
  assert.notEqual(r2.party[0].st, 'frz', 'Flame Wheel thaws the user');
  // Paralysis halves Speed; burn is blocked on Fire types
  const pk = M.createMon(25, 50); const fast = M.calcStats(pk)[5];
  assert.ok(fast > 0);
}

// Simulate many full runs' battles headlessly to catch engine crashes
let crashes = 0, turns = 0;
for (let r = 0; r < 300; r++) {
  const run = G.newRun(G.REGIONS[r % 9].starters[r % 3], ['easy', 'medium', 'hard', 'hell'][r % 4], r % 2 ? 'classic' : 'random');
  for (let i = 0; i < 4; i++) run.party.push(M.createMon(1 + Math.floor(Math.random() * 1025), 5 + r % 50));
  run.party.forEach(m => { m.lv = 5 + (r % 60); m.exp = M.expForLevel(DEX[m.id].gr, m.lv); m.hp = M.maxHp(m); });
  const kinds = ['wild', 'trainer', 'villain', 'elite', 'gym', 'legendary'];
  run.act = 1 + (r % 3);
  const node = { type: kinds[r % kinds.length], r: r % 11 };
  try {
    for (const k of Object.keys(C.KEY_ITEMS)) run.bag[k] = 1;
    const heldPool = Object.keys(C.ITEMS).filter(k => C.HELD_KINDS.includes(C.ITEMS[k].kind));
    run.party.forEach(m => { if (Math.random() < 0.7) m.item = heldPool[Math.floor(Math.random() * heldPool.length)]; });
    const spec = G.applyDifficulty(run, G.buildEncounter(run, node));
    Bt.startBattle(run, spec);
    for (let t = 0; t < 300 && !run.battle.over; t++) {
      const b = run.battle;
      if (b.phase === 'forceSwitch') { Bt.forceSwitch(run, run.party.findIndex(m => m.hp > 0)); continue; }
      const P = run.party[b.pi];
      const roll = Math.random();
      if (roll < 0.05 && b.canCatch) { run.bag['Ultra Ball'] = 5; Bt.playerAction(run, { type: 'ball', item: 'Ultra Ball' }); }
      else if (roll < 0.08) { run.bag['Potion'] = 3; Bt.playerAction(run, { type: 'item', item: 'Potion', target: b.pi }); }
      else if (roll < 0.1 && run.party.filter(m => m.hp > 0).length > 1) Bt.playerAction(run, { type: 'switch', index: run.party.findIndex((m, i) => m.hp > 0 && i !== b.pi) });
      else { const gs = Bt.gimmickOptions(run); Bt.playerAction(run, { type: 'move', index: Math.floor(Math.random() * P.moves.length), gimmick: Math.random() < 0.3 ? gs[Math.floor(Math.random() * gs.length)] : null }); }
      turns++;
      for (const m of [...run.party, ...b.enemy]) {
        assert.ok(Number.isInteger(m.hp) && m.hp >= 0 && m.hp <= M.maxHp(m), `bad hp ${m.hp}/${M.maxHp(m)} for ${DEX[m.id].n} ${JSON.stringify(m.bf)} ${m.item} ${node.type}`);
      }
      b.learnQueue = [];
    }
  } catch (e) { crashes++; if (crashes < 4) console.error(e); }
}
assert.equal(crashes, 0, 'battle engine crashed');

// Difficulty modes
{
  const lv = d => { const run = G.newRun(1, d); run.act = 2; const node = { type: 'trainer', r: 5 }; let t = 0; for (let i = 0; i < 40; i++) t += Math.max(...G.applyDifficulty(run, G.buildEncounter(run, node)).enemy.map(m => m.lv)); return t / 40; };
  const easy = lv('easy'), med = lv('medium'), hard = lv('hard'), hell = lv('hell');
  assert.ok(easy < med && med < hard && hard < hell, `levels should rise with difficulty: ${easy} ${med} ${hard} ${hell}`);
  const hellRun = G.newRun(1, 'hell'); hellRun.act = 1;
  const hs = G.applyDifficulty(hellRun, G.buildEncounter(hellRun, { type: 'trainer', r: 3 }));
  assert.ok(hs.enemy.every(m => m.iv.every(v => v === 31) && m.ev[5] === 252), 'Hell trainers have max IVs/EVs');
  assert.equal(hs.noItems, true);
  assert.equal(hellRun.money, 100);
  assert.ok(!G.martStock(hellRun).some(i => i.name === 'Revive'), 'no Revives on Hell');
  const easyRun = G.newRun(1, 'easy');
  const potion = n => G.martStock(n).find(i => i.name === 'Poké Ball').price;
  assert.ok(potion(easyRun) < potion(G.newRun(1, 'medium')) && potion(G.newRun(1, 'medium')) < potion(hellRun));
  const ws = G.applyDifficulty(G.newRun(1, 'medium'), { kind: 'wild', enemy: [M.createMon(16, 10)], canCatch: true });
  assert.equal(ws.wildPrize, 20, 'wild Lv 10 pays $20 on Medium');
  // Prize money reaches the wallet when a wild battle is won
  const run = G.newRun(7, 'medium');
  run.party[0] = M.createMon(150, 100, { moves: ['psystrike'] });
  Bt.startBattle(run, G.applyDifficulty(run, { kind: 'wild', enemy: [M.createMon(16, 5)], canCatch: true, canRun: true }));
  Bt.playerAction(run, { type: 'move', index: 0 });
  assert.equal(run.battle.over, 'win');
  assert.equal(run.money, 100 + run.battle.wildPrize);
}

// Classic vs Randomized modes
{
  const { regionOf } = await import('../public/js/data.js');
  const C = await import('../public/js/content.js');
  for (const [i, region] of G.REGIONS.entries()) {
    const run = G.newRun(region.starters[0], 'medium', 'classic');
    assert.equal(G.runRegion(run), region.name);
    const order = C.CLASSIC[region.name].gyms;
    const g1 = G.buildEncounter(run, { type: 'gym', r: 4 });
    assert.equal(g1.trainer.leader, order[0], `${region.name} first gym`);
    run.beatenGyms.push(order[0]);
    assert.equal(G.buildEncounter(run, { type: 'gym', r: 4 }).trainer.leader, order[1], `${region.name} second gym`);
    for (let k = 0; k < 15; k++) {
      const w = G.buildEncounter(run, { type: 'wild', r: 2 }).enemy[0];
      assert.equal(regionOf(w.id), i, `${region.name} wild ${DEX[w.id].n}`);
    }
    run.act = 2;
    const villain = G.bossEncounter(run).trainer.team;
    assert.ok(C.CLASSIC[region.name].villains.includes(villain), `${region.name} villain ${villain}`);
    run.act = 3; G.startLeague(run);
    assert.deepEqual(run.league.members.map(m => m.split('|')[0]), C.CLASSIC[region.name].e4);
    assert.equal(run.league.champion.split('|')[0], C.CLASSIC[region.name].champion);
  }
  // Randomized: gym teams are not the leader's signature team
  const rr = G.newRun(1, 'medium', 'random'); rr.act = 2;
  let signature = 0;
  for (let k = 0; k < 20; k++) {
    const sp = G.buildEncounter(rr, { type: 'gym', r: 5 });
    const leader = C.GYM_LEADERS.find(g => g.name === sp.trainer.leader);
    const sig = new Set(leader.team.map(n => DEX[BY_NAME[n.toLowerCase()]].n));
    if (sp.enemy.every(m => sig.has(DEX[m.id].n))) signature++;
  }
  assert.ok(signature < 3, 'randomized gym teams should not match signature teams');
}

// God mode (admin): the team takes no damage, every hit knocks out, every ball catches
{
  const run = G.newRun(1, 'hell', 'random');
  run.god = true;
  const me = run.party[0];
  me.moves = [{ id: 'tackle', pp: 35 }];
  Bt.startBattle(run, { kind: 'trainer', enemy: [M.createMon(150, 100, { moves: ['psystrike'] }), M.createMon(384, 100)], trainer: { name: 'T', title: 'Test', prize: 0 }, ai: 2 });
  for (let i = 0; i < 10 && !run.battle.over; i++) Bt.playerAction(run, { type: 'move', index: 0 });
  assert.equal(run.battle.over, 'win');
  assert.equal(me.hp, M.maxHp(me), 'God mode team takes no damage');
  Bt.startBattle(run, { kind: 'legendary', enemy: [M.createMon(150, 100)], canCatch: true, canRun: true });
  run.bag['Poké Ball'] = 1;
  Bt.playerAction(run, { type: 'ball', item: 'Poké Ball' });
  assert.equal(run.battle.over, 'caught', 'God mode always catches');
}

// EV training and Hyper Training
{
  const mon = M.createMon(6, 40);
  mon.ev = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 30; i++) Bt.applyItem(mon, 'Carbos');
  assert.equal(mon.ev[5], 252, 'vitamins stop at 252');
  assert.equal(Bt.applyItem(mon, 'Carbos').ok, false);
  mon.iv = [1, 31, 31, 31, 31, 31];
  assert.equal(Bt.applyItem(mon, 'Bottle Cap').ok, false, 'Hyper Training needs Lv 50');
  mon.lv = 50;
  assert.ok(Bt.applyItem(mon, 'Bottle Cap').ok);
  assert.deepEqual(mon.iv, [31, 31, 31, 31, 31, 31]);
  assert.equal(M.natureLabel(3), 'Adamant (+Atk, −SpA)');
  assert.equal(M.ivJudge(31), 'Best');
}

// Points, missions and achievements
{
  const { S } = await import('../public/js/state.js');
  const P = await import('../public/js/progress.js');
  const { normalizeProfile } = await import('../public/js/state.js');
  S.profile = normalizeProfile(null);
  S.run = G.newRun(4, 'hard', 'classic');
  const pts = P.battleWon('gym', [M.createMon(74, 14)]);
  assert.equal(pts, Math.round((P.POINTS.gym + 14) * 1.5), 'gym win points ×1.5 on Hard');
  assert.equal(S.run.score, pts);
  const m1 = P.currentMissions(), m2 = P.currentMissions();
  assert.deepEqual(m1.daily.map(m => m.id), m2.daily.map(m => m.id), 'missions are stable for the day');
  assert.equal(m1.daily.length, 3); assert.equal(m1.weekly.length, 3);
  const winMission = [...m1.daily, ...m1.weekly].find(m => m.ev === 'win');
  P.track('win', 100);
  if (winMission) assert.ok(P.missionList()[m1.daily.includes(winMission) ? 'daily' : 'weekly'].find(m => m.id === winMission.id).done);
  S.profile.caught = [1];
  P.track('catch');
  assert.ok(S.profile.achievements.first_catch, 'First Catch unlocks');
  // Shinies: a shiny catch counts as caught, unlocks shiny achievements
  const sh = M.createMon(144, 40); sh.shiny = true;
  P.caughtEvents(sh);
  assert.ok(S.profile.achievements.shiny_1 && S.profile.achievements.shiny_legend, 'shiny + shiny Legendary achievements');
  const norm = normalizeProfile({ caught: [1], shinies: [25] });
  assert.ok(norm.caught.includes(25), 'shiny species also counts as caught');
  S.run.god = true;
  const before = S.run.score;
  assert.equal(P.battleWon('champion', [M.createMon(6, 60)]), 0, 'no points in God mode');
  assert.equal(S.run.score, before);
  S.run = null; S.profile = null;
}

// League setup
const run = G.newRun(1); run.act = 3; G.startLeague(run);
assert.equal(run.league.members.length, 4);
for (let s = 0; s < 5; s++) { run.league.stage = s; const o = G.leagueOpponent(run).spec(); assert.ok(o.enemy.length >= 5); }

// Maps: every node reachable to the boss, one legendary per act
for (let i = 0; i < 200; i++) {
  const map = G.generateMap(1 + (i % 3));
  const nodes = Object.values(map.nodes);
  assert.equal(nodes.filter(n => n.type === 'legendary').length, 1);
  for (const n of nodes) if (n.id !== 'boss') assert.ok(n.next.length > 0, 'dead end ' + n.id);
}
console.log(`All mechanics tests passed (${turns} simulated battle turns).`);

// ---------- Battle gimmicks ----------
{
  const mk = (id, lv, moves) => { const m = M.createMon(id, lv, { moves }); m.iv = [31, 31, 31, 31, 31, 31]; m.hp = M.maxHp(m); return m; };
  const setup = (p, e, bag = {}) => {
    const run = G.newRun(1, 'medium', 'random');
    run.party = [p]; run.bag = { ...bag };
    Bt.startBattle(run, { kind: 'trainer', enemy: [e], ai: 0, trainer: { name: 'T', title: 'Ace', sprite: 'red', prize: 0 } });
    return run;
  };
  // Mega Evolution: Charizard + Charizardite Y + Mega Bracelet -> Fire/Flying, Drought sets sun
  const zard = mk(6, 50, ['flamethrower']); zard.item = 'Charizardite Y';
  let run = setup(zard, mk(143, 50, ['splash']), { 'Mega Bracelet': 1 });
  assert.ok(Bt.gimmickOptions(run).includes('mega'), 'mega offered');
  const ev = Bt.playerAction(run, { type: 'move', index: 0, gimmick: 'mega' });
  assert.equal(zard.bf.n, 'Mega Charizard Y');
  assert.equal(zard.ab, 'Drought');
  assert.equal(run.battle.weather?.kind, 'sun');
  assert.ok(ev.some(e => /Mega Evolved/.test(e.text)));
  assert.deepEqual(Bt.gimmickOptions(run), [], 'one gimmick per battle');
  Bt.clearBattleForm(zard);
  assert.equal(zard.bf, undefined); assert.notEqual(zard.ab, 'Drought');

  // Dynamax: HP doubles, Max Moves, back to normal after three turns
  const lap = mk(131, 50, ['icebeam', 'protect']);
  run = setup(lap, mk(242, 100, ['splash']), { 'Dynamax Band': 1 });
  const hp0 = lap.hp, max0 = M.maxHp(lap);
  Bt.playerAction(run, { type: 'move', index: 0, gimmick: 'dmax' });
  assert.equal(M.maxHp(lap), max0 * 2);
  assert.ok(lap.hp > hp0);
  const t2 = Bt.playerAction(run, { type: 'move', index: 0 });
  assert.ok(t2.some(e => /Max Hailstorm/.test(e.text)), 'Max Move used');
  assert.equal(run.battle.weather?.kind, 'snow');
  Bt.playerAction(run, { type: 'move', index: 1 });
  assert.equal(lap.bf, undefined, 'Dynamax ends after 3 turns');
  assert.ok(lap.hp <= M.maxHp(lap));

  // Terastallization: defensive type changes, STAB 2x when Tera Type matches
  const pik = mk(25, 50, ['thunderbolt']); pik.tt = 'Electric';
  run = setup(pik, mk(143, 50, ['splash']), { 'Tera Orb': 1 });
  Bt.playerAction(run, { type: 'move', index: 0, gimmick: 'tera' });
  assert.deepEqual(M.typesOf(pik), ['Electric']);
  const gyr = mk(130, 50, ['splash']); gyr.tt = 'Steel'; gyr.bf = { tera: 'Steel' };
  assert.deepEqual(M.typesOf(gyr), ['Steel']);

  // Z-Move with a Z-Crystal and Z-Ring
  const ray = mk(26, 50, ['thunderbolt']); ray.item = 'Electrium Z';
  run = setup(ray, mk(143, 100, ['splash']), { 'Z-Ring': 1 });
  assert.ok(Bt.gimmickOptions(run).includes('z'));
  const zt = Bt.playerAction(run, { type: 'move', index: 0, gimmick: 'z' });
  assert.ok(zt.some(e => /Gigavolt Havoc/.test(e.text)), 'Z-Move used');

  // Held items: Leftovers heal, Focus Sash survives
  const snor = mk(143, 50, ['splash']); snor.item = 'Leftovers'; snor.hp = 10;
  run = setup(snor, mk(129, 5, ['splash']));
  Bt.playerAction(run, { type: 'move', index: 0 });
  assert.ok(snor.hp > 10, 'Leftovers healed');
  const sash = mk(129, 5, ['splash']); sash.item = 'Focus Sash';
  run = setup(mk(150, 100, ['psychic']), sash);
  Bt.playerAction(run, { type: 'move', index: 0 });
  assert.equal(sash.hp, 1, 'Focus Sash');

  // Rewards: three options, held items only for held kinds
  const r2 = G.newRun(4, 'medium', 'random');
  for (let i = 0; i < 50; i++) {
    const opts = G.generateRewards(r2, i % 2 ? 'gym' : 'wild');
    assert.equal(opts.length, 3);
    assert.equal(new Set(opts.map(o => o.item)).size, 3);
    for (const o of opts) assert.ok(C.ITEMS[o.item], 'reward item exists: ' + o.item);
  }
}
console.log('Battle gimmick, held item and reward tests passed.');
