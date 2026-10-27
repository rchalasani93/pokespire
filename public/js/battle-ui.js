// Battle screen: plays engine events with HP animations and offers Fight / Bag / Pokémon / Run.
import { S } from './state.js';
import { DEX, MOVES, spriteUrl, typeEffect, TYPE_COLORS } from './data.js';
import { maxHp, monName, expForLevel } from './mechanics.js';
import { playerAction, forceSwitch, battleView } from './battle.js';
import { ITEMS, trainerSpriteUrl } from './content.js';
import { playMusic, sfx, playCry } from './audio.js';
import {
  go, render, registerActions, esc, hpBar, statusTag, typeBadge, persistRun, queueFlow, finishBattle, SCREENS,
} from './ui.js';

const B = { queue: [], view: null, text: '', mode: 'main', playing: false, timer: null, item: null, fx: null, captured: false };
const DELAY = { slow: 1500, normal: 1000, fast: 550 };
const BOSS_KINDS = ['gym', 'villainBoss', 'e4', 'champion', 'legendary', 'elite'];

export function beginBattle(events, resume = false) {
  const run = S.run;
  B.queue = [...events];
  B.mode = 'main';
  B.view = battleView(run);
  B.text = '';
  B.captured = run.battle.over === 'caught';
  S.screen = 'battle';
  S.ui = {};
  playMusic(BOSS_KINDS.includes(run.battle.kind) ? 'boss' : 'battle');
  if (resume && !B.queue.length) { settle(); return; }
  playNext();
}

function playNext() {
  clearTimeout(B.timer);
  const ev = B.queue.shift();
  if (!ev) { settle(); return; }
  B.playing = true;
  B.view = ev.view;
  if (!ev.silent) B.text = ev.text;
  if (ev.caught) B.captured = true;
  B.fx = ev.hitSide ? { hit: ev.hitSide } : ev.faint ? { faint: ev.faint } : ev.send ? { send: ev.send } : null;
  if (ev.sfx === 'cry' || ev.send) playCry(ev.view[ev.send || 'e']?.id);
  else if (ev.sfx) sfx(ev.sfx);
  render();
  const speed = S.profile.settings.textSpeed || 'normal';
  B.timer = setTimeout(playNext, ev.silent ? 350 : ev.text === '...' ? 700 : DELAY[speed]);
}

function settle() {
  const run = S.run;
  const b = run.battle;
  B.playing = false;
  B.fx = null;
  if (!b) return;
  B.view = battleView(run);
  if (b.learnQueue.length) {
    const steps = b.learnQueue.map(x => ({ type: 'learn', uid: x.uid, move: x.move }));
    b.learnQueue = [];
    queueFlow(steps, 'battle');
    return;
  }
  if (b.over) {
    B.mode = 'over';
    if (b.over === 'win' || b.over === 'caught') playMusic('victory');
  } else if (b.phase === 'forceSwitch') {
    B.mode = 'forceSwitch';
    B.text = 'Choose a Pokémon to send out.';
  } else {
    B.mode = B.mode === 'forceSwitch' || B.mode === 'over' ? 'main' : B.mode;
    if (!['main', 'fight', 'bag', 'party', 'target'].includes(B.mode)) B.mode = 'main';
    B.mode = 'main';
    B.text = `What will ${monName(run.party[b.pi])} do?`;
  }
  render();
}

/** Called after an in-battle move-learning flow finishes. */
export function resumeBattleUI() {
  S.screen = 'battle';
  settle();
}

