// Accounts and saves, backed by Supabase (Auth + Postgres with row-level security).
// Saves are debounced so rapid changes coalesce into one write.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

const cfg = window.POKESPIRE_CONFIG || {};
export const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes('YOUR-PROJECT'));
const sb = configured ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (error, fallback) => { if (error) throw new ApiError(friendly(error.message || fallback), error.status || 400); };
function friendly(msg) {
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email address first (check your inbox), then log in.';
  if (/already registered|already been registered/i.test(msg)) return 'An account with that email already exists.';
  if (/database error saving new user/i.test(msg)) return 'That username is taken.';
  if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  return msg;
}

async function currentUserId() {
  const { data } = await sb.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new ApiError('Sign in required', 401);
  return id;
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export const api = {
  async signup(username, email, password) {
    if (!USERNAME_RE.test(username)) throw new ApiError('Username must be 3–20 letters, numbers or underscores.');
    if (password.length < 8) throw new ApiError('Password must be at least 8 characters.');
    const { data: free, error: e1 } = await sb.rpc('username_available', { name: username });
    fail(e1);
    if (!free) throw new ApiError('That username is taken.', 409);
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { username }, emailRedirectTo: location.origin + location.pathname },
    });
    fail(error);
    // With "Confirm email" enabled in Supabase there is no session until the link is clicked
    return { needsConfirmation: !data.session };
  },

  async login(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    fail(error);
  },

  async logout() {
    await sb.auth.signOut();
  },

  async me() {
    const id = await currentUserId();
    const [p, r] = await Promise.all([
      sb.from('profiles').select('username, data, is_admin').eq('user_id', id).maybeSingle(),
      sb.from('runs').select('data').eq('user_id', id).maybeSingle(),
    ]);
    fail(p.error); fail(r.error);
    if (!p.data) throw new ApiError('Profile not found', 401);
    const profile = p.data.data && Object.keys(p.data.data).length ? p.data.data : null;
    return { user: { id, username: p.data.username, isAdmin: !!p.data.is_admin }, profile, run: r.data?.data || null };
  },

  async history() {
    const { data, error } = await sb.from('history').select('id, result, data, created_at')
      .order('id', { ascending: false }).limit(100);
    fail(error);
    return { history: data.map(r => ({ id: r.id, result: r.result, createdAt: r.created_at, ...r.data })) };
  },

  /** Ends the run on the server, which checks the score against its own record of the run. Returns the score kept. */
  async addHistory(entry) {
    const { data, error } = await sb.rpc('finish_run', { entry });
    if (!error) return data;
    // Before the server check is installed, fall back to a plain insert
    if (!/finish_run|PGRST202|function/i.test(error.message || '') && error.code !== 'PGRST202') fail(error);
    const id = await currentUserId();
    const score = Math.max(0, Math.min(1000000, Math.round(entry.score || 0)));
    const { error: e2 } = await sb.from('history').insert({ user_id: id, result: String(entry.result).slice(0, 40), data: entry, score });
    fail(e2);
    await api.deleteRun();
    return score;
  },

  async deleteRun() {
    const id = await currentUserId();
    const { error } = await sb.from('runs').delete().eq('user_id', id);
    fail(error);
  },
};

// ---------- Social: leaderboard, friends, points ----------
Object.assign(api, {
  async leaderboard(kind = 'best') {
    const { data, error } = await sb.rpc('leaderboard', { kind, lim: 50 });
    fail(error);
    return data;
  },
  async searchPlayers(q) {
    const { data, error } = await sb.rpc('search_players', { q });
    fail(error);
    return data;
  },
  async myFriends() {
    const { data, error } = await sb.rpc('my_friends');
    fail(error);
    return data;
  },
  async addFriend(friendId) {
    const id = await currentUserId();
    const { error } = await sb.from('friends').insert({ user_id: id, friend_id: friendId });
    if (error && !/duplicate/i.test(error.message)) fail(error);
  },
  async removeFriend(friendId) {
    const id = await currentUserId();
    const { error } = await sb.from('friends').delete().eq('user_id', id).eq('friend_id', friendId);
    fail(error);
  },
  async scores() {
    const id = await currentUserId();
    const { data, error } = await sb.from('profiles').select('best_score, total_score').eq('user_id', id).maybeSingle();
    fail(error);
    return data || { best_score: 0, total_score: 0 };
  },
});

// ---------- Who's online (Supabase Realtime presence) ----------
let presence = null;
export function joinPresence(user, onChange) {
  if (!sb || presence) return;
  const ch = sb.channel('online', { config: { presence: { key: user.id } } });
  presence = ch;
  const emit = () => { if (presence === ch) onChange(Object.keys(ch.presenceState())); };
  ch.on('presence', { event: 'sync' }, emit)
    .subscribe(async status => { if (status === 'SUBSCRIBED' && presence === ch) await ch.track({ username: user.username, at: Date.now() }); });
}
export async function leavePresence() {
  if (!presence) return;
  const ch = presence; presence = null;
  try { await ch.untrack(); await sb.removeChannel(ch); } catch { /* ignore */ }
}

async function putRun(run) {
  const id = await currentUserId();
  const { error } = await sb.from('runs').upsert({ user_id: id, data: run, updated_at: new Date().toISOString() });
  fail(error);
}
async function putProfile(profile) {
  const id = await currentUserId();
  const { error } = await sb.from('profiles').update({ data: profile, updated_at: new Date().toISOString() }).eq('user_id', id);
  fail(error);
}
const WRITERS = { run: putRun, profile: putProfile };

// ---------- Debounced saving with a status indicator ----------
let statusEl = null;
export function setStatusElement(el) { statusEl = el; }
function status(text, cls = '') {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = 'save-status ' + cls;
}

const timers = {};
const latest = {};
function debounced(key, payload, delay) {
  latest[key] = payload;
  clearTimeout(timers[key]);
  status('Saving…');
  timers[key] = setTimeout(async () => {
    const value = latest[key];
    if (value === undefined) return;
    try {
      await WRITERS[key](value);
      if (latest[key] === value) delete latest[key];
      status('Saved', 'ok');
    } catch (e) {
      status(e.status === 401 ? 'Signed out — progress not saved' : 'Save failed — will retry', 'err');
      if (e.status !== 401) timers[key] = setTimeout(() => debounced(key, latest[key], 0), 5000);
    }
  }, delay);
}

export const saveRun = (run, delay = 500) => debounced('run', run, delay);
export const saveProfile = (profile, delay = 300) => debounced('profile', profile, delay);

/** Write pending saves immediately (e.g. before logging out). */
export async function flushSaves() {
  const jobs = Object.keys(latest).map(key => {
    clearTimeout(timers[key]);
    const v = latest[key];
    delete latest[key];
    return WRITERS[key](v).catch(() => {});
  });
  await Promise.all(jobs);
}

export function cancelRunSave() {
  clearTimeout(timers.run);
  delete latest.run;
}
