// Pokédex, missions & achievements, leaderboard and friends screens.
import { S } from './state.js';
import { api } from './api.js';
import { DEX, MOVES, REGIONS, regionOf, familyRoot, bst, spriteUrl, artUrl } from './data.js';
import { natureLabel, STAT_SHORT } from './mechanics.js';
import { ACHIEVEMENTS, missionList, claimMission, POINT_RULES, DIFF_POINT_MULT } from './progress.js';
import {
  SCREENS, registerActions, go, render, esc, typeBadge, toast, persistProfile, pokedexCount, refreshMissionCount,
  filterBar, filterState, sortSpecies, abilityInfo, unlockedFor, evolutionChain, learnsetTable,
} from './ui.js';
import { sfx, playMusic } from './audio.js';

const img = (src, cls = '', alt = '') => `<img class="${cls}" src="${src}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">`;

export function initSocialUI() {
  // ---------- Pokédex ----------
  SCREENS.pokedex = () => {
    playMusic('menu');
    const region = S.ui.region ?? -1;
    const showAll = !!S.ui.showAll;
    const adminAll = S.user?.isAdmin && S.profile.settings.allStarters;
    const caught = new Set(adminAll ? Object.keys(DEX).map(Number) : S.profile.caught);
    const shinies = new Set(S.profile.shinies || []);
    const all = Object.keys(DEX).map(Number);
    const base = region === -1 ? all : all.filter(id => regionOf(id) === region);
    const f = filterState('dex');
    const ids = sortSpecies(showAll ? base : base.filter(id => caught.has(id)), { ...f, region: '' });
    const regionCount = i => all.filter(id => regionOf(id) === i && caught.has(id)).length;
    return `<section class="panel">
      <div class="row"><h2>Pokédex <small class="muted">${pokedexCount().toLocaleString()} / ${all.length.toLocaleString()} caught · ${shinies.size} shiny</small></h2><button data-act="back">Back</button></div>
      ${adminAll ? '<p class="notice">Admin unlock is on, so every species counts as available.</p>' : ''}
      <div class="tabs wrap"><button class="${region === -1 ? 'active' : ''}" data-act="dexRegion" data-arg="-1">All</button>${REGIONS.map((r, i) => `<button class="${i === region ? 'active' : ''}" data-act="dexRegion" data-arg="${i}">${r.name} <small>${regionCount(i)}/${all.filter(id => regionOf(id) === i).length}</small></button>`).join('')}</div>
      ${filterBar('dex', { species: true, region: false })}
      <label class="check"><input type="checkbox" class="silent" data-act="dexShowAll" ${showAll ? 'checked' : ''}> Show Pokémon I haven't caught yet</label>
      <div class="dex-grid">${ids.length ? ids.map(id => {
        const have = caught.has(id);
        return `<button class="dex-entry ${have ? '' : 'missing'}" data-act="dexEntry" data-arg="${id}" title="${have ? esc(DEX[id].n) : '???'}">
          <span class="dex-no">#${String(id).padStart(4, '0')}</span>
          ${img(spriteUrl(id, { shiny: shinies.has(id) }), 'dex-sprite', have ? DEX[id].n : '')}
          <strong>${have ? esc(DEX[id].n) : '???'}${shinies.has(id) ? ' <span class="shiny-mark">✦</span>' : ''}</strong>
        </button>`;
      }).join('') : `<p class="muted empty">${showAll ? 'No Pokémon match these filters.' : 'No caught Pokémon here yet. Tick "Show Pokémon I haven\'t caught yet" to browse them all.'}</p>`}</div>
    </section>`;
  };

  // ---------- Missions & achievements ----------
  SCREENS.missions = () => {
    playMusic('menu');
    const { daily, weekly } = missionList();
    const tab = S.ui.tab || 'missions';
    const unlocked = S.profile.achievements || {};
    const doneCount = ACHIEVEMENTS.filter(a => unlocked[a.id]).length;
    const row = (m, period) => `<div class="mission ${m.claimed ? 'claimed' : m.done ? 'done' : ''}">
      <div class="row"><strong>${esc(m.text)}</strong><span class="pts">+${m.pts.toLocaleString()} pts</span></div>
      <div class="progress"><i style="width:${(m.progress / m.target) * 100}%"></i></div>
      <div class="row small"><span>${m.progress.toLocaleString()} / ${m.target.toLocaleString()}</span>
        ${m.claimed ? '<span class="muted">Claimed ✓</span>' : m.done ? `<button class="primary small-btn" data-act="claimMission" data-arg="${period}|${m.id}">Claim</button>` : ''}</div>
    </div>`;
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const hrs = Math.ceil((midnight - now) / 3600000);
    const body = tab === 'missions' ? `
      <h3>Daily missions <small class="muted">reset in ${hrs}h</small></h3><div class="mission-list">${daily.map(m => row(m, 'daily')).join('')}</div>
      <h3>Weekly missions <small class="muted">reset Monday</small></h3><div class="mission-list">${weekly.map(m => row(m, 'weekly')).join('')}</div>
      <p class="muted small">Missions count progress from any run (God mode excluded). Claimed points go to your lifetime total on the leaderboard.</p>`
      : tab === 'achievements' ? `
      <p class="muted">${doneCount} / ${ACHIEVEMENTS.length} unlocked. Achievement points are added to your lifetime total automatically.</p>
      <div class="achievement-grid">${ACHIEVEMENTS.map(a => `<div class="achievement ${unlocked[a.id] ? 'got' : ''}">
        <span class="trophy">${unlocked[a.id] ? '🏆' : '🔒'}</span>
        <div><strong>${esc(a.name)}</strong><p class="small muted">${esc(a.desc)}</p><span class="pts">+${a.pts.toLocaleString()} pts</span>${unlocked[a.id] ? `<small class="muted"> · ${new Date(unlocked[a.id]).toLocaleDateString()}</small>` : ''}</div>
      </div>`).join('')}</div>`
      : pointsHelp();
    return `<section class="panel">
      <div class="row"><h2>Missions & Achievements</h2><button data-act="back">Back</button></div>
      <div class="tabs">
        <button class="${tab === 'missions' ? 'active' : ''}" data-act="missionsTab" data-arg="missions">Missions</button>
        <button class="${tab === 'achievements' ? 'active' : ''}" data-act="missionsTab" data-arg="achievements">Achievements</button>
        <button class="${tab === 'points' ? 'active' : ''}" data-act="missionsTab" data-arg="points">How points work</button>
      </div>
      ${body}
    </section>`;
  };

  // ---------- Leaderboard ----------
  SCREENS.leaderboard = () => {
    playMusic('menu');
    const kind = S.ui.kind || 'best';
    const friendsOnly = !!S.ui.friendsOnly;
    const friendIds = new Set((S.friends || []).filter(f => f.i_added).map(f => f.user_id));
    let rows = S.ui.rows || null;
    if (rows && friendsOnly) rows = rows.filter(r => friendIds.has(r.user_id) || r.user_id === S.user.id);
    const online = new Set(S.online || []);
    const table = S.ui.loading ? '<p class="muted">Loading…</p>' : S.ui.error ? `<p class="error">${esc(S.ui.error)}</p>` : rows?.length ? `
      <table class="board">
        <tr><th>#</th><th>Player</th><th>${kind === 'best' ? 'Best run' : 'Total points'}</th></tr>
        ${rows.map((r, i) => `<tr class="${r.user_id === S.user.id ? 'me' : ''}">
          <td>${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
          <td>${online.has(r.user_id) ? '<i class="dot" title="Online"></i>' : ''}${esc(r.username)}${friendIds.has(r.user_id) ? ' <span class="friend-tag">Friend</span>' : ''}${r.user_id === S.user.id ? ' <span class="friend-tag you">You</span>' : ''}</td>
          <td><b>${Number(kind === 'best' ? r.best_score : r.total_score).toLocaleString()}</b></td></tr>`).join('')}
      </table>` : '<p class="muted">No scores yet. Finish a run to get on the board!</p>';
    return `<section class="panel narrow wide">
      <div class="row"><h2>Leaderboard</h2><button data-act="back">Back</button></div>
      <div class="tabs">
        <button class="${kind === 'best' ? 'active' : ''}" data-act="boardKind" data-arg="best">Best run</button>
        <button class="${kind === 'total' ? 'active' : ''}" data-act="boardKind" data-arg="total">Total points</button>
      </div>
      <label class="check"><input type="checkbox" class="silent" data-act="boardFriends" ${friendsOnly ? 'checked' : ''}> Friends only</label>
      ${table}
      <p class="muted small">Best run = your highest single-run score. Total points = all run scores plus mission and achievement rewards. God mode runs score 0.</p>
    </section>`;
  };

  // ---------- Friends ----------
  SCREENS.friends = () => {
    playMusic('menu');
    const online = new Set(S.online || []);
    const friends = (S.friends || []);
    const mine = friends.filter(f => f.i_added);
    const addedMe = friends.filter(f => f.added_me && !f.i_added);
    const results = S.ui.results;
    const person = (p, action) => `<div class="person">
      <span class="status-dot ${online.has(p.user_id) ? 'on' : ''}" title="${online.has(p.user_id) ? 'Online' : 'Offline'}"></span>
      <div><strong>${esc(p.username)}</strong><small class="muted"> · Best ${Number(p.best_score || 0).toLocaleString()}${p.total_score != null ? ` · Total ${Number(p.total_score).toLocaleString()}` : ''}${online.has(p.user_id) ? ' · <span class="good-text">Online</span>' : ''}</small></div>
      ${action}
    </div>`;
    return `<section class="panel narrow wide">
      <div class="row"><h2>Friends</h2><button data-act="back">Back</button></div>
      <form data-form="searchFriends" class="friend-search">
        <input name="q" placeholder="Search players by username" minlength="2" value="${esc(S.ui.q || '')}" required aria-label="Search players by username">
        <button class="primary" type="submit">Search</button>
      </form>
      ${results ? `<div class="people">${results.length ? results.map(p => person(p, p.is_friend ? '<span class="muted small">Added ✓</span>' : `<button class="small-btn" data-act="addFriend" data-arg="${p.user_id}">Add friend</button>`)).join('') : '<p class="muted">No players found.</p>'}</div>` : ''}
      <h3>Your friends <small class="muted">${mine.length} · ${mine.filter(f => online.has(f.user_id)).length} online</small></h3>
      <div class="people">${mine.length ? mine.map(p => person(p, `<button class="small-btn ghost danger" data-act="removeFriend" data-arg="${p.user_id}">Remove</button>`)).join('') : '<p class="muted small">Search for a username above to add friends.</p>'}</div>
      ${addedMe.length ? `<h3>Added you</h3><div class="people">${addedMe.map(p => person(p, `<button class="small-btn" data-act="addFriend" data-arg="${p.user_id}">Add back</button>`)).join('')}</div>` : ''}
      <p class="muted small">${(S.online || []).length || 1} player${(S.online || []).length === 1 ? '' : 's'} online right now.</p>
    </section>`;
  };

  registerActions({
    openPokedex: () => go('pokedex', { region: -1 }),
    dexRegion: r => go('pokedex', { ...S.ui, region: +r }),
    dexShowAll: (_, el) => { S.ui.showAll = el.checked; render(); },
    dexEntry: id => { S.modal = { type: 'dexEntry', id: +id }; render(); },
    openMissions: () => go('missions', { tab: 'missions' }),
    missionsTab: tab => go('missions', { tab }),
    claimMission: async arg => {
      const [period, id] = arg.split('|');
      try {
        const pts = await claimMission(period, id);
        if (pts) { sfx('achievement'); toast(`+${pts.toLocaleString()} points claimed!`); }
        persistProfile();
        refreshMissionCount();
        S.scores = await api.scores().catch(() => S.scores);
      } catch (e) { toast('Could not claim: ' + e.message); }
      render();
    },
    openLeaderboard: () => loadBoard('best'),
    boardKind: kind => loadBoard(kind),
    boardFriends: (_, el) => { S.ui.friendsOnly = el.checked; render(); },
    openFriends: async () => {
      go('friends', {});
      await loadFriends();
      if (S.screen === 'friends') render();
    },
    searchFriends: async fd => {
      const q = String(fd.get('q') || '').trim();
      if (q.length < 2) return;
      try { S.ui = { ...S.ui, q, results: await api.searchPlayers(q) }; } catch (e) { toast(e.message); }
      render();
    },
    addFriend: async id => {
      try { await api.addFriend(id); toast('Friend added!'); } catch (e) { toast(e.message); }
      if (S.ui.results) S.ui.results = S.ui.results.map(r => r.user_id === id ? { ...r, is_friend: true } : r);
      await loadFriends(); render();
    },
    removeFriend: async id => {
      try { await api.removeFriend(id); } catch (e) { toast(e.message); }
      await loadFriends(); render();
    },
  });
}

async function loadFriends() {
  try { S.friends = await api.myFriends(); } catch { S.friends = S.friends || []; }
}

async function loadBoard(kind) {
  go('leaderboard', { kind, loading: true, friendsOnly: S.ui.friendsOnly });
  const [rows] = await Promise.all([api.leaderboard(kind).catch(e => ({ error: e.message })), loadFriends()]);
  if (S.screen !== 'leaderboard') return;
  S.ui = { ...S.ui, loading: false, rows: Array.isArray(rows) ? rows : [], error: rows?.error };
  render();
}

function pointsHelp() {
  return `<p class="muted">Every win and catch adds points to your run. Your best run goes on the leaderboard.</p>
    <table class="board">${POINT_RULES.map(([what, pts]) => `<tr><td>${esc(what)}</td><td><b>${esc(pts)}</b></td></tr>`).join('')}</table>
    <p class="muted small">Run points are multiplied by difficulty: Easy ×${DIFF_POINT_MULT.easy}, Medium ×${DIFF_POINT_MULT.medium}, Hard ×${DIFF_POINT_MULT.hard}, Hell ×${DIFF_POINT_MULT.hell}. Runs that use God mode score 0. Missions and achievements add bonus points to your lifetime total.</p>`;
}

/** Pokédex entry modal (rendered by ui.js's modal switch). */
export function dexEntryHtml(id) {
  const sp = DEX[id];
  const adminAll = S.user?.isAdmin && S.profile.settings.allStarters;
  const have = adminAll || S.profile.caught.includes(id);
  const shiny = (S.profile.shinies || []).includes(id);
  if (!have) {
    return `<div class="center-text"><div class="dex-no">#${String(id).padStart(4, '0')}</div>${img(artUrl(id), 'modal-art silhouette', '')}
      <h2>???</h2><p class="muted">You haven't caught this Pokémon yet. It's from ${REGIONS[regionOf(id)].name}.</p></div>
      <div class="row gap"><button class="primary" data-act="closeModal">Close</button></div>`;
  }
  const un = unlockedFor(id);
  return `<div class="dex-detail">
    <div class="center-text"><div class="dex-no">#${String(id).padStart(4, '0')} · ${REGIONS[regionOf(id)].name}</div>
      ${img(artUrl(id, shiny && S.ui.dexShiny), 'modal-art', sp.n)}
      <h2>${esc(sp.n)}${shiny ? ' <span class="shiny-mark">✦</span>' : ''}</h2><div>${sp.t.map(typeBadge).join('')}</div>
      ${shiny ? `<label class="check center"><input type="checkbox" class="silent" data-act="dexShinyToggle" ${S.ui.dexShiny ? 'checked' : ''}> Show shiny</label>` : ''}
    </div>
    <h4>Base stats <small class="muted">(total ${bst(id)})</small></h4>
    <table class="stats">${sp.b.map((v, i) => `<tr><th>${STAT_SHORT[i]}</th><td>${v}</td><td class="bar"><i style="width:${Math.min(100, v / 1.8)}%"></i></td></tr>`).join('')}</table>
    <h4>Abilities</h4>
    <div class="abilities-preview">${[...sp.a.map(a => abilityInfo(a, false)), sp.h ? abilityInfo(sp.h, true) : ''].join('')}</div>
    <h4>Unlocked for this family</h4>
    <p class="small">${un.natures.length ? `Natures: ${un.natures.map(n => esc(natureLabel(n))).join(', ')}` : 'No natures yet.'}<br>${un.abilities.length ? `Abilities: ${un.abilities.map(esc).join(', ')}` : ''}${un.shiny ? '<br><span class="shiny-mark">✦</span> Shiny starter unlocked' : ''}</p>
    <h4>Evolution</h4>
    ${evolutionChain(id)}
    <h4>Moveset <small class="muted">(level-up moves)</small></h4>
    ${learnsetTable(id)}
    <div class="row gap"><button class="primary" data-act="closeModal">Close</button></div>
  </div>`;
}