// ---------- Rendering ----------
function battleScreen() {
  const run = S.run;
  const b = run.battle;
  if (!b) return '';
  const v = B.view || battleView(run);
  const P = v.p, E = v.e;
  const pMon = run.party.find(m => m.uid === P?.uid);
  let expPct = 0;
  if (pMon) {
    const gr = DEX[pMon.id].gr, cur = expForLevel(gr, pMon.lv), next = expForLevel(gr, pMon.lv + 1);
    expPct = pMon.lv >= 100 ? 100 : Math.max(0, Math.min(100, ((pMon.exp - cur) / (next - cur)) * 100));
  }
  const fx = B.fx || {};
  const enemyBalls = b.trainer ? `<div class="team-balls">${b.enemy.map(m => `<i class="${m.hp > 0 ? '' : 'out'}"></i>`).join('')}</div>` : '';
  const scene = `<div class="scene kind-${b.kind}">
    <div class="wallet-chip">$${run.money.toLocaleString()}</div>
    ${run.god ? '<div class="god-chip">⚡ GOD</div>' : ''}
    ${b.trainer ? `<img class="trainer-sprite" src="${trainerSpriteUrl(b.trainer.sprite)}" alt="" onerror="this.remove()">` : ''}
    <div class="hud foe">
      <div class="row"><strong>${esc(E?.name)}${E?.shiny ? ' ✦' : ''}</strong><span>Lv ${E?.lv}</span></div>
      <div class="hud-types">${E ? DEX[E.id].t.map(typeBadge).join('') : ''}</div>
      ${E ? hpBar(E.hp, E.max) : ''}
      <div class="row small">${statusTag(E?.st)}${b.enemy[b.ei]?.elite ? '<span class="elite-tag">ELITE</span>' : ''}${enemyBalls}</div>
    </div>
    <div class="sprite-wrap foe ${fx.hit === 'e' ? 'hit' : ''} ${fx.faint === 'e' || (E && E.hp <= 0) ? 'fainted' : ''} ${B.captured ? 'captured' : ''} ${fx.send === 'e' ? 'sendout' : ''}">
      ${E ? `<img src="${spriteUrl(E.id, { shiny: E.shiny })}" alt="${esc(E.name)}">` : ''}
    </div>
    <div class="sprite-wrap player ${fx.hit === 'p' ? 'hit' : ''} ${fx.faint === 'p' || (P && P.hp <= 0) ? 'fainted' : ''} ${fx.send === 'p' ? 'sendout' : ''}">
      ${P ? `<img src="${spriteUrl(P.id, { back: true, shiny: P.shiny })}" alt="${esc(P.name)}" onerror="this.onerror=null;this.classList.add('flip');this.src='${spriteUrl(P.id, { shiny: P.shiny })}'">` : ''}
    </div>
    <div class="hud player">
      <div class="row"><strong>${esc(P?.name)}${P?.shiny ? ' ✦' : ''}</strong><span>Lv ${P?.lv}</span></div>
      <div class="hud-types">${P ? DEX[P.id].t.map(typeBadge).join('') : ''}</div>
      ${P ? hpBar(P.hp, P.max) : ''}
      <div class="row small"><span>${statusTag(P?.st)}</span><span>${P?.hp}/${P?.max}</span></div>
      <div class="expbar"><i style="width:${expPct}%"></i></div>
    </div>
  </div>`;
  return `<section class="battle">
    ${scene}
    <div class="battle-bottom">
      <button class="textbox silent" data-act="advance" aria-live="polite">${esc(B.text)}${B.playing ? '<span class="more">▼</span>' : ''}</button>
      <div class="controls">${B.playing ? '' : controls()}</div>
    </div>
  </section>`;
}

