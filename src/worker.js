// PokeSpire API — Cloudflare Worker + D1.
// Static files in /public are served by the assets binding; only /api/* reaches this code.

const SESSION_COOKIE = 'ps_session';
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000; // Workers' WebCrypto maximum
const MAX_BLOB = 400_000;

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return hex(bits);
}
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const err = (message, status = 400) => json({ error: message }, status);

function cookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function sessionCookie(req, token, maxAge) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function createSession(env, req, userId) {
  const token = randomHex(32);
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, expires).run();
  return sessionCookie(req, token, SESSION_DAYS * 86400);
}

async function currentUser(env, req) {
  const token = cookie(req, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
  ).bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, username: row.username };
}

async function readJson(req) {
  const text = await req.text();
  if (text.length > MAX_BLOB) throw Object.assign(new Error('Payload too large'), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

const routes = {
  'POST /api/auth/signup': async (req, env) => {
    const { username, password } = await readJson(req);
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) return err('Username must be 3–20 letters, numbers or underscores.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) return err('Password must be at least 8 characters.');
    const exists = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
    if (exists) return err('That username is taken.', 409);
    const id = crypto.randomUUID();
    const salt = randomHex(16);
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO users (id, username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, username, await hashPassword(password, salt), salt, now).run();
    return json({ user: { id, username } }, 201, { 'set-cookie': await createSession(env, req, id) });
  },

  'POST /api/auth/login': async (req, env) => {
    const { username, password } = await readJson(req);
    if (typeof username !== 'string' || typeof password !== 'string') return err('Enter a username and password.');
    const row = await env.DB.prepare('SELECT id, username, pass_hash, salt FROM users WHERE username = ?').bind(username).first();
    // Hash even when the user doesn't exist so timing doesn't reveal valid usernames.
    const hash = await hashPassword(password, row?.salt || '00'.repeat(16));
    if (!row || !timingSafeEqual(hash, row.pass_hash)) return err('Wrong username or password.', 401);
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(row.id, Date.now()).run();
    return json({ user: { id: row.id, username: row.username } }, 200, { 'set-cookie': await createSession(env, req, row.id) });
  },

  'POST /api/auth/logout': async (req, env) => {
    const token = cookie(req, SESSION_COOKIE);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(req, '', 0) });
  },

  'GET /api/me': async (req, env, user) => {
    const [profile, run] = await Promise.all([
      env.DB.prepare('SELECT data FROM profiles WHERE user_id = ?').bind(user.id).first(),
      env.DB.prepare('SELECT data FROM runs WHERE user_id = ?').bind(user.id).first(),
    ]);
    return json({ user, profile: profile ? JSON.parse(profile.data) : null, run: run ? JSON.parse(run.data) : null });
  },

  'PUT /api/profile': async (req, env, user) => {
    const { profile } = await readJson(req);
    if (!profile || typeof profile !== 'object' || !Array.isArray(profile.caught)) return err('Invalid profile.');
    await env.DB.prepare(
      'INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
    ).bind(user.id, JSON.stringify(profile), new Date().toISOString()).run();
    return json({ ok: true });
  },

  'PUT /api/run': async (req, env, user) => {
    const { run } = await readJson(req);
    if (!run || typeof run !== 'object' || !Array.isArray(run.party)) return err('Invalid run.');
    await env.DB.prepare(
      'INSERT INTO runs (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
    ).bind(user.id, JSON.stringify(run), new Date().toISOString()).run();
    return json({ ok: true });
  },

  'DELETE /api/run': async (req, env, user) => {
    await env.DB.prepare('DELETE FROM runs WHERE user_id = ?').bind(user.id).run();
    return json({ ok: true });
  },

  'GET /api/history': async (req, env, user) => {
    const { results } = await env.DB.prepare(
      'SELECT id, result, data, created_at FROM history WHERE user_id = ? ORDER BY id DESC LIMIT 100'
    ).bind(user.id).all();
    return json({ history: results.map(r => ({ id: r.id, result: r.result, createdAt: r.created_at, ...JSON.parse(r.data) })) });
  },

  'POST /api/history': async (req, env, user) => {
    const { entry } = await readJson(req);
    if (!entry || typeof entry !== 'object' || typeof entry.result !== 'string') return err('Invalid entry.');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO history (user_id, result, data, created_at) VALUES (?, ?, ?, ?)')
        .bind(user.id, entry.result.slice(0, 40), JSON.stringify(entry), new Date().toISOString()),
      env.DB.prepare('DELETE FROM runs WHERE user_id = ?').bind(user.id),
    ]);
    return json({ ok: true }, 201);
  },
};

const PUBLIC = new Set(['POST /api/auth/signup', 'POST /api/auth/login', 'POST /api/auth/logout']);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);

    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) return err('Not found', 404);

    // CSRF: state-changing requests must come from this origin as JSON.
    if (req.method !== 'GET') {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) return err('Bad origin', 403);
      if (req.method !== 'DELETE' && !(req.headers.get('content-type') || '').includes('application/json')) return err('Expected JSON', 415);
    }

    try {
      let user = null;
      if (!PUBLIC.has(key)) {
        user = await currentUser(env, req);
        if (!user) return err('Sign in required', 401);
      }
      return await handler(req, env, user);
    } catch (e) {
      return err(e.status ? e.message : 'Server error', e.status || 500);
    }
  },
};
