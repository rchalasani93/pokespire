// Screens, overlays and player flows (everything except the battle screen).
import { S, defaultProfile, normalizeProfile } from './state.js';
import { api, configured, saveRun, saveProfile, flushSaves, cancelRunSave, joinPresence, leavePresence } from './api.js';
import { DEX, MOVES, LEARN, REGIONS, ABILITIES, regionOf, familyRoot, bst, spriteUrl, artUrl, itemIconUrl, TYPE_COLORS, movesAtLevel } from './data.js';
import {
  createMon, calcStats, maxHp, monName, NATURES, STAT_LABELS, STAT_SHORT, natureMod, natureLabel, ivJudge, expForLevel, gainExp, levelUp, evoItemFor,
  levelEvolution, itemEvolution, evolve, replaceMove,
} from './mechanics.js';
import {
  ACTS, NODE_INFO, ROWS, newRun, generateMap, availableNodes, buildEncounter, startLeague, leagueOpponent,
  spinPokeStop, martStock, eliteReward, healParty, storeCaught, partySummary, addItem, applyDifficulty, priceOf, runRegion,
} from './game.js';
import { ITEMS, BAG_POCKETS, DIFFICULTIES, diffOf, GAME_MODES, modeOf, trainerSpriteUrl } from './content.js';
import { startBattle, applyItem } from './battle.js';
import { renderBattle, beginBattle, onBattleAction, resumeBattleUI } from './battle-ui.js';
import { dexEntryHtml } from './social-ui.js';
import { playMusic, sfx, playCry, applyAudioSettings, unlockAudio } from './audio.js';
import { track, addRunPoints, battleWon, caughtEvents, checkAchievements, setProgressHooks, POINTS } from './progress.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => document.getElementById('app');

// ---------- Rendering ----------
const SCREENS = {};
export function go(screen, ui = {}) {
  S.screen = screen;
  S.ui = ui;
  render();
  window.scrollTo(0, 0);
}
export function render() {
  const fn = SCREENS[S.screen];
  const html = fn ? fn() : '';
  app().innerHTML = html + (S.modal ? renderModal() : '') + (S.run?.flow?.length && S.screen !== 'battle-playing' ? renderFlow() : '');
  document.getElementById('topbar-user').innerHTML = S.user
    ? `<span>${esc(S.user.username)}</span>${S.run && S.screen !== 'menu' ? ` · <span class="money">$${S.run.money.toLocaleString()}</span>` : ''}`
    : '';
  renderOnline();
  afterRender();
}

export function renderOnline() {
  let el = document.getElementById('online-count');
  if (!S.user) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('button');
    el.id = 'online-count';
    el.className = 'online-count';
    el.dataset.act = 'openFriends';
    document.body.appendChild(el);
  }
  const n = (S.online || []).length || 1;
  el.innerHTML = `<i></i>${n.toLocaleString()} online`;
  el.title = 'Players online now';
}

export function refreshMissionCount() {
  import('./progress.js').then(({ missionList }) => {
    const { daily, weekly } = missionList();
    S.missionsReady = [...daily, ...weekly].filter(m => m.done && !m.claimed).length;
  });
}
function afterRender() {
  if (S.refocus) {
    const el = document.querySelector(S.refocus.selector);
    if (el) { el.focus(); el.setSelectionRange(S.refocus.pos, S.refocus.pos); }
    S.refocus = null;
  }
  if (S.screen === 'map') {
    const cur = document.querySelector('.node.available, .node.current');
    if (cur && !S.ui.scrolled) { cur.scrollIntoView({ block: 'center' }); S.ui.scrolled = true; }
  }
}

export function persistRun() { if (S.run) saveRun(S.run); }
export function persistProfile() { saveProfile(S.profile); }

// ---------- Actions (event delegation) ----------
const ACTIONS = {};
export function registerActions(map) { Object.assign(ACTIONS, map); }

document.addEventListener('click', e => {
  unlockAudio();
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  if (!el.classList.contains('silent')) sfx(el.dataset.act === 'back' || el.dataset.act === 'closeModal' ? 'back' : 'select');
  fn(el.dataset.arg, el);
});
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  unlockAudio();
  ACTIONS[form.dataset.form]?.(new FormData(form), form);
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-input]');
  if (el) ACTIONS[el.dataset.input]?.(el.value, el);
});

setProgressHooks({
  onUnlock: a => { sfx('achievement'); toast(`🏆 Achievement unlocked: ${a.name} (+${a.pts} pts)`); },
  onChange: () => { persistProfile(); refreshMissionCount(); },
});

// ---------- Shared bits ----------
export function typeBadge(t) {
  return `<span class="type" style="background:${TYPE_COLORS[t] || '#777'}">${t}</span>`;
}
export function hpBar(hp, max) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const cls = pct > 50 ? 'good' : pct > 20 ? 'warn' : 'bad';
  return `<div class="hpbar"><i class="${cls}" style="width:${pct}%"></i></div>`;
}
const STATUS_LABEL = { brn: 'BRN', par: 'PAR', psn: 'PSN', tox: 'TOX', slp: 'SLP', frz: 'FRZ' };
export const statusTag = st => (st ? `<span class="status ${st}">${STATUS_LABEL[st]}</span>` : '');
const img = (src, cls = '', alt = '') => `<img class="${cls}" src="${src}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">`;
const itemImg = name => img(itemIconUrl(ITEMS[name]?.slug || 'poke-ball'), 'item-icon', name);

function monCard(m, i, { action = 'showSummary', extra = '' } = {}) {
  const max = maxHp(m);
  return `<button class="mon-card ${m.hp <= 0 ? 'fainted' : ''}" data-act="${action}" data-arg="${i}">
    ${img(spriteUrl(m.id, { shiny: m.shiny }), 'mini-sprite', monName(m))}
    <div class="mon-card-body">
      <div class="row"><strong>${esc(monName(m))}${m.shiny ? ' ✦' : ''}</strong><span>Lv ${m.lv}</span></div>
      <div class="card-types">${DEX[m.id].t.map(typeBadge).join('')}</div>
      ${hpBar(m.hp, max)}
      <div class="row small"><span>${m.hp}/${max} HP ${statusTag(m.st)}</span>${extra}</div>
    </div>
  </button>`;
}

