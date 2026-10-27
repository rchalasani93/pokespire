// Entry point: load data, restore the session, show the right screen.
import { loadData } from './data.js';
import { setStatusElement } from './api.js';
import { loadAccount, go } from './ui.js';
import { initBattleUI } from './battle-ui.js';

async function boot() {
  initBattleUI();
  setStatusElement(document.getElementById('save-status'));
  try {
    await loadData();
  } catch (e) {
    document.getElementById('app').innerHTML = `<section class="panel narrow"><h2>Couldn't load game data</h2><p>${e.message}</p><button onclick="location.reload()">Retry</button></section>`;
    return;
  }
  await loadAccount();
}

window.addEventListener('beforeunload', e => {
  const s = document.getElementById('save-status');
  if (s && s.textContent === 'Saving…') { e.preventDefault(); e.returnValue = ''; }
});

boot();
export { go };
