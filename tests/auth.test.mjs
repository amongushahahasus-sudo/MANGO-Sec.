import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthRoutes, resolveIdentity } from '../src/auth.js';

const BACKEND = 'https://mango-sec-trading.azumaishow781.chatgpt.site';
const ORIGIN = 'https://amongushahahasus-sudo.github.io';
const APP_URL = ORIGIN + '/MANGO-Sec./';
const NOW = Date.parse('2026-11-04T10:00:00Z');
const verifier = 'A'.repeat(43);
const state = 'state_random_0123456789';
const digest = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('base64url');
const clock = value => ({ now: () => value });
function nativeHeaders(id = 'native-user-1') {
  return { 'oai-authenticated-user-id': id, 'oai-authenticated-user-email': id + '@example.com', 'oai-authenticated-user-full-name': encodeURIComponent('マンゴー利用者'), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' };
}
function req(path, { method = 'GET', body, headers = {} } = {}) {
  return new Request(BACKEND + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: ORIGIN }), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
class FakeD1 {
  codes = new Map();
  sessions = new Map();
  prepare(sql) {
    const database = this;
    return { bind(...args) { return {
      async run() {
        if (sql.startsWith('INSERT INTO mango_login_codes')) {
          const [code_hash, user_id, display_name, email, challenge, state, expires_at] = args;
          database.codes.set(code_hash, { code_hash, user_id, display_name, email, challenge, state, expires_at });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('INSERT INTO mango_sessions')) {
          const [token_hash, user_id, display_name, email, expires_at] = args;
          database.sessions.set(token_hash, { token_hash, user_id, display_name, email, expires_at });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('DELETE FROM mango_sessions WHERE token_hash = ?')) return { meta: { changes: Number(database.sessions.delete(args[0])) } };
        throw new Error('Unhandled SQL run: ' + sql);
      },
      async first() {
        if (sql.startsWith('DELETE FROM mango_login_codes')) {
          const row = database.codes.get(args[0]);
          if (!row || row.challenge !== args[1] || row.expires_at <= args[2]) return null;
          database.codes.delete(args[0]);
          return { user_id: row.user_id, display_name: row.display_name, email: row.email };
        }
        if (sql.startsWith('SELECT user_id, display_name, email, expires_at FROM mango_sessions')) {
          const row = database.sessions.get(args[0]);
          return row && row.expires_at > args[1] ? { ...row } : null;
        }
        throw new Error('Unhandled SQL first: ' + sql);
      },
    }; } };
  }
}
async function start(env, id = 'native-user-1', now = NOW) {
  const response = await handleAuthRoutes(req('/auth/start?challenge=' + await digest(verifier) + '&state=' + state, { headers: nativeHeaders(id) }), env, clock(now));
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get('Location'));
  assert.equal(target.origin + target.pathname, APP_URL);
  const hash = new URLSearchParams(target.hash.slice(1));
  assert.equal(hash.get('state'), state);
  return hash.get('auth_code');
}
async function exchange(env, code, value = verifier, now = NOW) {
  return handleAuthRoutes(req('/api/auth/exchange', { method: 'POST', body: { code, verifier: value } }), env, clock(now));
}

test('anonymous sign-in redirects only through native Sites SIWC and leaves reserved paths untouched', async () => {
  const path = '/auth/start?challenge=' + await digest(verifier) + '&state=' + state + '&return_to=https://evil.example';
  const response = await handleAuthRoutes(req(path), {});
  const signIn = new URL(response.headers.get('Location'), BACKEND);
  assert.equal(signIn.pathname, '/signin-with-chatgpt');
  assert.equal(signIn.searchParams.get('return_to'), path);
  for (const reserved of ['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback', '/api/account']) assert.equal(await handleAuthRoutes(req(reserved), {}), null);
  assert.equal((await handleAuthRoutes(req('/auth/start?challenge=bad&state=bad'), {})).status, 400);
  const signout = await handleAuthRoutes(req('/auth/signout?return_to=https://evil.example'), {});
  assert.equal(signout.headers.get('Location'), '/signout-with-chatgpt?return_to=%2Fauth%2Freturn');
  assert.equal((await handleAuthRoutes(req('/auth/return?return_to=https://evil.example'), {})).headers.get('Location'), APP_URL);
});

