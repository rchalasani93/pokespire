// Generates public/data/*.json from @pkmn/dex (species, moves, learnsets, evolutions)
// and PokeAPI CSVs (catch rate, growth rate, base EXP yield, EV yield).
// Usage: node scripts/build-data.mjs   (needs network for the PokeAPI CSVs)
import { Dex } from '@pkmn/dex';
import { writeFileSync, mkdirSync } from 'node:fs';
import { orderLearnsets } from './learnset-order.mjs';

const CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
async function csv(name) {
  const text = await (await fetch(CSV + name + '.csv')).text();
  const [head, ...rows] = text.trim().split('\n');
  const cols = head.split(',');
  return rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])));
}
const GROWTH = { 1: 'slow', 2: 'medium', 3: 'fast', 4: 'mediumslow', 5: 'erratic', 6: 'fluctuating' };
const STAT_KEYS = { 1: 'hp', 2: 'atk', 3: 'def', 4: 'spa', 5: 'spd', 6: 'spe' };

const speciesCsv = Object.fromEntries((await csv('pokemon_species')).map(r => [+r.id, r]));
const pokemonCsv = Object.fromEntries((await csv('pokemon')).filter(r => r.is_default === '1').map(r => [+r.species_id, r]));
const evYield = {};
for (const r of await csv('pokemon_stats')) {
  const id = +r.pokemon_id;
  if (id > 1025 || +r.effort === 0) continue;
  (evYield[id] ||= {})[STAT_KEYS[r.stat_id]] = +r.effort;
}

const base = Dex.species.all().filter(s => s.num >= 1 && s.num <= 1025 && !s.forme && s.exists);
const byName = Object.fromEntries(base.map(s => [s.name, s]));
const pokedex = {};
const learnsets = {};
const usedMoves = new Set();

for (const s of base) {
  const c = speciesCsv[s.num] || {};
  // Level-up learnset from the most recent generation that has one
  let ls = (await Dex.learnsets.get(s.id))?.learnset;
  if (!ls && s.baseSpecies !== s.name) ls = (await Dex.learnsets.get(Dex.species.get(s.baseSpecies).id))?.learnset;
  const byGen = {};
  for (const [move, sources] of Object.entries(ls || {})) {
    for (const src of sources) {
      const m = /^(\d)L(\d+)$/.exec(src);
      if (m) (byGen[m[1]] ||= []).push([+m[2], move]);
    }
  }
  const gen = Math.max(0, ...Object.keys(byGen).map(Number));
  const list = (byGen[gen] || []).sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  list.forEach(([, m]) => usedMoves.add(m));
  learnsets[s.num] = list;

  const evos = (s.evos || []).map(n => byName[n]).filter(Boolean).map(e => {
    const evo = { to: e.num };
    if (e.evoLevel) evo.level = e.evoLevel;
    if (e.evoType) evo.type = e.evoType; // useItem, trade, levelFriendship, levelMove, levelHold, levelExtra, other
    if (e.evoItem) evo.item = e.evoItem;
    if (e.evoCondition) evo.cond = e.evoCondition;
    if (e.evoMove) evo.move = Dex.moves.get(e.evoMove).id;
    return evo;
  });
  const tags = s.tags || [];
  pokedex[s.num] = {
    n: s.name,
    t: s.types,
    b: [s.baseStats.hp, s.baseStats.atk, s.baseStats.def, s.baseStats.spa, s.baseStats.spd, s.baseStats.spe],
    a: [s.abilities[0], s.abilities[1]].filter(Boolean),
    ...(s.abilities.H ? { h: s.abilities.H } : {}),
    cr: +c.capture_rate || 45,
    gr: GROWTH[c.growth_rate_id] || 'medium',
    xp: +(pokemonCsv[s.num]?.base_experience) || 64,
    ev: evYield[s.num] || { hp: 1 },
    bh: c.base_happiness === '' ? 50 : +c.base_happiness,
    ...(evos.length ? { e: evos } : {}),
    ...(s.prevo && byName[s.prevo] ? { p: byName[s.prevo].num } : {}),
    ...(tags.includes('Restricted Legendary') || tags.includes('Sub-Legendary') ? { L: 1 } : {}),
    ...(tags.includes('Mythical') ? { M: 1 } : {}),
    ...(tags.includes('Ultra Beast') ? { U: 1 } : {}),
    ...(tags.includes('Paradox') ? { X: 1 } : {}),
    ...(+c.is_baby ? { baby: 1 } : {}),
  };
}