function controls() {
  const run = S.run, b = run.battle;
  const P = run.party[b.pi];
  const E = b.enemy[b.ei];
  switch (B.mode) {
    case 'main': return `<div class="action-grid">
      <button class="fight" data-act="bMode" data-arg="fight">Fight</button>
      <button class="bag" data-act="bMode" data-arg="bag">Bag</button>
      <button class="pkmn" data-act="bMode" data-arg="party">Pokémon</button>
      <button class="run" data-act="bRun" ${b.canRun ? '' : 'disabled'}>Run</button></div>`;
    case 'fight': {
      if (b.pv.recharge || b.pv.charging) return `<div class="action-grid"><button data-act="bMove" data-arg="0">Continue</button></div>`;
      const noPP = P.moves.every(m => m.pp <= 0);
      return `<div class="move-grid">${noPP ? `<button data-act="bMove" data-arg="-1">Struggle</button>` : P.moves.map((m, i) => {
        const mv = MOVES[m.id];
        const eff = mv.c === 'S' ? null : typeEffect(mv.t, DEX[E.id].t);
        const hint = eff == null ? '' : eff === 0 ? 'No effect' : eff > 1 ? 'Super effective' : eff < 1 ? 'Not very effective' : '';
        return `<button class="move" style="--tc:${TYPE_COLORS[mv.t]}" data-act="bMove" data-arg="${i}" ${m.pp <= 0 ? 'disabled' : ''} title="${esc(mv.d || '')}">
          <strong>${esc(mv.n)}</strong><span>${mv.t} · ${m.pp}/${mv.pp} PP</span><small>${mv.c === 'S' ? 'Status' : `Pow ${mv.p}`} ${hint ? '· ' + hint : ''}</small></button>`;
      }).join('')}</div><button class="ghost back-btn" data-act="bMode" data-arg="main">Back</button>`;
    }
    case 'bag': {
      const balls = b.canCatch ? Object.entries(run.bag).filter(([k, v]) => v > 0 && ITEMS[k]?.kind === 'ball') : [];
      const meds = Object.entries(run.bag).filter(([k, v]) => v > 0 && ['heal', 'revive', 'status', 'pp'].includes(ITEMS[k]?.kind));
      return `<div class="bag-battle">
        ${b.canCatch ? `<h4>Poké Balls</h4><div class="chip-row">${balls.length ? balls.map(([k, v]) => `<button data-act="bBall" data-arg="${esc(k)}">${esc(k)} ×${v}</button>`).join('') : '<span class="muted small">No Poké Balls left.</span>'}</div>` : '<p class="muted small">You can\'t catch another Trainer\'s Pokémon!</p>'}
        <h4>Medicine</h4>${b.noItems ? '<p class="muted small">No items in trainer battles on Hell difficulty.</p>' : `<div class="chip-row">${meds.length ? meds.map(([k, v]) => `<button data-act="bMed" data-arg="${esc(k)}" title="${esc(ITEMS[k].desc)}">${esc(k)} ×${v}</button>`).join('') : '<span class="muted small">No medicine.</span>'}</div>`}
      </div><button class="ghost back-btn" data-act="bMode" data-arg="main">Back</button>`;
    }
    case 'target':
      return `<p class="small">Use ${esc(B.item)} on which Pokémon?</p>${partyPicker('bUseOn', () => true)}<button class="ghost back-btn" data-act="bMode" data-arg="bag">Back</button>`;
    case 'party':
      return `${partyPicker('bSwitch', (m, i) => m.hp > 0 && i !== b.pi)}<button class="ghost back-btn" data-act="bMode" data-arg="main">Back</button>`;
    case 'forceSwitch':
      return partyPicker('bForce', m => m.hp > 0);
    case 'over':
      return `<div class="action-grid"><button class="primary" data-act="bFinish">Continue</button></div>`;
  }
  return '';
}

function partyPicker(act, allowed) {
  const run = S.run;
  return `<div class="party-pick">${run.party.map((m, i) => {
    const max = maxHp(m);
    return `<button data-act="${act}" data-arg="${i}" ${allowed(m, i) ? '' : 'disabled'} class="${m.hp <= 0 ? 'fainted' : ''}">
      <img src="${spriteUrl(m.id, { shiny: m.shiny })}" alt="">
      <span><strong>${esc(monName(m))}</strong> Lv ${m.lv} ${DEX[m.id].t.map(typeBadge).join('')}<br>${hpBar(m.hp, max)}<small>${m.hp}/${max} ${statusTag(m.st)}</small></span></button>`;
  }).join('')}</div>`;
}

// ---------- Actions ----------
export function onBattleAction(action) {
  const run = S.run;
  if (!run?.battle || B.playing) return;
  const events = playerAction(run, action);
  persistRun();
  B.queue = events;
  B.mode = 'main';
  playNext();
}

export function initBattleUI() {
  SCREENS.battle = battleScreen;
  registerActions({
  advance: () => { if (B.playing) playNext(); },
  bMode: m => { B.mode = m; render(); },
  bMove: i => onBattleAction({ type: 'move', index: +i }),
  bRun: () => onBattleAction({ type: 'run' }),
  bBall: name => onBattleAction({ type: 'ball', item: name }),
  bMed: name => { B.item = name; B.mode = 'target'; render(); },
  bUseOn: i => onBattleAction({ type: 'item', item: B.item, target: +i }),
  bSwitch: i => onBattleAction({ type: 'switch', index: +i }),
  bForce: i => {
    const run = S.run;
    const events = forceSwitch(run, +i);
    persistRun();
    B.queue = events;
    B.mode = 'main';
    playNext();
  },
  bFinish: () => finishBattle(),
  });
}

export function renderBattle() { render(); }
export { go };