test('PKCE exchange returns native identity and stores only hashes; wrong verifier does not consume code', async () => {
  const env = { DB: new FakeD1() };
  const code = await start(env);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(env.DB.codes.has(code), false);
  assert.equal((await exchange(env, code, 'B'.repeat(43))).status, 401);
  assert.equal(env.DB.codes.size, 1);
  const response = await exchange(env, code);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const data = await response.json();
  assert.match(data.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(data.user.displayName, 'マンゴー利用者');
  assert.equal(data.user.email, 'native-user-1@example.com');
  assert.equal(data.expiresAt, new Date(NOW + 7 * 86400000).toISOString());
  assert.equal(env.DB.sessions.has(data.token), false);
  assert.equal(env.DB.codes.size, 0);
  const identity = await resolveIdentity(req('/api/account', { headers: { Authorization: 'Bearer ' + data.token, ...nativeHeaders('forged-other-native') } }), env, NOW);
  assert.equal(identity.userId, 'native-user-1');
});

test('one-time exchange is atomic under replay and concurrent attempts', async () => {
  const env = { DB: new FakeD1() };
  const code = await start(env);
  const responses = await Promise.all([exchange(env, code), exchange(env, code)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  assert.equal(env.DB.sessions.size, 1);
  assert.equal((await exchange(env, code)).status, 401);
});

test('sessions remain isolated for different users and logout revokes only its bearer token', async () => {
  const env = { DB: new FakeD1() };
  const first = await (await exchange(env, await start(env, 'user-one'))).json();
  const second = await (await exchange(env, await start(env, 'user-two'))).json();
  assert.equal((await resolveIdentity(req('/api/account', { headers: { Authorization: 'Bearer ' + first.token } }), env, NOW)).userId, 'user-one');
  assert.equal((await resolveIdentity(req('/api/account', { headers: { Authorization: 'Bearer ' + second.token } }), env, NOW)).userId, 'user-two');
  const response = await handleAuthRoutes(req('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + first.token, Origin: ORIGIN } }), env, clock(NOW));
  assert.equal(response.status, 200);
  assert.equal(await resolveIdentity(req('/api/account', { headers: { Authorization: 'Bearer ' + first.token } }), env, NOW), null);
  assert.equal((await resolveIdentity(req('/api/account', { headers: { Authorization: 'Bearer ' + second.token } }), env, NOW)).userId, 'user-two');
  const session = await handleAuthRoutes(req('/api/session', { headers: { Authorization: 'Bearer ' + second.token } }), env, clock(NOW));
  assert.deepEqual(await session.json(), { authenticated: true, user: { displayName: 'マンゴー利用者', email: 'user-two@example.com' } });
});

test('expired codes and sessions cannot be used, including exact expiry boundary', async () => {
  const env = { DB: new FakeD1() };
  const expiredCode = await start(env);
  assert.equal((await exchange(env, expiredCode, verifier, NOW + 300000)).status, 401);
  const validCode = await start(env);
  const data = await (await exchange(env, validCode)).json();
  assert.equal(await resolveIdentity(req('/api/account', { headers: { Authorization: 'Bearer ' + data.token } }), env, NOW + 7 * 86400000), null);
  assert.equal(await resolveIdentity(req('/api/account', { headers: { Authorization: 'Bearer malformed', ...nativeHeaders() } }), env, NOW), null);
});

test('mutation origins, methods, body sizes and configuration are checked before issuing tokens', async () => {
  const env = { DB: new FakeD1() };
  for (const origin of ['https://evil.example', 'null', 'https://amongushahahasus-sudo.github.io.evil.example']) {
    const response = await handleAuthRoutes(req('/api/auth/exchange', { method: 'POST', body: {}, headers: { Origin: origin } }), env);
    assert.equal(response.status, 403);
  }
  assert.equal((await handleAuthRoutes(req('/api/auth/logout', { method: 'POST' }), env)).status, 403);
  assert.equal((await handleAuthRoutes(req('/api/auth/exchange'), env)).status, 405);
  assert.equal((await handleAuthRoutes(req('/api/auth/exchange', { method: 'POST', body: ' '.repeat(16385) }), env)).status, 400);
  assert.equal((await handleAuthRoutes(req('/api/auth/exchange', { method: 'POST', body: [] }), env)).status, 400);
  assert.equal((await handleAuthRoutes(req('/api/auth/exchange', { method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } }), env)).status, 400);
  assert.equal((await handleAuthRoutes(req('/api/auth/exchange', { method: 'POST', body: {} }), {})).status, 503);
  assert.equal((await handleAuthRoutes(req('/auth/return'), { PUBLIC_APP_URL: 'https://evil.example' })).status, 503);
  assert.equal(env.DB.sessions.size, 0);
});

test('native identity decoding is bounded, optional and separate from anonymous access', async () => {
  const badName = { ...nativeHeaders(), 'oai-authenticated-user-full-name': '%E0%AA' };
  const identity = await resolveIdentity(req('/api/account', { headers: badName }), {}, NOW);
  assert.equal(identity.displayName, 'native-user-1@example.com');
  assert.equal(await resolveIdentity(req('/api/account'), {}, NOW), null);
  assert.equal(await resolveIdentity(req('/api/account', { headers: { 'oai-authenticated-user-id': 'x'.repeat(257) } }), {}, NOW), null);
  const anonymous = await handleAuthRoutes(req('/api/session'), {}, clock(NOW));
  assert.deepEqual(await anonymous.json(), { authenticated: false, user: null });
});
