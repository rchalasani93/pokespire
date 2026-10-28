// Battle screen: plays engine events with HP animations and offers Fight / Bag / Pokémon / Run.
import { S } from './state.js';
import { DEX, MOVES, spriteUrl, typeEffect, TYPE_COLORS } from './data.js';
import { maxHp, monName, expForLevel } from './mechanics.js';
import { playerAction, forceSwitch, battleView, gimmickOptions } from './battle.js';
import { ITEMS, trainerSpriteUrl, Z_MOVES, MAX_MOVES, GIMMICK_NAMES } from './content.js';
import { typesOf, teraType } from './mechanics.js';
import { FORMS } from './data.js';
import { playMusic, sfx, playCry } from './audio.js';
import {
  go, render, registerActions, esc, hpBar, statusTag, typeBadge, persistRun, queueFlow, finishBattle, SCREENS, caughtMark, learnPrompt, rewardPrompt,
} from './ui.js';

const B = { queue: [], view: null, text: '', mode: 'main', playing: false, timer: null, item: null, fx: null, captured: false, gimmick: null };
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
  if (ev.shiny) B.fx = { ...(B.fx || {}), sparkle: true };
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
  if (!b) { render(); return; }
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
  if (!S.run.battle && S.run.postBattle) B.view = S.run.postBattle.view;
  settle();
}

