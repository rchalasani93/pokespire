// Points, daily/weekly missions and achievements.
// Points: every win and catch adds to the run's score (scaled by difficulty). Finished runs go to the
// leaderboard. Missions and achievements add bonus points to the player's lifetime total.
import { S } from './state.js';
import { DEX, regionOf } from './data.js';
// api.js is loaded lazily so this module stays testable outside the browser
const claimPoints = async n => (await import('./api.js')).api.claimPoints(n);
import { diffOf } from './content.js';

// Hooks set by the UI: achievement toasts and saving the profile
let hooks = { onUnlock: () => {}, onChange: () => {} };
export function setProgressHooks(h) { hooks = { ...hooks, ...h }; }

// ---------- Run points ----------
export const POINTS = {
  wild: 10, trainer: 40, villain: 60, elite: 100, legendary: 150, gym: 250, villainBoss: 400, e4: 500, champion: 1500,
  catch: 25, catchLegendary: 300, catchShiny: 250, evolve: 30, actClear: 200, hallOfFame: 1000,
};
export const DIFF_POINT_MULT = { easy: 0.5, medium: 1, hard: 1.5, hell: 2.5 };
export const POINT_RULES = [
  ['Defeat a wild Pokémon', `${POINTS.wild} + its level`],
  ['Win a Trainer battle', `${POINTS.trainer} + their top level`],
  ['Beat villain grunts or admins', `${POINTS.villain} + their top level`],
  ['Defeat or catch an Elite Pokémon', `${POINTS.elite} + its level`],
  ['Defeat or catch a Legendary', `${POINTS.legendary} + its level`],
  ['Beat a Gym Leader', `${POINTS.gym} + their top level`],
  ['Beat a villain team boss', `${POINTS.villainBoss} + their top level`],
  ['Beat an Elite Four member', `${POINTS.e4} + their top level`],
  ['Beat the Champion', `${POINTS.champion} + their top level`],
  ['Catch a Pokémon', `${POINTS.catch} (+${POINTS.catchLegendary} Legendary, +${POINTS.catchShiny} shiny)`],
  ['Evolve a Pokémon', `${POINTS.evolve}`],
  ['Clear an act', `${POINTS.actClear}`],
  ['Enter the Hall of Fame', `${POINTS.hallOfFame}`],
];

/** Add points to the current run (×0.5 Easy, ×1 Medium, ×1.5 Hard, ×2.5 Hell; nothing in God mode). */
export function addRunPoints(base) {
  const run = S.run;
  if (!run || run.god || run.godUsed || !base) return 0;
  const pts = Math.round(base * (DIFF_POINT_MULT[run.difficulty] ?? 1));
  run.score = (run.score || 0) + pts;
  return pts;
}

