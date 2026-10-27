// Shared app state.
export const S = {
  user: null,
  profile: null,
  run: null,
  screen: 'loading',
  modal: null,        // { type, ... } overlay rendered above the screen
  history: null,      // cached history list
  ui: {},             // per-screen UI state (tabs, selections)
};

export function defaultProfile() {
  return {
    v: 1,
    settings: { master: 0.8, music: 0.5, sfx: 0.8, muted: false, textSpeed: 'normal' },
    caught: [],
    hallOfFame: [],
    dex: {},       // per evolution family: natures (n) and ability slots (a) caught
    stats: { runs: 0, champions: 0, caught: 0 },
  };
}

export function normalizeProfile(p) {
  const d = defaultProfile();
  if (!p || typeof p !== 'object') return d;
  return {
    ...d, ...p,
    settings: { ...d.settings, ...(p.settings || {}) },
    caught: Array.isArray(p.caught) ? p.caught : [],
    hallOfFame: Array.isArray(p.hallOfFame) ? p.hallOfFame : [],
    dex: p.dex && typeof p.dex === 'object' ? p.dex : {},
    stats: { ...d.stats, ...(p.stats || {}) },
  };
}
