// Thin client for the PokeSpire API. Saves are debounced so rapid changes coalesce.

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const e = new Error(data?.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const api = {
  signup: (username, password) => request('POST', '/api/auth/signup', { username, password }),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/me'),
  history: () => request('GET', '/api/history'),
  addHistory: entry => request('POST', '/api/history', { entry }),
  deleteRun: () => request('DELETE', '/api/run'),
};

let statusEl = null;
export function setStatusElement(el) { statusEl = el; }
function status(text, cls = '') {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = 'save-status ' + cls;
}

const timers = {};
const latest = {};
function debounced(key, path, payload, delay) {
  latest[key] = payload;
  clearTimeout(timers[key]);
  status('Saving…');
  return new Promise(resolve => {
    timers[key] = setTimeout(async () => {
      try {
        await request('PUT', path, latest[key]);
        status('Saved', 'ok');
      } catch (e) {
        status(e.status === 401 ? 'Signed out — progress not saved' : 'Save failed — will retry', 'err');
        if (e.status !== 401) timers[key] = setTimeout(() => debounced(key, path, latest[key], 0), 5000);
      }
      resolve();
    }, delay);
  });
}

export const saveRun = (run, delay = 500) => debounced('run', '/api/run', { run }, delay);
export const saveProfile = (profile, delay = 300) => debounced('profile', '/api/profile', { profile }, delay);

/** Flush pending saves immediately (e.g. before leaving a screen that ends a run). */
export async function flushSaves() {
  const jobs = [];
  for (const key of Object.keys(timers)) {
    clearTimeout(timers[key]);
    if (latest[key]) jobs.push(request('PUT', key === 'run' ? '/api/run' : '/api/profile', latest[key]).catch(() => {}));
    delete latest[key];
  }
  await Promise.all(jobs);
}

export function cancelRunSave() {
  clearTimeout(timers.run);
  delete latest.run;
}