// ---------- Seeded picks for daily/weekly missions ----------
function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function pickN(list, n, key) {
  const r = seeded(key);
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function weekKey(d = new Date()) {
  // ISO week number
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

const TYPES_FOR_MISSIONS = ['Fire', 'Water', 'Grass', 'Electric', 'Bug', 'Psychic', 'Rock', 'Ghost', 'Dragon', 'Fairy', 'Steel', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Dark', 'Normal'];

const DAILY_POOL = [
  { id: 'catch3', text: 'Catch 3 Pokémon', ev: 'catch', target: 3, pts: 150 },
  { id: 'trainer5', text: 'Win 5 Trainer battles', ev: 'win:trainer', target: 5, pts: 200 },
  { id: 'gym1', text: 'Defeat a Gym Leader', ev: 'win:gym', target: 1, pts: 250 },
  { id: 'villain2', text: 'Beat 2 villain team battles', ev: 'win:villain', target: 2, pts: 200 },
  { id: 'evolve1', text: 'Evolve a Pokémon', ev: 'evolve', target: 1, pts: 150 },
  { id: 'money500', text: 'Earn $500 in prize money', ev: 'money', target: 500, pts: 150 },
  { id: 'stops3', text: 'Spin 3 PokéStops', ev: 'stop', target: 3, pts: 100 },
  { id: 'wins10', text: 'Win 10 battles', ev: 'win', target: 10, pts: 200 },
  { id: 'elite1', text: 'Defeat or catch an Elite Pokémon', ev: 'win:elite', target: 1, pts: 200 },
  { id: 'act1', text: 'Clear an act', ev: 'actClear', target: 1, pts: 250 },
];
const WEEKLY_POOL = [
  { id: 'catch25', text: 'Catch 25 Pokémon', ev: 'catch', target: 25, pts: 800 },
  { id: 'gym6', text: 'Defeat 6 Gym Leaders', ev: 'win:gym', target: 6, pts: 1000 },
  { id: 'hof1', text: 'Enter the Hall of Fame', ev: 'hallOfFame', target: 1, pts: 1500 },
  { id: 'legend1', text: 'Catch a Legendary Pokémon', ev: 'catchLegendary', target: 1, pts: 1000 },
  { id: 'evolve10', text: 'Evolve 10 Pokémon', ev: 'evolve', target: 10, pts: 700 },
  { id: 'wins60', text: 'Win 60 battles', ev: 'win', target: 60, pts: 900 },
  { id: 'boss2', text: 'Beat 2 villain team bosses', ev: 'win:villainBoss', target: 2, pts: 900 },
  { id: 'e4x4', text: 'Beat 4 Elite Four members', ev: 'win:e4', target: 4, pts: 1200 },
  { id: 'money5k', text: 'Earn $5,000 in prize money', ev: 'money', target: 5000, pts: 800 },
  { id: 'acts5', text: 'Clear 5 acts', ev: 'actClear', target: 5, pts: 1000 },
  { id: 'shiny1', text: 'Catch a shiny Pokémon', ev: 'shiny', target: 1, pts: 1500 },
];

export function currentMissions() {
  const d = dayKey(), w = weekKey();
  const type = pickN(TYPES_FOR_MISSIONS, 1, 'type' + d)[0];
  const daily = [...pickN(DAILY_POOL, 2, 'daily' + d), { id: 'type' + type, text: `Catch a ${type}-type Pokémon`, ev: 'catchType:' + type, target: 1, pts: 150 }];
  const weekly = pickN(WEEKLY_POOL, 3, 'weekly' + w);
  return { daily, weekly, dayKey: d, weekKey: w };
}

function missionState() {
  const p = S.profile;
  const { dayKey: d, weekKey: w } = currentMissions();
  p.missions ||= {};
  if (p.missions.daily?.key !== d) p.missions.daily = { key: d, progress: {}, claimed: [] };
  if (p.missions.weekly?.key !== w) p.missions.weekly = { key: w, progress: {}, claimed: [] };
  return p.missions;
}

export function missionList() {
  const st = missionState();
  const { daily, weekly } = currentMissions();
  const view = (m, s) => ({ ...m, progress: Math.min(m.target, s.progress[m.ev] || 0), done: (s.progress[m.ev] || 0) >= m.target, claimed: s.claimed.includes(m.id) });
  return { daily: daily.map(m => view(m, st.daily)), weekly: weekly.map(m => view(m, st.weekly)) };
}

export async function claimMission(period, id) {
  const st = missionState()[period];
  const m = missionList()[period].find(x => x.id === id);
  if (!m || !m.done || m.claimed) return 0;
  st.claimed.push(id);
  await claimPoints(m.pts);
  return m.pts;
}

// ---------- Achievements ----------
const c = ev => S.profile.counters?.[ev] || 0;
const realDex = () => new Set(S.profile.caught).size;
const realShinies = () => new Set(S.profile.shinies || []);
export const ACHIEVEMENTS = [
  { id: 'first_catch', name: 'First Catch', desc: 'Catch your first Pokémon', pts: 50, test: () => c('catch') >= 1 },
  { id: 'catch_100', name: 'Poké Ball Pro', desc: 'Catch 100 Pokémon', pts: 300, test: () => c('catch') >= 100 },
  { id: 'dex_50', name: 'Pokédex Rookie', desc: 'Catch 50 different species', pts: 150, test: () => realDex() >= 50 },
  { id: 'dex_250', name: 'Pokédex Ace', desc: 'Catch 250 different species', pts: 500, test: () => realDex() >= 250 },
  { id: 'dex_500', name: 'Pokédex Master', desc: 'Catch 500 different species', pts: 1000, test: () => realDex() >= 500 },
  { id: 'dex_all', name: "Gotta Catch 'Em All", desc: 'Catch all 1,025 species', pts: 5000, test: () => realDex() >= 1025 },
  { id: 'shiny_1', name: 'Something Sparkly', desc: 'Catch a shiny Pokémon', pts: 300, test: () => c('shiny') >= 1 },
  { id: 'shiny_5', name: 'Glimmering', desc: 'Catch 5 shiny Pokémon', pts: 600, test: () => c('shiny') >= 5 },
  { id: 'shiny_10', name: 'Shiny Hunter', desc: 'Catch 10 shiny Pokémon', pts: 1500, test: () => c('shiny') >= 10 },
  { id: 'shiny_25', name: 'Shining Collector', desc: 'Catch 25 shiny Pokémon', pts: 3000, test: () => c('shiny') >= 25 },
  { id: 'shiny_dex_50', name: 'Shiny Dex', desc: 'Catch 50 different shiny species', pts: 5000, test: () => realShinies().size >= 50 },
  { id: 'shiny_legend', name: 'Golden Legend', desc: 'Catch a shiny Legendary or Mythical Pokémon', pts: 2000, test: () => c('shinyLegendary') >= 1 },
  { id: 'shiny_start', name: 'Sparkling Partner', desc: 'Start a run with a shiny starter', pts: 300, test: () => c('shinyStart') >= 1 },
  { id: 'shiny_team', name: 'Dazzling Team', desc: 'Have six shiny Pokémon on your team', pts: 1500, test: () => (S.run?.party || []).filter(m => m.shiny).length >= 6 },
  { id: 'shiny_hof', name: 'Shiny Champion', desc: 'Enter the Hall of Fame with a shiny on your team', pts: 1500, test: () => c('hallOfFame:shiny') >= 1 },
  { id: 'shiny_types', name: 'Rainbow Shine', desc: 'Catch shinies of 9 different types', pts: 1500, test: () => new Set([...realShinies()].flatMap(id => DEX[id]?.t || [])).size >= 9 },
  { id: 'shiny_regions', name: 'Shiny World Tour', desc: 'Catch a shiny from every region', pts: 4000, test: () => new Set([...realShinies()].map(regionOf)).size >= 9 },
  { id: 'legend_1', name: 'Legendary Encounter', desc: 'Catch a Legendary Pokémon', pts: 300, test: () => c('catchLegendary') >= 1 },
  { id: 'legend_10', name: 'Myth Collector', desc: 'Catch 10 Legendary Pokémon', pts: 1500, test: () => c('catchLegendary') >= 10 },
  { id: 'badge_1', name: 'First Badge', desc: 'Defeat a Gym Leader', pts: 100, test: () => c('win:gym') >= 1 },
  { id: 'badges_8', name: 'Badge Case Full', desc: 'Earn 8 badges in one run', pts: 800, test: () => (S.run?.badges.length || 0) >= 8 },
  { id: 'boss_3', name: 'Villain Buster', desc: 'Beat 3 villain team bosses', pts: 400, test: () => c('win:villainBoss') >= 3 },
  { id: 'elite_10', name: 'Elite Tamer', desc: 'Defeat or catch 10 Elite Pokémon', pts: 400, test: () => c('win:elite') >= 10 },
  { id: 'evolve_25', name: 'Evolutionary', desc: 'Evolve 25 Pokémon', pts: 400, test: () => c('evolve') >= 25 },
  { id: 'level_100', name: 'Max Level', desc: 'Raise a Pokémon to Lv 100', pts: 500, test: () => c('level100') >= 1 },
  { id: 'perfect_ivs', name: 'Perfect Specimen', desc: 'Own a Pokémon with six perfect IVs', pts: 300, test: () => (S.run?.party || []).some(m => m.iv.every(v => v === 31)) },
  { id: 'max_evs', name: 'Fully Trained', desc: 'Give a Pokémon all 510 EVs', pts: 300, test: () => (S.run?.party || []).some(m => m.ev.reduce((a, b) => a + b, 0) >= 510) },
  { id: 'rich', name: 'Big Money', desc: 'Hold $10,000 at once', pts: 200, test: () => (S.run?.money || 0) >= 10000 },
  { id: 'runs_10', name: 'Dedicated Trainer', desc: 'Start 10 runs', pts: 200, test: () => c('runStart') >= 10 },
  { id: 'champion', name: 'Champion', desc: 'Enter the Hall of Fame', pts: 1000, test: () => c('hallOfFame') >= 1 },
  { id: 'champion_hard', name: 'Hard-Won Victory', desc: 'Enter the Hall of Fame on Hard', pts: 1500, test: () => c('hallOfFame:hard') >= 1 },
  { id: 'champion_hell', name: 'Nuzlocke Legend', desc: 'Enter the Hall of Fame on Hell', pts: 3000, test: () => c('hallOfFame:hell') >= 1 },
  { id: 'world_tour', name: 'World Tour', desc: 'Win Classic mode in all 9 regions', pts: 5000, test: () => (S.profile.classicWins || []).length >= 9 },
];

/** Record a game event: advances missions, lifetime counters, and checks achievements. Ignored in God mode. */
export function track(ev, n = 1) {
  if (!S.profile || S.run?.god || S.run?.godUsed) return [];
  const p = S.profile;
  p.counters ||= {};
  p.counters[ev] = (p.counters[ev] || 0) + n;
  const st = missionState();
  st.daily.progress[ev] = (st.daily.progress[ev] || 0) + n;
  st.weekly.progress[ev] = (st.weekly.progress[ev] || 0) + n;
  const unlocked = checkAchievements();
  hooks.onChange();
  return unlocked;
}

/** Unlock achievements whose condition is met. Their points are added to the lifetime total. */
export function checkAchievements() {
  if (!S.profile || S.run?.god || S.run?.godUsed) return [];
  const p = S.profile;
  p.achievements ||= {};
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.id]) continue;
    let ok = false;
    try { ok = a.test(); } catch { ok = false; }
    if (!ok) continue;
    p.achievements[a.id] = new Date().toISOString();
    unlocked.push(a);
    claimPoints(a.pts).catch(() => {});
    hooks.onUnlock(a);
  }
  if (unlocked.length) hooks.onChange();
  return unlocked;
}

/** Events for a battle result. Returns run points earned. */
export function battleWon(kind, enemy) {
  const maxLv = Math.max(...enemy.map(m => m.lv));
  const base = POINTS[kind] ?? POINTS.wild;
  track('win');
  track('win:' + kind);
  return addRunPoints(base + maxLv);
}

export function caughtEvents(mon) {
  const sp = DEX[mon.id];
  let base = POINTS.catch;
  track('catch');
  for (const t of sp.t) track('catchType:' + t);
  if (sp.L || sp.M) { track('catchLegendary'); base += POINTS.catchLegendary; }
  if (mon.shiny) { track('shiny'); base += POINTS.catchShiny; if (sp.L || sp.M) track('shinyLegendary'); }
  return addRunPoints(base);
}

export const pointMultText = run => `×${DIFF_POINT_MULT[run?.difficulty] ?? 1} for ${diffOf(run).name}`;