export function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// ---------- Auth ----------
SCREENS.auth = () => {
  const mode = S.ui.mode || 'login';
  return `<section class="auth">
    <div class="hero">
      <img class="hero-art" src="${artUrl(25)}" alt="Pikachu">
      <h1>PokéSpire</h1>
      <p>Climb three acts of branching routes, build your team, defeat Gym Leaders and villain teams, and enter the Hall of Fame.</p>
    </div>
    <div class="panel auth-panel">
      <div class="tabs">
        <button class="${mode === 'login' ? 'active' : ''}" data-act="authMode" data-arg="login">Log in</button>
        <button class="${mode === 'signup' ? 'active' : ''}" data-act="authMode" data-arg="signup">Sign up</button>
      </div>
      <p class="muted">${mode === 'login' ? 'Log in to continue your journey. Your runs, catches and settings are saved to your account.' : 'Create an account to track your runs and save your progress.'}</p>
      <form data-form="${mode}">
        ${mode === 'signup' ? `<label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" title="3–20 letters, numbers or underscores" value="${esc(S.ui.username || '')}"></label>` : ''}
        <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(S.ui.email || '')}"></label>
        <label>Password<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="${mode === 'signup' ? 8 : 1}"></label>
        ${mode === 'signup' ? '<label>Confirm password<input name="confirm" type="password" autocomplete="new-password" required minlength="8"></label>' : ''}
        ${S.ui.notice ? `<p class="notice" role="status">${esc(S.ui.notice)}</p>` : ''}
        ${S.ui.error ? `<p class="error" role="alert">${esc(S.ui.error)}</p>` : ''}
        <button class="primary big" type="submit" ${S.ui.busy ? 'disabled' : ''}>${S.ui.busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
      </form>
    </div>
  </section>`;
};

registerActions({
  authMode: mode => go('auth', { mode }),
  login: fd => doAuth('login', fd),
  signup: fd => doAuth('signup', fd),
});

async function doAuth(mode, fd) {
  const username = (fd.get('username') || '').trim();
  const email = (fd.get('email') || '').trim();
  const password = fd.get('password') || '';
  const keep = { mode, username, email };
  if (mode === 'signup' && password !== fd.get('confirm')) { go('auth', { ...keep, error: 'Passwords do not match.' }); return; }
  go('auth', { ...keep, busy: true });
  try {
    if (mode === 'signup') {
      const { needsConfirmation } = await api.signup(username, email, password);
      if (needsConfirmation) {
        go('auth', { mode: 'login', email, notice: `Account created! We sent a confirmation link to ${email}. Click it, then log in.` });
        return;
      }
    } else {
      await api.login(email, password);
    }
    await loadAccount();
  } catch (e) {
    go('auth', { ...keep, error: e.message });
  }
}

export async function loadAccount() {
  if (!configured) { go('setup'); return; }
  try {
    const me = await api.me();
    S.user = me.user;
    const isNew = !me.profile;
    S.profile = normalizeProfile(me.profile);
    S.run = me.run && Array.isArray(me.run.party) ? me.run : null;
    applyAudioSettings(S.profile.settings);
    // Catches made before natures/abilities were tracked still count
    let changed = false;
    for (const m of [...(S.run?.party || []), ...(S.run?.box || [])]) if (m.ball && recordCatch(m)) changed = true;
    if (isNew || changed) persistProfile();
    S.scores = await api.scores().catch(() => null);
    joinPresence(S.user, ids => { S.online = ids; renderOnline(); });
    refreshMissionCount();
    go('menu');
  } catch (e) {
    S.user = null;
    go('auth', { mode: 'login' });
  }
}

SCREENS.setup = () => `<section class="panel narrow">
  <h2>Almost ready</h2>
  <p>PokéSpire needs a Supabase project for accounts and saves, but <code>config.js</code> has no Supabase URL or key yet.</p>
  <p class="muted">Copy <code>public/config.example.js</code> to <code>public/config.js</code> and fill in your project's URL and anon key. The README has step-by-step setup.</p>
</section>`;

// ---------- Main menu ----------
/** Admin view-only unlock: every species' shiny is available (does not change real catches or achievements). */
export const adminAllShinies = () => !!(S.user?.isAdmin && S.profile?.settings.allShinies);
/** Caught-state for a species: 'shiny' (shiny caught), 'caught', or null. */
export function caughtState(id) {
  if ((S.profile?.shinies || []).includes(id) || adminAllShinies()) return 'shiny';
  if ((S.profile?.caught || []).includes(id) || (S.user?.isAdmin && S.profile?.settings.allStarters)) return 'caught';
  return null;
}
export function caughtMark(id) {
  const st = caughtState(id);
  if (st === 'shiny') return '<span class="caught-mark shiny" title="Shiny caught (and the normal form)">✦</span>';
  if (st === 'caught') return '<span class="caught-mark" title="Caught"><i class="mini-ball"></i></span>';
  return '';
}

export function pokedexCount() {
  return S.user?.isAdmin && S.profile.settings.allStarters ? Object.keys(DEX).length : new Set(S.profile.caught).size;
}

SCREENS.menu = () => {
  playMusic('menu');
  const r = S.run;
  const sc = S.scores || { best_score: 0, total_score: 0 };
  return `<section class="menu">
    <div class="hero small">${img(artUrl(r ? r.party[0].id : 6, r?.party[0].shiny), 'hero-art', '')}
      <h1>PokéSpire</h1><p class="muted">Welcome back, ${esc(S.user.username)}.</p></div>
    <div class="menu-buttons">
      ${r ? `<button class="primary big" data-act="continueRun">Continue run<small>${GAME_MODES[modeOf(r)].name} · ${diffOf(r).name} · ${ACTS[r.act - 1].name} · ${(r.score || 0).toLocaleString()} pts</small></button>` : ''}
      <button class="${r ? '' : 'primary'} big" data-act="play">${r ? 'New run' : 'Play'}<small>Choose a mode, difficulty and starter</small></button>
      <div class="menu-grid">
        <button data-act="openPokedex">Pokédex<small>${pokedexCount().toLocaleString()} / ${Object.keys(DEX).length.toLocaleString()} caught</small></button>
        <button data-act="openMissions">Missions${missionBadge()}<small>Daily, weekly and achievements</small></button>
        <button data-act="openLeaderboard">Leaderboard<small>Top scores</small></button>
        <button data-act="openFriends">Friends<small>Find and add players</small></button>
        <button data-act="openHistory">History<small>Runs and Hall of Fame</small></button>
        <button data-act="openSettings">Settings<small>Sound and text speed</small></button>
      </div>
      ${S.user.isAdmin ? '<button class="big admin-btn" data-act="openAdmin">Admin panel<small>God mode and debug tools</small></button>' : ''}
      <button class="ghost" data-act="logout">Log out</button>
    </div>
    <div class="stat-row four">
      <div><b>${S.profile.stats.runs}</b><span>Runs</span></div>
      <div><b>${(sc.best_score || 0).toLocaleString()}</b><span>Best score</span></div>
      <div><b>${Number(sc.total_score || 0).toLocaleString()}</b><span>Total points</span></div>
      <div><b>${S.profile.stats.champions}</b><span>Hall of Fame</span></div>
    </div>
  </section>`;
};
function missionBadge() {
  const n = S.missionsReady || 0;
  return n ? ` <span class="count-badge">${n}</span>` : '';
}

registerActions({
  play: () => {
    if (S.run) { S.modal = { type: 'confirm', text: 'Starting a new run will abandon your current one. It will be recorded in your history.', yes: 'abandonAndPlay' }; render(); return; }
    go('mode');
  },
  abandonAndPlay: async () => { S.modal = null; await endRun('Abandoned'); go('mode'); },
  continueRun: () => resumeRun(),
  openSettings: () => go('settings'),
  openHistory: async () => {
    go('history', { tab: 'runs', loading: true });
    try { S.history = (await api.history()).history; } catch { S.history = []; }
    if (S.screen === 'history') go('history', { tab: S.ui.tab || 'runs' });
  },
  logout: async () => {
    await flushSaves();
    await leavePresence();
    S.online = [];
    await api.logout().catch(() => {});
    S.user = null; S.run = null; S.profile = null;
    go('auth', { mode: 'login' });
  },
  back: () => go('menu'),
  closeModal: () => { S.modal = null; render(); },
});

// ---------- Settings ----------
SCREENS.settings = () => {
  const s = S.profile.settings;
  const slider = (key, label) => `<label class="slider">${label}<span id="v-${key}">${Math.round(s[key] * 100)}%</span>
    <input type="range" min="0" max="100" value="${Math.round(s[key] * 100)}" data-input="setVolume" data-arg="${key}" data-key="${key}" aria-label="${label}"></label>`;
  return `<section class="panel narrow">
    <h2>Settings</h2>
    ${slider('master', 'Master volume')}
    ${slider('music', 'Music')}
    ${slider('sfx', 'Sound effects & cries')}
    <label class="check"><input type="checkbox" ${s.muted ? 'checked' : ''} data-act="toggleMute" class="silent"> Mute all sound</label>
    <label>Text speed
      <select data-input="setTextSpeed">${['slow', 'normal', 'fast'].map(v => `<option ${s.textSpeed === v ? 'selected' : ''} value="${v}">${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select>
    </label>
    <div class="row gap"><button data-act="testSound">Test sound</button><button class="primary" data-act="back">Done</button></div>
  </section>`;
};
registerActions({
  setVolume: (value, el) => {
    const key = el.dataset.key;
    S.profile.settings[key] = Number(value) / 100;
    document.getElementById('v-' + key).textContent = value + '%';
    applyAudioSettings(S.profile.settings);
    persistProfile();
  },
  toggleMute: (_, el) => {
    S.profile.settings.muted = el.checked;
    applyAudioSettings(S.profile.settings);
    persistProfile();
  },
  setTextSpeed: v => { S.profile.settings.textSpeed = v; persistProfile(); },
  testSound: () => { sfx('levelup'); setTimeout(() => playCry(25), 500); },
});

// ---------- History & Hall of Fame ----------
SCREENS.history = () => {
  const tab = S.ui.tab || 'runs';
  const list = S.history || [];
  const teamStrip = team => `<div class="team-strip">${(team || []).map(m => `<span title="${esc(m.name)} Lv ${m.lv}">${img(spriteUrl(m.id, { shiny: m.shiny }), 'mini-sprite', m.name)}<small>Lv ${m.lv}</small></span>`).join('')}</div>`;
  const runs = S.ui.loading ? '<p class="muted">Loading…</p>' : list.length ? list.map(h => `
    <article class="history-item ${h.result === 'Champion' ? 'win' : h.result === 'Defeated' ? 'loss' : ''}">
      <div class="row"><strong>${esc(h.result)} ${h.mode ? modeBadge(h.mode) : ''} ${diffBadge(DIFFICULTIES[h.difficulty] ? h.difficulty : 'medium')}${h.god ? ' <span class="diff-badge" style="--dc:#ffd700;color:#1a1a1a">Admin tools used</span>' : ''}</strong><span class="muted">${new Date(h.createdAt).toLocaleString()}</span></div>
      <p class="muted small"><b class="score-text">${(h.score || 0).toLocaleString()} pts</b> · Starter: ${esc(DEX[h.starter]?.n || '?')} · Reached ${esc(h.reached || '')} · ${h.badges ?? 0} badges · ${h.caught ?? 0} caught · ${h.wins ?? 0} battles won${h.durationMin != null ? ` · ${h.durationMin} min` : ''}${h.defeatedBy ? ` · Lost to ${esc(h.defeatedBy)}` : ''}</p>
      ${teamStrip(h.team)}
    </article>`).join('') : '<p class="muted">No finished runs yet. Your completed, lost and abandoned runs will appear here.</p>';
  const hof = S.profile.hallOfFame.length ? S.profile.hallOfFame.slice().reverse().map((h, i) => `
    <article class="history-item win">
      <div class="row"><strong>Hall of Fame #${S.profile.hallOfFame.length - i}</strong><span class="muted">${new Date(h.date).toLocaleDateString()}</span></div>
      <p class="muted small">Defeated Champion ${esc(h.champion)}</p>
      <div class="hof-team">${h.team.map(m => `<figure>${img(artUrl(m.id), '', m.name)}<figcaption>${esc(m.name)}<br><small>Lv ${m.lv}</small></figcaption></figure>`).join('')}</div>
    </article>`).join('') : '<p class="muted">Defeat the Elite Four and the Champion to enter the Hall of Fame.</p>';
  return `<section class="panel">
    <div class="row"><h2>History</h2><button data-act="back">Back</button></div>
    <div class="tabs">
      <button class="${tab === 'runs' ? 'active' : ''}" data-act="historyTab" data-arg="runs">Previous runs</button>
      <button class="${tab === 'hof' ? 'active' : ''}" data-act="historyTab" data-arg="hof">Hall of Fame</button>
    </div>
    ${tab === 'runs' ? runs : hof}
  </section>`;
};
registerActions({ historyTab: tab => go('history', { tab }) });

// ---------- Game mode ----------
const modeBadge = key => `<span class="diff-badge" style="--dc:${GAME_MODES[key].color};color:#1a1a1a">${GAME_MODES[key].name}</span>`;
const diffBadge = key => `<span class="diff-badge" style="--dc:${DIFFICULTIES[key].color}">${DIFFICULTIES[key].name}</span>`;
SCREENS.mode = () => {
  playMusic('menu');
  return `<section class="panel">
    <div class="row"><h2>Choose a mode</h2><button data-act="back">Back</button></div>
    <div class="difficulty-grid two">${Object.entries(GAME_MODES).map(([key, m]) => `
      <button class="difficulty" style="--dc:${m.color}" data-act="pickMode" data-arg="${key}">
        <strong>${m.name}</strong>
        <ul>${m.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      </button>`).join('')}</div>
  </section>`;
};
registerActions({
  starterNature: v => { S.modal.nat = v === '' ? undefined : +v; },
  starterAbility: v => { S.modal.ab = v || undefined; },
  starterShiny: (_, el) => { S.modal.shiny = el.checked; render(); },
  dexShinyToggle: (_, el) => { S.ui.dexShiny = el.checked; render(); },
  toggleLearnset: () => { S.modal.showLearnset = !S.modal.showLearnset; render(); },
  teachMove: moveId => {
    const mon = summaryMon(S.modal);
    if (!mon || mon.moves.some(x => x.id === moveId)) return;
    const entry = (LEARN[mon.id] || []).find(([, m]) => m === moveId);
    if (!entry) return;
    if (entry[0] > mon.lv) {
      if (!S.user?.isAdmin) return;
      S.run.godUsed = true; // admin teaching early
    }
    if (mon.moves.length < 4) {
      mon.moves.push({ id: moveId, pp: MOVES[moveId].pp });
      sfx('learn'); toast(`${monName(mon)} learned ${MOVES[moveId].n}!`);
      persistRun(); render();
      return;
    }
    queueFlow([{ type: 'learn', uid: mon.uid, move: moveId }]);
  },
  adminEvolve: adminOnly(to => {
    const mon = summaryMon(S.modal);
    if (!mon || !(DEX[mon.id].e || []).some(e => e.to === +to)) return;
    S.run.godUsed = true;
    queueFlow([{ type: 'evolve', uid: mon.uid, to: +to }]);
  }),
});
registerActions({ pickMode: key => go('difficulty', { mode: key }) });

// ---------- Difficulty ----------
SCREENS.difficulty = () => {
  playMusic('menu');
  const mode = S.ui.mode || 'classic';
  return `<section class="panel">
    <div class="row"><h2>Choose a difficulty ${modeBadge(mode)}</h2><button data-act="toMode">Back</button></div>
    <p class="muted">Every run starts with $100. Battles pay out based on the opponent's level, and Trainers pay more than wild Pokémon.</p>
    <div class="difficulty-grid">${Object.entries(DIFFICULTIES).map(([key, d]) => `
      <button class="difficulty" style="--dc:${d.color}" data-act="pickDifficulty" data-arg="${key}">
        <strong>${d.name}</strong>
        <ul>${d.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      </button>`).join('')}</div>
  </section>`;
};
registerActions({
  toMode: () => go('mode'),
  pickDifficulty: key => go('starters', { region: 0, difficulty: key, mode: S.ui.mode || 'classic' }),
});

// ---------- Filtering & sorting ----------
export const SPECIES_SORTS = [['dex', 'Dex No.'], ['name', 'Name'], ['bst', 'Base stat total'], ['hp', 'Base HP'], ['atk', 'Base Attack'], ['def', 'Base Defense'], ['spa', 'Base Sp. Atk'], ['spd', 'Base Sp. Def'], ['spe', 'Base Speed']];
const MON_SORTS = [['order', 'Default order'], ['dex', 'Dex No.'], ['name', 'Name'], ['level', 'Level'], ['hpPct', 'HP remaining'], ['bst', 'Base stat total'],
  ['hp', 'HP'], ['atk', 'Attack'], ['def', 'Defense'], ['spa', 'Sp. Atk'], ['spd', 'Sp. Def'], ['spe', 'Speed'], ['ivs', 'IV total'], ['evs', 'EV total']];
export const STAT_IDX = { hp: 0, atk: 1, def: 2, spa: 3, spd: 4, spe: 5 };
const TYPE_LIST = Object.keys(TYPE_COLORS);

export function filterState(ctx) {
  S.filters ||= {};
  return (S.filters[ctx] ||= { q: '', type: '', region: '', sort: ctx === 'starters' ? 'dex' : 'order', dir: 'asc' });
}

export function filterBar(ctx, { species = false, region = true } = {}) {
  const f = filterState(ctx);
  const sorts = species ? SPECIES_SORTS : MON_SORTS;
  return `<div class="filter-bar">
    <input type="search" placeholder="Search by name" value="${esc(f.q)}" data-input="filterQ" data-ctx="${ctx}" aria-label="Search by name">
    <select data-input="filterType" data-ctx="${ctx}" aria-label="Filter by type"><option value="">All types</option>${TYPE_LIST.map(t => `<option ${f.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    ${region ? `<select data-input="filterRegion" data-ctx="${ctx}" aria-label="Filter by region"><option value="">All regions</option>${REGIONS.map((r, i) => `<option value="${i}" ${f.region === String(i) ? 'selected' : ''}>${r.name}</option>`).join('')}</select>` : ''}
    <select data-input="filterSort" data-ctx="${ctx}" aria-label="Sort by">${sorts.map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>Sort: ${l}</option>`).join('')}</select>
    <button class="small-btn" data-act="filterDir" data-arg="${ctx}" title="Reverse order">${f.dir === 'asc' ? '↑ Asc' : '↓ Desc'}</button>
    ${f.q || f.type || f.region ? `<button class="small-btn ghost" data-act="filterClear" data-arg="${ctx}">Clear</button>` : ''}
  </div>`;
}

function matches(f, id, name) {
  const sp = DEX[id];
  if (f.q && !name.toLowerCase().includes(f.q.toLowerCase()) && !sp.n.toLowerCase().includes(f.q.toLowerCase())) return false;
  if (f.type && !sp.t.includes(f.type)) return false;
  if (f.region !== '' && regionOf(id) !== +f.region) return false;
  return true;
}

export function sortSpecies(ids, f) {
  const key = id => f.sort === 'name' ? DEX[id].n : f.sort === 'bst' ? bst(id) : f.sort in STAT_IDX ? DEX[id].b[STAT_IDX[f.sort]] : id;
  return ids.filter(id => matches(f, id, DEX[id].n)).sort((a, b) => cmp(key(a), key(b), f.dir) || a - b);
}

/** Returns [mon, originalIndex] pairs so actions still point at the right Pokémon. */
function sortMons(list, f) {
  const key = (m, i) => {
    switch (f.sort) {
      case 'dex': return m.id;
      case 'name': return monName(m);
      case 'level': return m.lv;
      case 'hpPct': return m.hp / maxHp(m);
      case 'bst': return bst(m.id);
      case 'ivs': return m.iv.reduce((a, b) => a + b, 0);
      case 'evs': return m.ev.reduce((a, b) => a + b, 0);
      default: return f.sort in STAT_IDX ? calcStats(m)[STAT_IDX[f.sort]] : i;
    }
  };
  return list.map((m, i) => [m, i]).filter(([m]) => matches(f, m.id, monName(m)))
    .sort(([a, i], [b, j]) => cmp(key(a, i), key(b, j), f.dir) || i - j);
}

function cmp(a, b, dir) {
  const r = typeof a === 'string' ? a.localeCompare(b) : a - b;
  return dir === 'desc' ? -r : r;
}

function setFilter(ctx, key, value, el) {
  filterState(ctx)[key] = value;
  if (key === 'q') S.refocus = { selector: `[data-input="filterQ"][data-ctx="${ctx}"]`, pos: el?.selectionStart ?? value.length };
  render();
}
registerActions({
  filterQ: (v, el) => setFilter(el.dataset.ctx, 'q', v, el),
  filterType: (v, el) => setFilter(el.dataset.ctx, 'type', v),
  filterRegion: (v, el) => setFilter(el.dataset.ctx, 'region', v),
  filterSort: (v, el) => setFilter(el.dataset.ctx, 'sort', v),
  filterDir: ctx => { const f = filterState(ctx); f.dir = f.dir === 'asc' ? 'desc' : 'asc'; render(); },
  filterClear: ctx => { Object.assign(filterState(ctx), { q: '', type: '', region: '' }); render(); },
});

// ---------- Starter selection ----------
function starterPool() {
  if (S.user?.isAdmin && S.profile.settings.allStarters) return Object.keys(DEX).map(Number);
  return [...new Set([...REGIONS[0].starters, ...S.profile.caught])].filter(id => DEX[id]);
}
SCREENS.starters = () => {
  playMusic('menu');
  const region = S.ui.region ?? 0;
  const pool = starterPool();
  const f = filterState('starters');
  const ids = sortSpecies(region === -1 ? pool : pool.filter(id => regionOf(id) === region), { ...f, region: '' });
  const counts = REGIONS.map((_, i) => pool.filter(id => regionOf(id) === i).length);
  return `<section class="panel">
    <div class="row"><h2>Choose your partner ${modeBadge(S.ui.mode || 'classic')} ${diffBadge(S.ui.difficulty || 'medium')}</h2><button data-act="toDifficulty">Back</button></div>
    ${(S.ui.mode || 'classic') === 'classic' ? `<p class="notice">Classic mode: your partner's home region decides the journey${region >= 0 ? ` — a ${REGIONS[region].name} Pokémon means ${REGIONS[region].name}'s Gym Leaders, villain team, Elite Four and Champion` : ''}.</p>` : ''}
    <p class="muted">Your first run starts with the three Kanto starters. Every Pokémon you catch on a run joins this pool for future runs, sorted by its home region.</p>
    <div class="tabs wrap"><button class="${region === -1 ? 'active' : ''}" data-act="starterRegion" data-arg="-1">All <small>${pool.length}</small></button>${REGIONS.map((r, i) => `<button class="${i === region ? 'active' : ''}" data-act="starterRegion" data-arg="${i}">${r.name} <small>${counts[i]}</small></button>`).join('')}</div>
    ${filterBar('starters', { species: true, region: false })}
    <div class="starter-grid">
      ${ids.length ? ids.map(id => `<button class="starter" data-act="pickStarter" data-arg="${id}">
        ${img(artUrl(id), '', DEX[id].n)}<strong>${DEX[id].n}${unlockedFor(id).shiny ? ' <span class="shiny-mark" title="Shiny unlocked for this family">✦</span>' : ''}</strong><div>${DEX[id].t.map(typeBadge).join('')}</div>${['dex', 'name'].includes(f.sort) ? '' : `<small class="muted">${f.sort === 'bst' ? 'BST ' + bst(id) : SPECIES_SORTS.find(x => x[0] === f.sort)[1].replace('Base ', '') + ' ' + DEX[id].b[STAT_IDX[f.sort]]}</small>`}</button>`).join('')
        : `<p class="muted empty">${f.q || f.type ? 'No Pokémon match these filters.' : region >= 0 ? `You haven't caught any ${REGIONS[region].name} Pokémon yet.` : 'No Pokémon yet.'}</p>`}
    </div>
  </section>`;
};
registerActions({
  toDifficulty: () => go('difficulty', { mode: S.ui.mode }),
  starterRegion: r => go('starters', { region: +r, difficulty: S.ui.difficulty, mode: S.ui.mode }),
  pickStarter: id => {
    S.modal = { type: 'confirmStarter', id: +id, difficulty: S.ui.difficulty || 'medium', mode: S.ui.mode || 'classic' };
    render();
  },
  confirmStarter: async id => {
    const difficulty = S.modal?.difficulty || 'medium';
    const mode = S.modal?.mode || 'classic';
    const choice = { nat: S.modal?.nat, ab: S.modal?.ab, shiny: S.modal?.shiny && unlockedFor(+id).shiny };
    S.modal = null;
    S.run = newRun(+id, difficulty, mode, choice);
    track('runStart');
    if (S.run.party[0].shiny) track('shinyStart');
    S.profile.stats.runs++;
    persistProfile();
    playCry(+id);
    persistRun();
    go('map');
  },
});

// ---------- Map ----------
function nodePos(n) {
  // Deterministic jitter so the map looks hand-drawn
  const h = [...n.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7);
  const x = n.id === 'boss' ? 50 : ((n.c + 0.5) / 7) * 100 + ((h % 7) - 3);
  const y = (ROWS - 1 - n.r) * 76 + 50 + ((h % 5) - 2) * 3;
  return { x, y };
}

SCREENS.map = () => {
  const run = S.run;
  playMusic('map');
  const { nodes } = run.map;
  const avail = new Set(availableNodes(run));
  const height = ROWS * 76 + 40;
  let lines = '';
  for (const n of Object.values(nodes)) {
    const a = nodePos(n);
    for (const id of n.next) {
      const b = nodePos(nodes[id]);
      const walked = run.visited.includes(n.id) && (run.visited.includes(id) || run.pos === n.id);
      lines += `<line x1="${a.x}%" y1="${a.y}" x2="${b.x}%" y2="${b.y}" class="${walked && run.visited.includes(id) ? 'walked' : ''}"/>`;
    }
  }
  const btns = Object.values(nodes).map(n => {
    const p = nodePos(n);
    const info = NODE_INFO[n.type];
    const cls = [avail.has(n.id) ? 'available' : '', run.visited.includes(n.id) ? 'visited' : '', run.pos === n.id ? 'current' : '', n.type].join(' ');
    const label = n.id === 'boss' ? bossLabel() : info.label;
    return `<button class="node ${cls}" style="left:${p.x}%;top:${p.y}px" data-act="visitNode" data-arg="${n.id}" ${avail.has(n.id) ? '' : 'disabled'} title="${esc(label)}" aria-label="${esc(label)}">${info.icon}</button>`;
  }).join('');
  return `<section class="map-layout">
    <div class="panel map-panel">
      <div class="row"><div><p class="eyebrow">${esc(ACTS[run.act - 1].name)} ${modeBadge(modeOf(run))} ${diffBadge(run.difficulty || 'medium')}${modeOf(run) === 'classic' ? ` · ${esc(runRegion(run))}` : ''}</p><h2>Choose your path</h2></div>
        <span class="muted">Boss: ${esc(bossLabel())}</span></div>
      <div class="map" style="height:${height}px"><svg width="100%" height="${height}">${lines}</svg>${btns}</div>
      <div class="legend">${Object.entries(NODE_INFO).filter(([k]) => k !== 'boss').map(([, v]) => `<span title="${esc(v.desc)}">${v.icon} ${v.label}</span>`).join('')}</div>
    </div>
    ${sidePanel()}
  </section>`;
};
function bossLabel() {
  const b = ACTS[S.run.act - 1].boss;
  return b === 'gym' ? 'Gym Leader' : b === 'villainBoss' ? 'Villain Team Boss' : 'Elite Four & Champion';
}
function sidePanel() {
  const run = S.run;
  return `<aside class="panel side">
    ${run.god ? '<div class="god-banner">⚡ God mode is on</div>' : ''}
    <div class="wallet"><span>Money</span><b>$${run.money.toLocaleString()}</b></div>
    <div class="wallet"><span>Score</span><b>${(run.score || 0).toLocaleString()} pts</b></div>
    <h3>Team <small class="muted">${run.party.length}/6 · Box ${run.box.length}</small></h3>
    <div class="party-list">${run.party.map((m, i) => monCard(m, i)).join('')}</div>
    <div class="row gap wrap"><button data-act="openBag">Bag</button><button data-act="openTeam">Team</button><button data-act="openBox">Box</button></div>
    <h3>Badges <small class="muted">${run.badges.length}</small></h3>
    <div class="badges">${run.badges.length ? run.badges.map(b => `<span class="badge" title="${esc(b.leader)}">${esc(b.name)}</span>`).join('') : '<span class="muted small">Defeat Gym Leaders to earn badges.</span>'}</div>
    <p class="muted small">Battles won: ${run.stats.wins} · Caught: ${run.stats.caught}</p>
    ${run.fallen?.length ? `<p class="muted small">Fallen: ${run.fallen.map(f => esc(f.name)).join(', ')}</p>` : ''}
    ${S.user.isAdmin ? '<div class="row gap wrap"><button class="admin-btn" data-act="openAdmin">Admin panel</button></div>' : ''}
    <div class="row gap wrap"><button class="ghost" data-act="toMenu">Save & quit</button><button class="ghost danger" data-act="abandonRun">Abandon run</button></div>
  </aside>`;
}

registerActions({
  visitNode: id => visitNode(id),
  toMenu: async () => { await flushSaves(); go('menu'); },
  abandonRun: () => { S.modal = { type: 'confirm', text: 'Abandon this run? It will be recorded in your history.', yes: 'confirmAbandon' }; render(); },
  confirmAbandon: async () => { S.modal = null; await endRun('Abandoned'); go('menu'); },
});

function visitNode(id) {
  const run = S.run;
  if (!availableNodes(run).includes(id)) return;
  const node = run.map.nodes[id];
  run.pos = id;
  run.visited.push(id);
  run.stats.nodes++;
  run.party.forEach(m => { if (m.hp > 0) m.fr = Math.min(255, m.fr + 1); }); // walking together builds friendship
  if (node.type === 'boss' && ACTS[run.act - 1].boss === 'league') {
    startLeague(run);
    persistRun();
    go('league');
    return;
  }
  if (['stop', 'mart', 'center'].includes(node.type)) {
    run.node = { type: node.type };
    if (node.type === 'stop') run.node.spun = false;
    if (node.type === 'center') healParty(run);
    persistRun();
    go('node');
    return;
  }
  const spec = buildEncounter(run, node);
  spec.node = node.type;
  launchBattle(spec);
}

export function launchBattle(spec) {
  const run = S.run;
  applyDifficulty(run, spec);
  const events = startBattle(run, spec);
  run.battle.node = spec.node || spec.kind;
  run.stats.battles++;
  persistRun();
  beginBattle(events);
}

// ---------- Service nodes: PokéStop, PokéMart, Pokémon Center ----------
SCREENS.node = () => {
  const run = S.run, n = run.node;
  if (n.type === 'stop') {
    return `<section class="panel narrow center-text">
      <p class="eyebrow">PokéStop</p>
      <div class="pokestop ${n.spun ? 'spun' : ''}">🔷</div>
      ${n.spun ? `<h2>Items received</h2><ul class="loot">${n.result.items.map(([it, c]) => `<li>${itemImg(it)} ${esc(it)} ×${c}</li>`).join('')}${n.result.money ? `<li>💰 $${n.result.money.toLocaleString()}</li>` : ''}</ul>
        <button class="primary" data-act="leaveNode">Continue</button>`
        : `<h2>Spin the Photo Disc</h2><p class="muted">PokéStops hand out free supplies.</p><button class="primary big" data-act="spinStop">Spin!</button>`}
    </section>`;
  }
  if (n.type === 'mart') {
    const stock = martStock(run);
    return `<section class="panel">
      <div class="row"><div><p class="eyebrow">PokéMart</p><h2>Welcome! How may I help you?</h2></div><span class="money big-money">$${run.money.toLocaleString()}</span></div>
      <div class="shop">${stock.map(s => `<div class="shop-item">
        ${itemImg(s.name)}<div><strong>${esc(s.name)}</strong><p class="muted small">${esc(ITEMS[s.name].desc)}</p><small>In bag: ${run.bag[s.name] || 0}</small></div>
        <div class="buy"><span>$${s.price.toLocaleString()}</span>
          <button data-act="buy" data-arg="${esc(s.name)}|1" ${run.money < s.price ? 'disabled' : ''}>Buy</button>
          <button data-act="buy" data-arg="${esc(s.name)}|5" ${run.money < s.price * 5 ? 'disabled' : ''}>×5</button></div></div>`).join('')}</div>
      <div class="row gap"><button data-act="openBag">Bag</button><button class="primary" data-act="leaveNode">Leave</button></div>
    </section>`;
  }
  if (n.type === 'center') {
    return `<section class="panel">
      <p class="eyebrow">Pokémon Center</p>
      <h2>Your Pokémon are fully healed!</h2>
      <p class="muted">We hope to see you again! Use the PC to move Pokémon between your team and the Box.</p>
      ${pcView()}
      <div class="row gap"><button class="primary" data-act="leaveNode">Leave</button></div>
    </section>`;
  }
  return '';
};

function pcView() {
  const run = S.run;
  return `<div class="pc">
    <div><h3>Team (${run.party.length}/6)</h3><div class="party-list">${run.party.map((m, i) => monCard(m, i, { action: 'depositMon', extra: '<span class="small">→ Box</span>' })).join('')}</div></div>
    <div><h3>Box (${run.box.length})</h3>${run.box.length ? filterBar('box') : ''}<div class="party-list">${run.box.length ? (sortMons(run.box, filterState('box')).map(([m, i]) => monCard(m, i, { action: 'withdrawMon', extra: `<span class="small">${sortExtra(m, 'box')} → Team</span>` })).join('') || '<p class="muted small">No Pokémon match these filters.</p>') : '<p class="muted small">Pokémon caught with a full team go here.</p>'}</div></div>
  </div>`;
}

registerActions({
  spinStop: () => {
    const n = S.run.node;
    if (n.spun) return;
    n.result = spinPokeStop(S.run);
    n.spun = true;
    track('stop');
    sfx('coin');
    persistRun();
    render();
  },
  buy: arg => {
    const [name, qty] = arg.split('|');
    const cost = priceOf(S.run, name) * +qty;
    if (S.run.money < cost) { sfx('error'); return; }
    S.run.money -= cost;
    addItem(S.run, name, +qty);
    sfx('coin');
    persistRun();
    render();
  },
  depositMon: i => {
    const run = S.run;
    if (run.party.length <= 1) { toast('You need at least one Pokémon on your team.'); return; }
    run.box.push(...run.party.splice(+i, 1));
    if (!run.party.some(m => m.hp > 0)) { run.party.unshift(...run.box.splice(-1, 1)); toast('Keep at least one healthy Pokémon on your team.'); }
    persistRun(); render();
  },
  withdrawMon: i => {
    const run = S.run;
    if (run.party.length >= 6) { toast('Your team is full. Deposit a Pokémon first.'); return; }
    const [m] = run.box.splice(+i, 1);
    healPartyMon(m);
    run.party.push(m);
    persistRun(); render();
  },
  leaveNode: () => { S.run.node = null; persistRun(); go('map'); },
});
function healPartyMon(m) { m.hp = maxHp(m); m.st = null; m.moves.forEach(x => { x.pp = MOVES[x.id].pp; }); }

// ---------- Team & summary overlays ----------
registerActions({
  openTeam: () => { S.modal = { type: 'team' }; render(); },
  showSummary: i => { S.modal = { type: 'summary', index: +i }; render(); },
  showBoxSummary: i => { S.modal = { type: 'summary', index: +i, src: 'box' }; render(); },
  openBox: () => { S.modal = { type: 'box' }; render(); },
  moveUp: i => {
    i = +i;
    const p = S.run.party;
    if (i > 0) [p[i - 1], p[i]] = [p[i], p[i - 1]];
    S.modal = { type: 'summary', index: Math.max(0, i - 1) };
    persistRun(); render();
  },
  makeLead: i => {
    const p = S.run.party;
    const [m] = p.splice(+i, 1); p.unshift(m);
    S.modal = { type: 'summary', index: 0 };
    persistRun(); render();
  },
  openBag: () => { S.modal = { type: 'bag', pocket: 0 }; render(); },
  bagPocket: p => { S.modal.pocket = +p; render(); },
  bagItem: name => { S.modal = { type: 'bagTarget', item: name }; render(); },
  useItemOn: i => useFieldItem(S.modal.item, +i),
});

function renderModal() {
  const m = S.modal;
  let body = '';
  if (m.type === 'confirm') {
    body = `<p>${esc(m.text)}</p><div class="row gap"><button data-act="closeModal">Cancel</button><button class="primary danger" data-act="${m.yes}">Confirm</button></div>`;
  } else if (m.type === 'confirmStarter') {
    const sp = DEX[m.id];
    const un = unlockedFor(m.id);
    const pickers = (un.natures.length || un.abilities.length || un.shiny) ? `<div class="starter-pickers">
        ${un.shiny ? `<label class="check shiny-pick"><input type="checkbox" class="silent" data-act="starterShiny" ${m.shiny ? 'checked' : ''}> <span class="shiny-mark">✦</span> Shiny</label>` : ''}
        ${un.natures.length ? `<label>Nature<select data-input="starterNature"><option value="">Random</option>${un.natures.map(n => `<option value="${n}" ${m.nat === n ? 'selected' : ''}>${esc(natureLabel(n))}</option>`).join('')}</select></label>` : ''}
        ${un.abilities.length ? `<label>Ability<select data-input="starterAbility"><option value="">Random</option>${un.abilities.map(a => `<option ${m.ab === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>` : ''}
      </div>` : '';
    body = `<div class="center-text">${img(artUrl(m.id, m.shiny), 'modal-art', sp.n)}<h2>${sp.n}</h2><div>${sp.t.map(typeBadge).join('')}</div>
      <div class="abilities-preview">${[...sp.a.map(a => abilityInfo(a, false)), sp.h ? abilityInfo(sp.h, true) : ''].join('')}</div>
      <h4>Starting moves (Lv 5)</h4>
      <div class="move-chips">${movesAtLevel(m.id, 5).map(x => `<span class="move-chip" style="--tc:${TYPE_COLORS[MOVES[x].t]}" title="${esc(MOVES[x].d || '')}">${esc(MOVES[x].n)}<small>${MOVES[x].t} · ${CAT[MOVES[x].c]}${MOVES[x].p ? ' · ' + MOVES[x].p : ''}</small></span>`).join('')}</div>
      <h4>Evolution</h4>
      ${evolutionChain(m.id)}
      <h4>Moveset <button class="small-btn" data-act="toggleLearnset">${m.showLearnset ? 'Hide' : 'Show'} all moves</button></h4>
      ${m.showLearnset ? learnsetTable(m.id) : ''}
      ${pickers}
      <p class="muted">Start a ${GAME_MODES[m.mode].name} · ${DIFFICULTIES[m.difficulty].name} run with ${sp.n}?${m.mode === 'classic' ? ` You'll journey through ${REGIONS[regionOf(m.id)].name}.` : ''}</p></div>
      <div class="row gap"><button data-act="closeModal">Not yet</button><button class="primary" data-act="confirmStarter" data-arg="${m.id}">I choose you!</button></div>`;
  } else if (m.type === 'team') {
    body = `<h2>Team</h2>${filterBar('team')}<div class="party-list">${sortMons(S.run.party, filterState('team')).map(([x, i]) => monCard(x, i, { extra: `<span class="small">${sortExtra(x, 'team')}</span>` })).join('') || '<p class="muted small">No Pokémon match these filters.</p>'}</div>
      <p class="muted small">Select a Pokémon to see its summary, change the lead, or use an item. Sorting only changes this view; use "Make lead" to change your battle order.</p>
      <div class="row gap"><button data-act="openBag">Bag</button><button data-act="openBox">Box (${S.run.box.length})</button><button class="primary" data-act="closeModal">Close</button></div>`;
  } else if (m.type === 'box') {
    body = `<h2>Box <small class="muted">${S.run.box.length} Pokémon</small></h2>${filterBar('boxView')}
      <div class="party-list">${S.run.box.length ? (sortMons(S.run.box, filterState('boxView')).map(([x, i]) => monCard(x, i, { action: 'showBoxSummary', extra: `<span class="small">${sortExtra(x, 'boxView')}</span>` })).join('') || '<p class="muted small">No Pokémon match these filters.</p>') : '<p class="muted small">Pokémon caught with a full team go here.</p>'}</div>
      <p class="muted small">Move Pokémon between your team and the Box at a Pokémon Center.</p>
      <div class="row gap"><button data-act="openTeam">Team</button><button class="primary" data-act="closeModal">Close</button></div>`;
  } else if (m.type === 'summary') {
    body = m.picker ? pickerHtml(m) : summaryHtml(summaryMon(m), m.index, m.src || 'party');
  } else if (m.type === 'bag') {
    body = bagHtml(m.pocket);
  } else if (m.type === 'dexEntry') {
    body = dexEntryHtml(m.id);
  } else if (m.type === 'admin') {
    body = adminHtml();
  } else if (m.type === 'bagTarget') {
    body = `<h2>Use ${esc(m.item)}</h2><p class="muted">${esc(ITEMS[m.item].desc)}</p>
      <div class="party-list">${S.run.party.map((x, i) => monCard(x, i, { action: 'useItemOn', extra: itemHint(m.item, x) })).join('')}</div>
      <div class="row gap"><button data-act="openBag">Back</button></div>`;
  }
  return `<div class="modal-backdrop"><div class="modal panel" role="dialog" aria-modal="true">${body}</div></div>`;
}

function itemHint(item, mon) {
  const it = ITEMS[item];
  if (it.kind === 'evo') return itemEvolution(mon, item) ? '<span class="small good-text">Able</span>' : '<span class="small muted">Unable</span>';
  return '';
}

/** Shows the value being sorted by, e.g. "Spe 87", on each card. */
function sortExtra(m, ctx) {
  const f = filterState(ctx);
  switch (f.sort) {
    case 'bst': return 'BST ' + bst(m.id);
    case 'ivs': return 'IVs ' + m.iv.reduce((a, b) => a + b, 0);
    case 'evs': return 'EVs ' + m.ev.reduce((a, b) => a + b, 0);
    case 'hpPct': return Math.round((m.hp / maxHp(m)) * 100) + '%';
    default: return f.sort in STAT_IDX ? STAT_SHORT[STAT_IDX[f.sort]] + ' ' + calcStats(m)[STAT_IDX[f.sort]] : '';
  }
}

function summaryMon(m) { return (m.src === 'box' ? S.run.box : S.run.party)[m.index]; }

export function abilityInfo(name, hidden) {
  return `<div class="ability"><strong>${esc(name)}</strong>${hidden ? ' <span class="tag-hidden">Hidden</span>' : ''}<p class="small muted">${esc(ABILITIES[name] || 'No description available.')}</p></div>`;
}

function summaryHtml(mon, index, src = 'party') {
  const sp = DEX[mon.id];
  const stats = calcStats(mon);
  const next = expForLevel(sp.gr, mon.lv + 1), cur = expForLevel(sp.gr, mon.lv);
  const pct = mon.lv >= 100 ? 100 : ((mon.exp - cur) / (next - cur)) * 100;
  const evTotal = mon.ev.reduce((a, b) => a + b, 0);
  const ivTotal = mon.iv.reduce((a, b) => a + b, 0);
  const natures = unlockedNatures(mon).filter(n => n !== mon.nat);
  const abilities = unlockedAbilitySlots(mon).filter(a => a !== mon.ab);
  return `<div class="summary">
    <div class="summary-head">
      ${img(artUrl(mon.id, mon.shiny), 'summary-art', sp.n)}
      <div><h2>${esc(monName(mon))}${mon.shiny ? ' <span class="shiny-mark" title="Shiny">✦</span>' : ''} <small>Lv ${mon.lv}</small></h2>
        <div>${sp.t.map(typeBadge).join('')} ${statusTag(mon.st)}</div>
        <p class="small">#${mon.id} · Friendship ${mon.fr} · ${mon.lv < 100 ? `${(next - mon.exp).toLocaleString()} Exp. to Lv ${mon.lv + 1}` : 'Max level'}${mon.ball ? ` · Caught in a ${esc(mon.ball)}` : ''}</p>
        <div class="expbar"><i style="width:${pct}%"></i></div>
      </div>
    </div>
    <div class="summary-cols">
      <div>
        <h4>Nature</h4>
        <div class="row"><span>${esc(natureLabel(mon.nat))}</span>${natures.length ? `<button class="small-btn" data-act="openNature">Change (${natures.length})</button>` : ''}</div>
        <h4>Ability</h4>
        ${abilityInfo(mon.ab, mon.ab === sp.h)}
        ${abilities.length ? `<button class="small-btn" data-act="openAbility">Change ability (${abilities.length})</button>` : ''}
        <p class="small muted">${natures.length || abilities.length ? '' : 'Catch more of this evolution family to unlock other natures and abilities.'}</p>
      </div>
      <div>
        <h4>Stats</h4>
        <table class="stats full">
          <tr><th></th><th>Base</th><th>IV</th><th>EV</th><th>Stat</th></tr>
          ${stats.map((v, i) => {
            const nm = natureMod(mon.nat, i);
            return `<tr><th class="${nm > 1 ? 'up' : nm < 1 ? 'down' : ''}">${STAT_SHORT[i]}</th><td>${sp.b[i]}</td>
              <td title="${ivJudge(mon.iv[i])}"><span class="iv iv-${mon.iv[i] === 31 ? 'best' : mon.iv[i] >= 26 ? 'good' : mon.iv[i] >= 16 ? 'ok' : 'low'}">${mon.iv[i]}</span></td>
              <td>${mon.ev[i]}</td><td><b>${i === 0 ? `${mon.hp}/${v}` : v}</b></td></tr>`;
          }).join('')}
          <tr class="totals"><th>Total</th><td>${bst(mon.id)}</td><td>${ivTotal}/186</td><td>${evTotal}/510</td><td></td></tr>
        </table>
        <p class="small muted">IVs are 0–31 (hover for the judge's rating). EVs come from battles and vitamins: up to 252 per stat, 510 total.</p>
      </div>
    </div>
    <h4>Moves</h4>
    <div class="moves-list two-col">${mon.moves.map(x => moveRow(x.id, x.pp)).join('')}</div>
    <h4>Moveset <button class="small-btn" data-act="toggleLearnset">${S.modal?.showLearnset ? 'Hide' : 'Show'} all ${esc(sp.n)} moves</button></h4>
    ${S.modal?.showLearnset ? learnsetTable(mon.id, { mon }) : ''}
    ${evolutionSection(mon)}
    <div class="row gap wrap">
      ${src === 'party' && index > 0 ? `<button data-act="makeLead" data-arg="${index}">Make lead</button><button data-act="moveUp" data-arg="${index}">Move up</button>` : ''}
      ${src === 'party' ? '<button data-act="openBag">Use item</button>' : ''}
      <button class="primary" data-act="${src === 'party' ? 'openTeam' : 'closeModal'}">Back</button>
    </div>
  </div>`;
}

export function moveRow(id, pp) {
  const mv = MOVES[id];
  return `<div class="move-row" style="border-left-color:${TYPE_COLORS[mv.t]}">
    <div class="row"><strong>${esc(mv.n)}</strong><span class="small">${pp != null ? `${pp}/${mv.pp} PP` : `${mv.pp} PP`}</span></div>
    <div class="row small"><span>${typeBadge(mv.t)} ${mv.c === 'P' ? 'Physical' : mv.c === 'S' ? 'Status' : 'Special'}</span><span>Pow ${mv.p || '—'} · Acc ${mv.a || '—'}</span></div>
    <p class="small muted">${esc(mv.d || '')}</p>
  </div>`;
}

// ---------- Evolution requirements and movesets (shared by summary, starter pick and Pokédex) ----------
/** Plain-language requirement for one evolution, e.g. "Lv 16" or "Use a Water Stone". */
export function evoReqText(e) {
  const item = evoItemFor(e);
  const time = e.cond?.includes('during the day') ? ' during the day' : e.cond?.includes('at night') ? ' at night' : '';
  if (item) {
    const why = e.type === 'trade' && !e.item ? ' (instead of trading)' : e.type === 'trade' ? ' (instead of trading while holding it)'
      : e.type === 'other' || (e.type === 'levelExtra' && !e.cond?.includes('Fairy')) ? ` (instead of: ${e.cond || 'a special condition'})` : '';
    return `Use ${/^[AEIOU]/.test(item) ? 'an' : 'a'} ${item}${why}`;
  }
  if (e.type === 'levelFriendship') return `Level up with high friendship (160+)${time}`;
  if (e.type === 'levelMove') return `Level up knowing ${MOVES[e.move]?.n || e.move}`;
  if (e.type === 'levelExtra') return 'Level up with high friendship while knowing a Fairy-type move';
  const extra = (e.cond || '').replace(/with the console turned upside-down|during rain/, '').trim();
  return `Lv ${e.level}${time}${extra && !time ? ` (${extra})` : ''}`;
}

/** The whole evolution family as a tree, with requirements on each step. */
export function evolutionChain(id) {
  const root = familyRoot(id);
  const node = (x, req) => `<div class="chain-node">
      ${req ? `<div class="chain-req">↓ ${esc(req)}</div>` : ''}
      <div class="chain-mon ${x === id ? 'current' : ''}">${img(spriteUrl(x), 'mini-sprite', DEX[x].n)}<span><strong>${esc(DEX[x].n)}</strong> ${DEX[x].t.map(typeBadge).join('')}</span></div>
      ${(DEX[x].e || []).length ? `<div class="chain-children">${DEX[x].e.map(e => node(e.to, evoReqText(e))).join('')}</div>` : ''}
    </div>`;
  const single = !(DEX[root].e || []).length;
  return `<div class="evo-chain">${node(root, '')}</div>${single ? `<p class="small muted">${esc(DEX[id].n)} does not evolve.</p>` : ''}`;
}

const CAT = { P: 'Physical', X: 'Special', S: 'Status' };
/**
 * PokéRogue-style level-up moveset: Lv · Move · Type · Category · Power · Accuracy · PP.
 * With `mon`, known moves are ticked and moves it can learn now get a Teach button
 * (admins can teach any move on the list).
 */
export function learnsetTable(id, { mon = null } = {}) {
  const list = (LEARN[id] || []).filter(([, m]) => MOVES[m]);
  const known = new Set(mon?.moves.map(m => m.id) || []);
  const admin = !!S.user?.isAdmin;
  const seen = new Set();
  const rows = list.filter(([lv, m]) => { const k = lv + m; if (seen.has(k)) return false; seen.add(k); return true; }).map(([lv, m]) => {
    const mv = MOVES[m];
    const reachable = !mon || lv <= mon.lv;
    const canTeach = mon && !known.has(m) && (reachable || admin);
    return `<tr class="${known.has(m) ? 'known' : ''} ${reachable ? '' : 'locked'}" title="${esc(mv.d || '')}">
      <td>${lv === 0 ? 'Evo' : lv}</td>
      <td><strong>${esc(mv.n)}</strong>${known.has(m) ? ' <span class="good-text">✓</span>' : ''}<small class="muted move-desc">${esc(mv.d || '')}</small></td>
      <td>${typeBadge(mv.t)}</td><td><span class="cat cat-${mv.c}">${CAT[mv.c]}</span></td>
      <td>${mv.p || '—'}</td><td>${mv.a ? mv.a + '%' : '—'}</td><td>${mv.pp}</td>
      ${mon ? `<td>${canTeach ? `<button class="small-btn ${reachable ? '' : 'admin-btn'}" data-act="teachMove" data-arg="${m}" title="${reachable ? 'Teach this move' : 'Admin: teach early'}">Teach</button>` : ''}</td>` : ''}
    </tr>`;
  }).join('');
  return `<div class="table-scroll"><table class="moveset">
    <tr><th>Lv</th><th>Move</th><th>Type</th><th>Cat.</th><th>Pow</th><th>Acc</th><th>PP</th>${mon ? '<th></th>' : ''}</tr>${rows}
  </table></div>${mon ? `<p class="small muted">Moves at or below Lv ${mon.lv} can be relearned anytime, like a Move Reminder.${admin ? ' As an admin you can also teach moves early (marks the run as admin tools used).' : ''}</p>` : ''}`;
}

export function evolutionSection(mon) {
  const sp = DEX[mon.id];
  const run = S.run;
  const from = sp.p ? `<p class="small muted">Evolves from ${esc(DEX[sp.p].n)}.</p>` : '';
  const evos = sp.e || [];
  if (!evos.length) return `<h4>Evolution</h4>${from}<p class="small muted">${esc(sp.n)} does not evolve.</p>`;
  const day = (() => { const h = new Date().getHours(); return h >= 6 && h < 18; })();
  const rows = evos.map(e => {
    const to = DEX[e.to];
    const item = evoItemFor(e);
    const have = item ? (run?.bag[item] || 0) : 0;
    let cond, ready = false;
    const time = e.cond?.includes('during the day') ? ` during the day (now: ${day ? 'day ✓' : 'night'})` : e.cond?.includes('at night') ? ` at night (now: ${day ? 'day' : 'night ✓'})` : '';
    if (item) {
      cond = `Use ${/^[AEIOU]/.test(item) ? 'an' : 'a'} ${item}${e.type === 'trade' && !e.item ? ' (stands in for trading)' : e.type === 'other' || (e.type === 'levelExtra' && !e.cond?.includes('Fairy')) ? ` (stands in for: ${e.cond || 'a special condition'})` : ''}. You have ${have}.`;
      ready = have > 0;
    } else if (e.type === 'levelFriendship') {
      cond = `Level up with friendship 160+${time}. Friendship now: ${mon.fr}.`;
      ready = mon.fr >= 160;
    } else if (e.type === 'levelMove') {
      const knows = mon.moves.some(m => m.id === e.move);
      cond = `Level up knowing ${MOVES[e.move]?.n || e.move} (${knows ? 'knows it ✓' : 'not known yet'}).`;
      ready = knows;
    } else if (e.type === 'levelExtra') {
      cond = `Level up with friendship 160+ while knowing a Fairy-type move. Friendship now: ${mon.fr}.`;
    } else {
      const extra = (e.cond || '').replace(/with the console turned upside-down|during rain/, '').trim();
      cond = `Reach Lv ${e.level}${time}${extra && !time ? ` (${extra})` : ''}. Now Lv ${mon.lv}.`;
      ready = mon.lv >= e.level;
    }
    const adminBtn = S.user?.isAdmin && run && mon.hp > 0 ? `<button class="small-btn admin-btn" data-act="adminEvolve" data-arg="${e.to}" title="Admin: evolve now">Evolve now</button>` : '';
    return `<div class="evo-row ${ready ? 'ready' : ''}">${img(spriteUrl(e.to), 'mini-sprite', to.n)}<div><strong>${esc(to.n)}</strong> ${to.t.map(typeBadge).join('')}<p class="small">${esc(cond)}</p></div>${adminBtn}</div>`;
  }).join('');
  return `<h4>Evolution</h4>${from}<div class="evo-list">${rows}</div>`;
}

// ---------- Natures & abilities unlocked by catching (per evolution family) ----------
function dexEntry(id) { return S.profile.dex?.[familyRoot(id)]; }
function abilitySlot(id, ab) {
  const sp = DEX[id];
  const i = sp.a.indexOf(ab);
  return i >= 0 ? String(i) : ab === sp.h ? 'H' : null;
}
export function recordCatch(mon) {
  S.profile.dex ||= {};
  const k = familyRoot(mon.id);
  const e = (S.profile.dex[k] ||= { n: [], a: [] });
  let changed = false;
  if (!e.n.includes(mon.nat)) { e.n.push(mon.nat); changed = true; }
  const slot = abilitySlot(mon.id, mon.ab);
  if (slot && !e.a.includes(slot)) { e.a.push(slot); changed = true; }
  if (mon.shiny && !e.s) { e.s = true; changed = true; }
  S.profile.shinies ||= [];
  if (mon.shiny && !S.profile.shinies.includes(mon.id)) { S.profile.shinies.push(mon.id); changed = true; }
  if (!S.profile.caught.includes(mon.id)) { S.profile.caught.push(mon.id); changed = true; } // shiny or not, the species is caught
  return changed;
}
function unlockedNatures(mon) { return [...(dexEntry(mon.id)?.n || [])].sort((a, b) => a - b); }
/** Abilities unlocked for this Pokémon's current species (slots map across evolutions). */
function unlockedAbilitySlots(mon) {
  const sp = DEX[mon.id];
  const names = (dexEntry(mon.id)?.a || []).map(slot => slot === 'H' ? sp.h : sp.a[+slot] || sp.a[0]).filter(Boolean);
  return [...new Set(names)];
}
export function unlockedFor(id) {
  const e = S.profile.dex?.[familyRoot(id)] || { n: [], a: [] };
  const sp = DEX[id];
  return { natures: [...e.n].sort((a, b) => a - b), abilities: [...new Set(e.a.map(slot => slot === 'H' ? sp.h : sp.a[+slot] || sp.a[0]).filter(Boolean))], shiny: !!e.s || adminAllShinies() };
}

registerActions({
  openNature: () => { S.modal = { ...S.modal, picker: 'nature' }; render(); },
  openAbility: () => { S.modal = { ...S.modal, picker: 'ability' }; render(); },
  closePicker: () => { S.modal = { ...S.modal, picker: null }; render(); },
  setNature: n => {
    const mon = summaryMon(S.modal);
    if (!unlockedNatures(mon).includes(+n)) return;
    const before = maxHp(mon);
    mon.nat = +n;
    mon.hp = Math.max(mon.hp > 0 ? 1 : 0, mon.hp + maxHp(mon) - before);
    S.modal = { ...S.modal, picker: null };
    toast(`${monName(mon)} is now ${NATURES[+n]}.`);
    persistRun(); render();
  },
  setAbility: name => {
    const mon = summaryMon(S.modal);
    if (!unlockedAbilitySlots(mon).includes(name)) return;
    mon.ab = name;
    S.modal = { ...S.modal, picker: null };
    toast(`${monName(mon)}'s ability is now ${name}.`);
    persistRun(); render();
  },
});

function pickerHtml(m) {
  const mon = summaryMon(m);
  if (m.picker === 'nature') {
    return `<h2>Change ${esc(monName(mon))}'s nature</h2>
      <p class="muted small">Natures you've caught in the ${esc(DEX[familyRoot(mon.id)].n)} family.</p>
      <div class="picker-grid">${unlockedNatures(mon).map(n => `<button class="${n === mon.nat ? 'active' : ''}" data-act="setNature" data-arg="${n}" ${n === mon.nat ? 'disabled' : ''}>${esc(natureLabel(n))}</button>`).join('')}</div>
      <div class="row gap"><button data-act="closePicker">Back</button></div>`;
  }
  return `<h2>Change ${esc(monName(mon))}'s ability</h2>
    <p class="muted small">Abilities you've caught in the ${esc(DEX[familyRoot(mon.id)].n)} family.</p>
    <div class="picker-list">${unlockedAbilitySlots(mon).map(a => `<button class="${a === mon.ab ? 'active' : ''}" data-act="setAbility" data-arg="${esc(a)}" ${a === mon.ab ? 'disabled' : ''}>${abilityInfo(a, a === DEX[mon.id].h)}</button>`).join('')}</div>
    <div class="row gap"><button data-act="closePicker">Back</button></div>`;
}

function bagHtml(pocket) {
  const run = S.run;
  const [title, kinds] = BAG_POCKETS[pocket];
  const items = Object.entries(run.bag).filter(([k, v]) => v > 0 && ITEMS[k] && kinds.includes(ITEMS[k].kind));
  return `<h2>Bag</h2>
    <div class="tabs">${BAG_POCKETS.map(([t], i) => `<button class="${i === pocket ? 'active' : ''}" data-act="bagPocket" data-arg="${i}">${t}</button>`).join('')}</div>
    <div class="bag-list">${items.length ? items.map(([k, v]) => `<button class="bag-item" data-act="bagItem" data-arg="${esc(k)}" ${ITEMS[k].kind === 'ball' ? 'disabled' : ''}>
      ${itemImg(k)}<span><strong>${esc(k)}</strong><small class="muted">${esc(ITEMS[k].desc)}</small></span><b>×${v}</b></button>`).join('') : `<p class="muted">No ${title.toLowerCase()}.</p>`}</div>
    <div class="row gap"><button class="primary" data-act="closeModal">Close</button></div>`;
}

function useFieldItem(item, index) {
  const run = S.run;
  const mon = run.party[index];
  const it = ITEMS[item];
  if (!mon || !run.bag[item]) return;
  if (it.kind === 'evo') {
    const to = itemEvolution(mon, item);
    if (!to || mon.hp <= 0) { toast("It won't have any effect."); return; }
    run.bag[item]--;
    S.modal = null;
    queueFlow([{ type: 'evolve', uid: mon.uid, to, item }]);
    return;
  }
  if (it.kind === 'candy' || it.kind === 'expcandy') {
    if (mon.lv >= 100 || mon.hp <= 0) { toast("It won't have any effect."); return; }
    run.bag[item]--;
    const steps = [];
    const before = mon.lv;
    const events = it.kind === 'candy' ? levelUp(mon) : gainExp(mon, it.amount);
    for (const e of events) {
      if (e.type === 'level') steps.push({ type: 'msg', text: `${monName(mon)} grew to Lv. ${e.lv}!`, sfx: 'levelup' });
      if (e.type === 'learn') steps.push({ type: 'msg', text: `${monName(mon)} learned ${MOVES[e.move].n}!` });
      if (e.type === 'learnFull') steps.push({ type: 'learn', uid: mon.uid, move: e.move });
    }
    if (mon.lv === before) steps.push({ type: 'msg', text: `${monName(mon)} gained ${it.amount.toLocaleString()} Exp. Points!` });
    const evo = mon.lv > before ? levelEvolution(mon, run.party) : null;
    if (evo) steps.push({ type: 'evolve', uid: mon.uid, to: evo });
    S.modal = null;
    queueFlow(steps);
    return;
  }
  const res = applyItem(mon, item);
  if (!res.ok) { toast(res.msg || "It won't have any effect."); sfx('error'); return; }
  run.bag[item]--;
  sfx('heal');
  toast(res.msg);
  persistRun();
  render();
}

// ---------- Admin panel (only for accounts with is_admin set in the database) ----------
function adminHtml() {
  const run = S.run;
  const inBattle = !!run?.battle;
  const runTools = run ? `
    <h3>This run</h3>
    <label class="check"><input type="checkbox" class="silent" data-act="adminGod" ${run.god ? 'checked' : ''}> <b>God mode</b> — your team can't be hurt, every hit knocks out, every Poké Ball catches</label>
    <div class="admin-grid">
      <button data-act="adminMoney">+$10,000</button>
      <button data-act="adminItems">99 of every item</button>
      <button data-act="adminHeal">Heal team</button>
      <button data-act="adminShiny">Make team shiny</button>
      <button data-act="adminLevels" data-arg="10">Team +10 levels</button>
      <button data-act="adminLevels" data-arg="100">Team to Lv 100</button>
      ${inBattle ? '' : `<button data-act="adminSkip" data-arg="2">Skip to Act II</button>
      <button data-act="adminSkip" data-arg="3">Skip to Act III</button>
      <button data-act="adminSkip" data-arg="league">Skip to the League</button>`}
    </div>
    <form data-form="adminAddMon" class="admin-add">
      <label>Add a Pokémon<input name="species" list="species-list" placeholder="e.g. Rayquaza" required></label>
      <label>Level<input name="level" type="number" min="1" max="100" value="50" required></label>
      <button class="primary" type="submit">Add</button>
    </form>
    <datalist id="species-list">${Object.values(DEX).map(sp => `<option value="${esc(sp.n)}">`).join('')}</datalist>
    <p class="muted small">Using God mode or any tool above marks the run as "Admin tools used": it scores 0 points and doesn't count toward missions or achievements.</p>` : '<p class="muted">Start or continue a run to use God mode and the run tools.</p>';
  return `<h2>Admin panel</h2>
    ${runTools}
    <h3>Account</h3>
    <label class="check"><input type="checkbox" class="silent" data-act="adminAllStarters" ${S.profile.settings.allStarters ? 'checked' : ''}> Every Pokémon is available as a starter</label>
    <label class="check"><input type="checkbox" class="silent" data-act="adminAllShinies" ${S.profile.settings.allShinies ? 'checked' : ''}> Every shiny is unlocked (Pokédex and shiny starters)</label>
    <p class="muted small">These two unlocks only change what you can view and pick. They don't add real catches, so they never unlock achievements.</p>
    <div class="row gap"><button class="primary" data-act="closeModal">Close</button></div>`;
}

function adminOnly(fn) {
  return (...args) => { if (S.user?.isAdmin) fn(...args); };
}

function setLevel(mon, lv) {
  lv = Math.min(100, lv);
  // Moves are learned into free slots; with four moves known, the current moves are kept
  while (mon.lv < lv) levelUp(mon);
  mon.exp = expForLevel(DEX[mon.id].gr, mon.lv);
}

registerActions({
  openAdmin: adminOnly(() => { S.modal = { type: 'admin' }; render(); }),
  adminGod: adminOnly((_, el) => {
    S.run.god = el.checked;
    if (el.checked) S.run.godUsed = true;
    toast(el.checked ? 'God mode on' : 'God mode off');
    persistRun(); render();
  }),
  adminMoney: adminOnly(() => { S.run.godUsed = true; S.run.money += 10000; sfx('coin'); persistRun(); render(); }),
  adminItems: adminOnly(() => { S.run.godUsed = true; for (const name of Object.keys(ITEMS)) S.run.bag[name] = 99; sfx('coin'); toast('Bag filled'); persistRun(); render(); }),
  adminShiny: adminOnly(() => { S.run.godUsed = true; S.run.party.forEach(m => { m.shiny = true; }); sfx('shiny'); persistRun(); render(); }),
  adminHeal: adminOnly(() => { S.run.godUsed = true; S.run.party.forEach(healPartyMon); sfx('heal'); persistRun(); render(); }),
  adminLevels: adminOnly(arg => {
    S.run.godUsed = true;
    for (const m of S.run.party) { setLevel(m, arg === '100' ? 100 : m.lv + 10); m.hp = maxHp(m); }
    sfx('levelup'); toast('Team leveled up'); persistRun(); render();
  }),
  adminSkip: adminOnly(arg => {
    S.run.godUsed = true;
    const run = S.run;
    run.act = arg === 'league' ? 3 : +arg;
    run.map = generateMap(run.act);
    run.league = null; run.node = null; run.battle = null;
    if (arg === 'league') {
      const pre = Object.values(run.map.nodes).find(n => n.r === ROWS - 2);
      run.pos = pre.id; run.visited = [pre.id];
    } else { run.pos = null; run.visited = []; }
    S.modal = null; persistRun(); go('map');
  }),
  adminAddMon: adminOnly(fd => {
    S.run.godUsed = true;
    const name = String(fd.get('species') || '').trim().toLowerCase();
    const sp = Object.values(DEX).find(x => x.n.toLowerCase() === name);
    if (!sp) { toast('No Pokémon with that name'); return; }
    const mon = createMon(sp.id, Math.max(1, Math.min(100, +fd.get('level') || 50)));
    const where = storeCaught(S.run, mon);
    S.run.stats.caught--; // not a real catch
    toast(`${sp.n} added to your ${where === 'party' ? 'team' : 'Box'}`);
    persistRun(); render();
  }),
  adminAllShinies: adminOnly((_, el) => { S.profile.settings.allShinies = el.checked; persistProfile(); render(); }),
  adminAllStarters: adminOnly((_, el) => { S.profile.settings.allStarters = el.checked; persistProfile(); render(); }),
});

// ---------- Flows: move learning, evolution, messages (persisted in run.flow) ----------
export function queueFlow(steps, then = null) {
  const run = S.run;
  run.flow = [...(run.flow || []), ...steps];
  if (then) run.flowThen = then;
  persistRun();
  render();
  if (run.flow[0]?.type === 'evolve') sfx('evolve');
}

function findMon(uid) { return S.run.party.find(m => m.uid === uid) || S.run.box.find(m => m.uid === uid); }

function renderFlow() {
  const step = S.run.flow[0];
  const mon = step.uid ? findMon(step.uid) : null;
  let body = '';
  if (step.type === 'msg') {
    body = `<p class="big-text">${esc(step.text)}</p><button class="primary" data-act="flowNext">OK</button>`;
  } else if (step.type === 'learn' && mon) {
    body = `<h2>${esc(monName(mon))} wants to learn ${esc(MOVES[step.move].n)}</h2>
      <p class="muted">But ${esc(monName(mon))} already knows four moves. Choose a move to forget.</p>
      ${moveRow(step.move)}
      <div class="forget-grid">${mon.moves.map((x, i) => `<button data-act="forgetMove" data-arg="${i}">${esc(MOVES[x.id].n)}<small>${MOVES[x.id].t} · ${x.pp}/${MOVES[x.id].pp} PP</small></button>`).join('')}</div>
      <button class="ghost" data-act="skipLearn">Don't learn ${esc(MOVES[step.move].n)}</button>`;
  } else if (step.type === 'evolve' && mon) {
    const done = step.done;
    body = `<div class="center-text evolution ${done ? 'done' : ''}">
      <p class="big-text">${done ? `Congratulations! Your ${esc(DEX[step.from].n)} evolved into ${esc(DEX[mon.id].n)}!` : `What? ${esc(monName(mon))} is evolving!`}</p>
      <div class="evo-stage">${img(artUrl(done ? mon.id : mon.id), 'evo-from', '')}${done ? '' : img(artUrl(step.to), 'evo-to', '')}</div>
      ${done ? '<button class="primary" data-act="flowNext">Continue</button>'
        : `<div class="row gap center"><button data-act="cancelEvolve">Stop evolution</button><button class="primary" data-act="doEvolve">Evolve!</button></div>`}
    </div>`;
  } else {
    S.run.flow.shift();
    return S.run.flow.length ? renderFlow() : '';
  }
  return `<div class="modal-backdrop flow"><div class="modal panel" role="dialog" aria-modal="true">${body}</div></div>`;
}

function flowAdvance() {
  const run = S.run;
  run.flow.shift();
  if (!run.flow.length) {
    const then = run.flowThen;
    run.flowThen = null;
    persistRun();
    if (then) FLOW_THEN[then]?.();
    else render();
    return;
  }
  const s = run.flow[0];
  if (s.type === 'evolve') sfx('evolve');
  if (s.sfx) sfx(s.sfx);
  persistRun();
  render();
}

registerActions({
  flowNext: () => flowAdvance(),
  forgetMove: i => {
    const step = S.run.flow[0];
    const mon = findMon(step.uid);
    const old = MOVES[mon.moves[+i].id].n;
    replaceMove(mon, +i, step.move);
    S.run.flow.splice(1, 0, { type: 'msg', text: `1, 2, and… Poof! ${monName(mon)} forgot ${old} and learned ${MOVES[step.move].n}!` });
    sfx('learn');
    flowAdvance();
  },
  skipLearn: () => {
    const step = S.run.flow[0];
    const mon = findMon(step.uid);
    S.run.flow.splice(1, 0, { type: 'msg', text: `${monName(mon)} did not learn ${MOVES[step.move].n}.` });
    flowAdvance();
  },
  doEvolve: () => {
    const step = S.run.flow[0];
    const mon = findMon(step.uid);
    step.from = mon.id;
    const events = evolve(mon, step.to);
    step.done = true;
    track('evolve');
    addRunPoints(POINTS.evolve);
    playCry(step.to);
    sfx('levelup');
    const extra = [];
    for (const e of events) {
      if (e.type === 'learn') extra.push({ type: 'msg', text: `${monName(mon)} learned ${MOVES[e.move].n}!` });
      if (e.type === 'learnFull') extra.push({ type: 'learn', uid: mon.uid, move: e.move });
    }
    S.run.flow.splice(1, 0, ...extra);
    persistRun();
    render();
  },
  cancelEvolve: () => {
    const step = S.run.flow[0];
    const mon = findMon(step.uid);
    if (step.item) addItem(S.run, step.item); // item is not consumed when cancelled
    S.run.flow.splice(1, 0, { type: 'msg', text: `Huh? ${monName(mon)} stopped evolving!` });
    flowAdvance();
  },
});

// Continuations after a flow finishes (by name so they survive a reload)
const FLOW_THEN = {
  map: () => { S.run.node = null; persistRun(); go('map'); },
  league: () => go('league'),
  actDone: () => go('actDone'),
  hallOfFame: () => go('hallOfFame'),
  battle: () => resumeBattleUI(),
};

// ---------- After a battle ----------
export function finishBattle() {
  const run = S.run;
  const b = run.battle;
  const result = b.over;
  const steps = [];
  let then = 'map';
  // Winning with the last hit while your own team went down (recoil, poison) still counts as a blackout
  if (result !== 'lose' && !run.party.some(m => m.hp > 0)) b.over = 'lose';
  if (b.over === 'lose') {
    const who = b.trainer ? `${b.trainer.title} ${b.trainer.name}` : `${b.kind === 'legendary' ? 'Legendary' : 'wild'} ${DEX[b.enemy[b.ei].id].n}`;
    run.battle = null;
    endRun('Defeated', who).then(() => go('runOver', { who }));
    return;
  }
  if (result === 'win' || result === 'caught') run.stats.wins += result === 'win' ? 1 : 0;

  // Hell difficulty: Nuzlocke rules — fainted Pokémon are gone for good
  if (diffOf(run).permadeath) {
    const lost = run.party.filter(m => m.hp <= 0);
    if (lost.length) {
      run.party = run.party.filter(m => m.hp > 0);
      run.fallen = [...(run.fallen || []), ...partySummary(lost)];
      for (const m of lost) steps.push({ type: 'msg', text: `${monName(m)} fainted and is gone for good. Rest well, ${monName(m)}.` });
    }
  }

  // Points, missions and achievements
  if (result === 'win') { const pts = battleWon(b.kind, b.enemy); if (pts) steps.push({ type: 'msg', text: `+${pts.toLocaleString()} points!` }); }
  if (result === 'caught') {
    let pts = caughtEvents(b.caughtMon);
    if (b.kind === 'elite' || b.kind === 'legendary') pts += battleWon(b.kind, b.enemy);
    if (pts) steps.push({ type: 'msg', text: `+${pts.toLocaleString()} points!` });
  }
  if (run.money > (b.moneyStart ?? run.money)) track('money', run.money - b.moneyStart);
  for (const m of run.party) if (m.lv >= 100 && !m.l100) { m.l100 = true; track('level100'); }
  checkAchievements();

  if (result === 'caught') {
    const mon = b.caughtMon;
    const where = storeCaught(run, mon);
    const n0 = unlockedFor(mon.id);
    if (recordCatch(mon)) {
      const newNat = !n0.natures.includes(mon.nat), newAb = !n0.abilities.includes(mon.ab);
      if (mon.shiny && !n0.shiny) steps.push({ type: 'msg', text: `✨ Shiny ${DEX[familyRoot(mon.id)].n} unlocked as a starter option!` });
      if (newNat || newAb) steps.push({ type: 'msg', text: `Unlocked for the ${DEX[familyRoot(mon.id)].n} family: ${[newNat && NATURES[mon.nat] + ' nature', newAb && mon.ab + ' ability'].filter(Boolean).join(' and ')}.` });
    }
    if (where === 'box') steps.push({ type: 'msg', text: `${monName(mon)} was sent to the Box.` });
    if (!S.profile.caught.includes(mon.id)) {
      S.profile.caught.push(mon.id);
      steps.push({ type: 'msg', text: `${DEX[mon.id].n} joined your starter pool for future runs!` });
    }
    S.profile.stats.caught++;
    persistProfile();
  }

  // Level-up evolutions happen after battle, like the games
  for (const uid of b.leveled) {
    const mon = run.party.find(m => m.uid === uid);
    if (!mon || mon.hp <= 0) continue;
    const to = levelEvolution(mon, run.party);
    if (to) steps.push({ type: 'evolve', uid, to });
  }

  if (result === 'win' || result === 'caught') {
    if (b.kind === 'elite') {
      const [item, n] = eliteReward(run);
      steps.push({ type: 'msg', text: `The Elite Pokémon left behind ${n > 1 ? n + '× ' : 'a '}${item}!` });
    }
    if (b.kind === 'gym' && result === 'win') {
      run.badges.push({ name: b.trainer.badge, leader: b.trainer.leader, type: b.trainer.type });
      run.beatenGyms.push(b.trainer.leader);
      steps.push({ type: 'msg', text: `You received the ${b.trainer.badge} from ${b.trainer.leader}!` });
    }
    const isActBoss = run.map.nodes[run.pos]?.type === 'boss';
    if (isActBoss && (b.kind === 'gym' || b.kind === 'villainBoss')) {
      then = 'actDone';
      track('actClear');
      const pts = addRunPoints(POINTS.actClear);
      if (pts) steps.push({ type: 'msg', text: `Act cleared! +${pts.toLocaleString()} points!` });
    }
    if (b.kind === 'e4') { run.league.stage++; then = 'league'; }
    if (b.kind === 'champion') { run.league.stage++; then = 'hallOfFame'; }
  }
  run.battle = null;
  if (steps.length) queueFlow(steps, then);
  else { persistRun(); FLOW_THEN[then](); }
}

// ---------- Act transitions, League, Hall of Fame ----------
SCREENS.actDone = () => {
  playMusic('victory');
  const run = S.run;
  return `<section class="panel narrow center-text">
    <p class="eyebrow">Act ${run.act} complete</p>
    <h2>${esc(ACTS[run.act - 1].name)} cleared!</h2>
    <p>Your team rests at a Pokémon Center before the next leg of the journey.</p>
    <div class="team-strip big">${run.party.map(m => img(spriteUrl(m.id, { shiny: m.shiny }), 'mini-sprite', monName(m))).join('')}</div>
    <p class="muted">Next: ${esc(ACTS[run.act].name)}</p>
    <button class="primary big" data-act="nextAct">Set off</button>
  </section>`;
};
registerActions({
  nextAct: () => {
    const run = S.run;
    run.act++;
    run.map = generateMap(run.act);
    run.pos = null; run.visited = [];
    healParty(run);
    persistRun();
    go('map');
  },
});

SCREENS.league = () => {
  playMusic('boss');
  const run = S.run;
  const opp = leagueOpponent(run);
  const stage = run.league.stage;
  return `<section class="panel narrow center-text league">
    <p class="eyebrow">Pokémon League · ${stage < 4 ? `Elite Four ${stage + 1}/4` : 'Champion'}</p>
    ${img(trainerSpriteUrl(opp.info.sprite), 'trainer-art', opp.info.name)}
    <h2>${opp.title} ${esc(opp.info.name)}</h2>
    <p class="muted">${esc(opp.info.region)}${opp.info.type ? ' · ' + typeBadge(opp.info.type) : ''}</p>
    <p>${stage < 4 ? 'There is no healing between Elite Four battles. Use your items wisely.' : 'This is the final battle. Win, and your team enters the Hall of Fame!'}</p>
    <div class="party-list">${run.party.map((m, i) => monCard(m, i)).join('')}</div>
    <div class="row gap center"><button data-act="openBag">Bag</button><button data-act="openTeam">Team</button><button class="primary big" data-act="challengeLeague">Challenge!</button></div>
  </section>`;
};
registerActions({
  challengeLeague: () => {
    if (!S.run.party.some(m => m.hp > 0)) return;
    const spec = leagueOpponent(S.run).spec();
    launchBattle(spec);
  },
});

SCREENS.hallOfFame = () => {
  playMusic('hall');
  const run = S.run;
  return `<section class="panel center-text hof">
    <p class="eyebrow">Congratulations!</p>
    <h1>Hall of Fame</h1>
    <p>You defeated the Elite Four and Champion ${esc(run.league.champion.split('|')[0])}! Your team is now recorded in the Hall of Fame.</p>
    <div class="hof-team">${run.party.map(m => `<figure>${img(artUrl(m.id), '', monName(m))}<figcaption>${esc(monName(m))}<br><small>Lv ${m.lv}</small></figcaption></figure>`).join('')}</div>
    <button class="primary big" data-act="enterHall">Finish run</button>
  </section>`;
};
registerActions({
  enterHall: async () => {
    const run = S.run;
    addRunPoints(POINTS.hallOfFame);
    S.profile.hallOfFame.push({ date: new Date().toISOString(), champion: run.league.champion.split('|')[0], team: partySummary(run.party), starter: run.starter, score: run.score || 0, difficulty: run.difficulty, mode: modeOf(run) });
    S.profile.stats.champions++;
    if (!run.god) {
      if (modeOf(run) === 'classic') { S.profile.classicWins ||= []; if (!S.profile.classicWins.includes(runRegion(run))) S.profile.classicWins.push(runRegion(run)); }
      track('hallOfFame');
      track('hallOfFame:' + (run.difficulty || 'medium'));
      if (run.party.some(m => m.shiny)) track('hallOfFame:shiny');
    }
    persistProfile();
    await endRun('Champion');
    go('menu');
  },
});

SCREENS.runOver = () => {
  playMusic('menu');
  return `<section class="panel narrow center-text">
    <p class="eyebrow">Run over</p>
    <h2>You blacked out!</h2>
    <p>Your team was defeated by ${esc(S.ui.who || 'a strong opponent')}.</p>
    <p class="muted">Pokémon you caught on this run stay in your starter pool.</p>
    <div class="row gap center"><button data-act="openHistory">View history</button><button class="primary" data-act="play">Play again</button></div>
  </section>`;
};

/** Record a finished run in history and clear it. */
export async function endRun(result, defeatedBy = null) {
  const run = S.run;
  if (!run) return;
  cancelRunSave();
  const reached = run.league ? (run.league.stage >= 5 ? 'Hall of Fame' : run.league.stage === 4 ? 'Champion' : `Elite Four ${run.league.stage + 1}`) : `Act ${run.act}, floor ${run.pos ? run.map.nodes[run.pos].r + 1 : 0}`;
  const entry = {
    result, difficulty: run.difficulty || 'medium', mode: modeOf(run), god: !!run.godUsed, score: run.godUsed ? 0 : (run.score || 0), starter: run.starter, act: run.act, reached, badges: run.badges.length,
    caught: run.stats.caught, wins: run.stats.wins, team: partySummary(run.party),
    startedAt: run.startedAt, durationMin: Math.round((Date.now() - new Date(run.startedAt).getTime()) / 60000),
    ...(defeatedBy ? { defeatedBy } : {}),
  };
  S.run = null;
  S.history = null;
  try { await api.addHistory(entry); } catch { toast('Could not save this run to history.'); }
  S.scores = await api.scores().catch(() => S.scores);
}

export function resumeRun() {
  const run = S.run;
  if (!run) return go('menu');
  if (run.battle) { beginBattle([], true); return; }
  if (run.pos === 'boss' && !run.league) return go('actDone');
  if (run.league && run.map.nodes[run.pos]?.type === 'boss') {
    if (run.league.stage >= 5) return go('hallOfFame');
    return go('league');
  }
  if (run.node) return go('node');
  if (run.flow?.length) { go('map'); return; }
  go('map');
}

export { SCREENS, onBattleAction, renderBattle, finishBattle as _finishBattle };