const moves = {};
for (const id of usedMoves) {
  const m = Dex.moves.get(id);
  if (!m.exists) continue;
  const o = { n: m.name, t: m.type, c: { Physical: 'P', Special: 'X', Status: 'S' }[m.category], p: m.basePower, a: m.accuracy === true ? 0 : m.accuracy, pp: m.pp };
  if (m.priority) o.pr = m.priority;
  if (m.target === 'self' || m.target === 'allySide' || m.target === 'adjacentAllyOrSelf' || m.target === 'allies') o.self = 1;
  if (m.boosts) o.boosts = m.boosts;
  if (m.status) o.status = m.status;
  if (m.volatileStatus === 'confusion') o.confuse = 1;
  if (m.self?.boosts) o.selfBoosts = m.self.boosts;
  if (m.drain) o.drain = m.drain[0] / m.drain[1];
  if (m.recoil) o.recoil = m.recoil[0] / m.recoil[1];
  if (m.heal) o.heal = m.heal[0] / m.heal[1];
  if (m.multihit) o.hits = m.multihit;
  if (m.ohko) o.ohko = 1;
  if (m.damage) o.dmg = m.damage; // 'level' or fixed number
  if (m.id === 'superfang' || m.id === 'ruination' || m.id === 'naturesmadness') o.half = 1;
  if (m.critRatio && m.critRatio > 1) o.crit = m.critRatio;
  if (m.willCrit) o.crit = 99;
  if (m.flags?.charge) o.charge = 1;
  if (m.flags?.recharge || m.self?.volatileStatus === 'mustrecharge') o.recharge = 1;
  if (m.selfdestruct === 'always') o.faint = 1;
  if (['rest'].includes(m.id)) o.rest = 1;
  if (['protect', 'detect', 'spikyshield', 'kingsshield', 'banefulbunker', 'obstruct', 'silktrap', 'burningbulwark'].includes(m.id)) o.protect = 1;
  if (m.id === 'haze') o.haze = 1;
  const sec = (m.secondaries || []).map(s => {
    const x = { ch: s.chance || 100 };
    if (s.status) x.status = s.status;
    if (s.volatileStatus === 'flinch') x.flinch = 1;
    if (s.volatileStatus === 'confusion') x.confuse = 1;
    if (s.boosts) x.boosts = s.boosts;
    if (s.self?.boosts) x.selfBoosts = s.self.boosts;
    return x;
  }).filter(x => Object.keys(x).length > 1);
  if (sec.length) o.sec = sec;
  if (m.category !== 'Status' && !m.basePower && !m.damage && !m.ohko && !o.half) o.p = 60; // variable-power moves
  // Z-Move and Max Move power, Z effects of status moves, weather/terrain setters, contact
  if (m.category !== 'Status') { if (m.zMove?.basePower) o.z = m.zMove.basePower; if (m.maxMove?.basePower) o.mx = m.maxMove.basePower; }
  else if (m.zMove?.boost) o.zb = m.zMove.boost;
  else if (m.zMove?.effect) o.ze = m.zMove.effect;
  if (m.weather) o.weather = { sunnyday: 'sun', raindance: 'rain', sandstorm: 'sand', snowscape: 'snow', hail: 'snow', chillyreception: 'snow' }[m.id] || null;
  if (m.terrain) o.terrain = { electricterrain: 'electric', grassyterrain: 'grassy', psychicterrain: 'psychic', mistyterrain: 'misty' }[m.id] || null;
  if (m.flags?.contact) o.ct = 1;
  o.d = m.shortDesc;
  moves[id] = o;
}

// Strip moves we never kept from learnsets
for (const k of Object.keys(learnsets)) learnsets[k] = learnsets[k].filter(([, m]) => moves[m]);
// Same-level moves in mainline order
await orderLearnsets(learnsets);

const typeChart = {};
for (const atk of Dex.types.all()) {
  if (atk.isNonstandard || atk.name === 'Stellar') continue;
  typeChart[atk.name] = {};
}
for (const def of Dex.types.all()) {
  if (def.isNonstandard || def.name === 'Stellar') continue;
  for (const [atk, v] of Object.entries(def.damageTaken)) {
    if (!typeChart[atk]) continue;
    typeChart[atk][def.name] = [1, 2, 0.5, 0][v];
  }
}

// Ability descriptions for every ability a kept species can have
const abilities = {};
for (const sp of Object.values(pokedex)) {
  for (const name of [...sp.a, ...(sp.h ? [sp.h] : [])]) {
    if (abilities[name]) continue;
    const ab = Dex.abilities.get(name);
    abilities[name] = ab.exists ? (ab.shortDesc || ab.desc || '') : '';
  }
}

// Battle forms: Mega Evolution, Primal Reversion and Gigantamax (sprite ids are PokeAPI's)
const pokeapiIds = Object.fromEntries((await csv('pokemon')).map(r => [r.identifier, +r.id]));
const formSlug = name => name.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/--+/g, '-');
const forms = {};
for (const f of Dex.species.all()) {
  if (f.isNonstandard === 'CAP' || !pokedex[f.num]) continue;
  const megaLike = f.forme.startsWith('Mega') || f.forme === 'Primal';
  if (megaLike) {
    const entry = {
      n: f.forme === 'Primal' ? `Primal ${f.baseSpecies}` : `Mega ${f.baseSpecies}${f.forme.replace(/^Mega/, '').replace('-', ' ')}`,
      kind: f.forme === 'Primal' ? 'primal' : 'mega',
      t: f.types, b: [f.baseStats.hp, f.baseStats.atk, f.baseStats.def, f.baseStats.spa, f.baseStats.spd, f.baseStats.spe],
      ab: f.abilities[0], s: pokeapiIds[formSlug(f.name)] || null,
    };
    if (f.requiredItem) entry.item = f.requiredItem;
    if (f.requiredMove) entry.move = Dex.moves.get(f.requiredMove).id;
    if (!entry.item && !entry.move) continue;
    ((forms[f.num] ||= {}).mega ||= []).push(entry);
  }
  if (f.forme === 'Gmax') {
    const base = Dex.species.get(f.baseSpecies);
    const mv = Dex.moves.get(base.canGigantamax);
    (forms[f.num] ||= {}).gmax = { move: mv.name, mt: mv.type, s: pokeapiIds[formSlug(f.name)] || null };
  }
}

mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/forms.json', JSON.stringify(forms));
writeFileSync('public/data/pokedex.json', JSON.stringify(pokedex));
writeFileSync('public/data/moves.json', JSON.stringify(moves));
writeFileSync('public/data/learnsets.json', JSON.stringify(learnsets));
writeFileSync('public/data/types.json', JSON.stringify(typeChart));
writeFileSync('public/data/abilities.json', JSON.stringify(abilities));
console.log('species', Object.keys(pokedex).length, 'moves', Object.keys(moves).length);