// ---------- Rendering ----------
function battleScreen() {
  const run = S.run;
  const b = run.battle || S.lastBattle;
  if (!b) return '';
  const v = (!run.battle && run.postBattle?.view) || B.view || (run.battle ? battleView(run) : { p: null, e: null });
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
    ${b.trainer ? `<img class="trainer-sprite" src="${trainerSpriteUrl(b.trainer.sprite)}" alt="" onerror="this.remove()">` : ''}
    <div class="foe-col">
    <div class="hud foe">
      <div class="row"><strong>${esc(E?.name)}${E?.shiny ? ' <span class="shiny-mark" title="Shiny">✦</span>' : ''} ${E ? caughtMark(E.id, { real: true }) : ''}</strong><span>Lv ${E?.lv}</span></div>
      <div class="hud-types">${E ? (E.t || DEX[E.id].t).map(typeBadge).join('') : ''}${formTag(E)}</div>
      ${E ? hpBar(E.hp, E.max) : ''}
      <div class="row small status-line"><span>${statusTag(E?.st)}${b.enemy[b.ei]?.elite ? '<span class="elite-tag">ELITE</span>' : ''}</span>${enemyBalls}</div>
    </div>
    <div class="wallet-chip">$${run.money.toLocaleString()} · ${(run.score || 0).toLocaleString()} pts</div>
    ${run.god ? '<div class="god-chip">⚡ GOD</div>' : ''}
    </div>
    ${fieldChip(v)}
    <div class="sprite-wrap foe ${E?.dmax ? 'dmax' : ''} ${E?.tera ? 'tera' : ''} ${fx.hit === 'e' ? 'hit' : ''} ${fx.faint === 'e' || (E && E.hp <= 0) ? 'fainted' : ''} ${B.captured ? 'captured' : ''} ${fx.send === 'e' ? 'sendout' : ''} ${E?.shiny ? 'is-shiny' : ''} ${fx.sparkle ? 'sparkle' : ''}">
      ${E ? monSprite(E, false) : ''}
    </div>
    <div class="sprite-wrap player ${P?.dmax ? 'dmax' : ''} ${P?.tera ? 'tera' : ''} ${fx.hit === 'p' ? 'hit' : ''} ${fx.faint === 'p' || (P && P.hp <= 0) ? 'fainted' : ''} ${fx.send === 'p' ? 'sendout' : ''} ${P?.shiny ? 'is-shiny' : ''} ${fx.send === 'p' && P?.shiny ? 'sparkle' : ''}">
      ${P ? monSprite(P, true) : ''}
    </div>
    <div class="hud player">
      <div class="row"><strong>${esc(P?.name)}${P?.shiny ? ' ✦' : ''}</strong><span>Lv ${P?.lv}</span></div>
      <div class="hud-types">${P ? (P.t || DEX[P.id].t).map(typeBadge).join('') : ''}${formTag(P)}</div>
      ${P ? hpBar(P.hp, P.max) : ''}
      <div class="row small status-line"><span>${statusTag(P?.st)}</span><span>${P?.hp}/${P?.max}</span></div>
      <div class="expbar"><i style="width:${expPct}%"></i></div>
    </div>
  </div>`;
  const step = run.flow?.[0];
  const inline = step && ['msg', 'learn', 'reward'].includes(step.type) ? inlineFlow(step) : null;
  const text = inline ? inline.text : B.text;
  return `<section class="battle">
    ${scene}
    <div class="battle-bottom">
      <button class="textbox silent" data-act="advance" aria-live="polite">${esc(text)}${B.playing || inline?.more ? '<span class="more">▼</span>' : ''}</button>
      <div class="controls">${inline ? inline.controls : B.playing || !run.battle ? '' : controls()}</div>
    </div>
  </section>`;
}

/** Sprite for a battle view, using the Mega/Gigantamax form's sprite when it has one (falls back to the base sprite). */
function monSprite(v, back) {
  const ids = [...new Set([v.s, v.id].filter(Boolean))];
  const urls = [];
  for (const id of ids) {
    if (back) urls.push([spriteUrl(id, { back: true, shiny: v.shiny }), false]);
    urls.push([spriteUrl(id, { shiny: v.shiny }), back]);
  }
  const [first, ...rest] = urls;
  const chain = JSON.stringify(rest).replace(/"/g, '&quot;');
  return `<img src="${first[0]}" class="${first[1] ? 'flip' : ''}" alt="${esc(v.name)}" data-fallback="${chain}" onerror="nextSprite(this)">`;
}
window.nextSprite = img => {
  const list = JSON.parse(img.dataset.fallback || '[]');
  const next = list.shift();
  if (!next) { img.onerror = null; return; }
  img.dataset.fallback = JSON.stringify(list);
  img.classList.toggle('flip', !!next[1]);
  img.src = next[0];
};
const WEATHER_LABEL = { sun: '☀️ Harsh sunlight', rain: '🌧️ Rain', sand: '🌪️ Sandstorm', snow: '❄️ Snow' };
const TERRAIN_LABEL = { electric: '⚡ Electric Terrain', grassy: '🌿 Grassy Terrain', psychic: '🔮 Psychic Terrain', misty: '🌫️ Misty Terrain' };
function fieldChip(v) {
  const parts = [v.weather && WEATHER_LABEL[v.weather], v.terrain && TERRAIN_LABEL[v.terrain]].filter(Boolean);
  return parts.length ? `<div class="field-chip">${parts.join(' · ')}</div>` : '';
}
function formTag(v) {
  if (!v) return '';
  const tags = [];
  if (v.form) tags.push(`<span class="form-tag mega">${esc(v.form.startsWith('Primal') ? 'PRIMAL' : 'MEGA')}</span>`);
  if (v.dmax) tags.push(`<span class="form-tag dmax">${v.gmax ? 'G-MAX' : 'DYNAMAX'}</span>`);
  if (v.tera) tags.push(`<span class="form-tag tera" style="--tc:${TYPE_COLORS[v.tera]}">TERA ${esc(v.tera.toUpperCase())}</span>`);
  return tags.join('');
}

/** Post-battle messages and move-learning prompts, shown in the text box like the main games. */
function inlineFlow(step) {
  if (step.type === 'reward') return rewardPrompt(step);
  if (step.type === 'msg') {
    return { text: step.text, more: true, controls: '<div class="action-grid"><button class="primary" data-act="flowNext">Continue</button></div>' };
  }
  const mon = [...S.run.party, ...S.run.box].find(m => m.uid === step.uid);
  const mv = MOVES[step.move];
  if (!mon) return { text: '', controls: '<div class="action-grid"><button data-act="flowNext">Continue</button></div>' };
  return learnPrompt(step, mon);
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
      const gims = gimmickOptions(run);
      if (B.gimmick && !gims.includes(B.gimmick)) B.gimmick = null;
      const g = B.gimmick;
      const dmax = !!P.bf?.dmax || g === 'dmax';
      const zItem = ITEMS[P.item]?.kind === 'z' ? ITEMS[P.item] : null;
      const lock = !P.bf?.dmax && b.pv.lock;
      const vest = ITEMS[P.item]?.fx === 'assaultvest' && !P.bf?.dmax;
      const gimRow = gims.length ? `<div class="gimmick-row">${gims.map(x => {
        const label = x === 'dmax' && FORMS[P.id]?.gmax && P.gf ? 'Gigantamax' : x === 'tera' ? `Terastallize · ${teraType(P)}` : x === 'mega' ? 'Mega Evolve' : GIMMICK_NAMES[x];
        return `<button class="gimmick g-${x} ${g === x ? 'active' : ''}" data-act="bGimmick" data-arg="${x}" aria-pressed="${g === x}">${esc(label)}</button>`;
      }).join('')}</div>` : '';
      const foeTypes = typesOf(E);
      return `${gimRow}<div class="move-grid">${noPP ? `<button data-act="bMove" data-arg="-1">Struggle</button>` : P.moves.map((m, i) => {
        const base = MOVES[m.id];
        let mv = base, name = base.n, pow = base.c === 'S' ? 'Status' : `Pow ${base.p}`, off = m.pp <= 0;
        if (dmax) {
          if (base.c === 'S') { name = 'Max Guard'; pow = 'Protects'; }
          else {
            const gm = P.gf && FORMS[P.id]?.gmax?.mt === base.t ? FORMS[P.id].gmax.move : null;
            name = gm || MAX_MOVES[base.t]?.[0] || 'Max Strike'; pow = `Pow ${base.mx || base.p}`;
          }
        } else if (g === 'z') {
          if (base.t !== zItem?.type) off = true;
          else if (base.c === 'S') name = `Z-${base.n}`;
          else { name = Z_MOVES[base.t]; pow = `Pow ${base.z || base.p}`; }
        }
        if (lock && m.id !== lock) off = true;
        if (vest && base.c === 'S') off = true;
        const eff = base.c === 'S' ? null : typeEffect(base.t, foeTypes);
        const hint = eff == null ? '' : eff === 0 ? 'No effect' : eff > 1 ? 'Super effective' : eff < 1 ? 'Not very effective' : '';
        return `<button class="move ${name !== base.n ? 'transformed' : ''}" style="--tc:${TYPE_COLORS[mv.t]}" data-act="bMove" data-arg="${i}" ${off ? 'disabled' : ''} title="${esc(base.d || '')}">
          <strong>${esc(name)}</strong><span>${mv.t} · ${m.pp}/${mv.pp} PP</span><small>${pow} ${hint ? '· ' + hint : ''}</small></button>`;
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
  advance: () => {
    if (B.playing) playNext();
    else if (S.run?.flow?.[0]?.type === 'msg') document.querySelector('[data-act=flowNext]')?.click();
  },
  bMode: m => { B.mode = m; if (m !== 'fight') B.gimmick = null; render(); },
  bGimmick: g => { B.gimmick = B.gimmick === g ? null : g; render(); },
  bMove: i => { const gimmick = B.gimmick; B.gimmick = null; onBattleAction({ type: 'move', index: +i, gimmick }); },
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
