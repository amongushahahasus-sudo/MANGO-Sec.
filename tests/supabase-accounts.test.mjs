import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/mango-sec-api/service.js';

const NOW = Date.parse('2026-11-04T08:00:00Z');
const URL_BASE = 'https://wqczekzebhukjayyhuln.supabase.co';
const ORIGIN = 'https://amongushahahasus-sudo.github.io';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = '10000000-0000-4000-8000-000000000001';
const CONFIG = { supabaseUrl: URL_BASE, publicKey: 'public-test-key', serviceRoleKey: 'server-only-test-key' };
const order = changes => ({ symbol: 'NVDA', side: 'buy', quantity: 2, expectedVersion: 0, requestId: REQUEST_ID, ...changes });
const market = async symbol => ({ quote: { price: 100.25, currency: symbol.endsWith('.T') ? 'JPY' : 'USD', asOf: new Date(NOW - 60_000).toISOString() }, fetchedAt: new Date(NOW).toISOString(), source: 'Yahoo Finance' });

function request(path = '/api/account', { method = 'GET', body, token = 'alice-token', origin = ORIGIN, headers = {} } = {}) {
  return new Request(`${URL_BASE}/functions/v1/mango-sec-api${path}`, {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

/** Emulates only Auth's verified-user endpoint and PostgREST's scoped CAS contract. */
class Provider {
  rows = new Map();
  calls = [];
  authStatus = 200;
  authUser = null;
  storageStatus = 200;
  beforePatch = null;
  fetch = async (input, options = {}) => {
    const url = new URL(input);
    const headers = new Headers(options.headers);
    const method = options.method || 'GET';
    this.calls.push({ url, method, headers, options });
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert.equal(headers.get('Cache-Control'), 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/auth/v1/user') {
      assert.equal(headers.get('apikey'), CONFIG.publicKey);
      assert.notEqual(headers.get('apikey'), CONFIG.serviceRoleKey);
      if (this.authStatus !== 200) return json({ error: 'provider-private-error' }, this.authStatus);
      const token = headers.get('Authorization');
      if (!['Bearer alice-token', 'Bearer bob-token'].includes(token)) return json({ error: 'invalid jwt' }, 401);
      const id = token === 'Bearer alice-token' ? ALICE : BOB;
      return json(this.authUser || { id, email: `${id === ALICE ? 'alice' : 'bob'}@example.test`, email_confirmed_at: new Date(NOW).toISOString(), is_anonymous: false, user_metadata: { full_name: id === ALICE ? 'Alice' : 'Bob', user_id: BOB, role: 'service_role' } });
    }
    assert.equal(url.pathname, '/rest/v1/mango_sec_accounts');
    assert.equal(headers.get('apikey'), CONFIG.serviceRoleKey);
    assert.equal(headers.get('Authorization'), `Bearer ${CONFIG.serviceRoleKey}`);
    if (this.storageStatus !== 200) return json({ secret: CONFIG.serviceRoleKey }, this.storageStatus);
    if (url.searchParams.get('limit') === '0') {
      assert.equal(url.searchParams.get('select'), 'user_id');
      assert.equal(method, 'GET');
      return json([]);
    }
    const scoped = url.searchParams.get('user_id');
    assert.match(scoped, /^eq\.[a-f0-9-]{36}$/);
    const id = scoped.slice(3);
    assert.ok([ALICE, BOB].includes(id));
    if (method === 'GET') return json(this.rows.has(id) ? [structuredClone(this.rows.get(id))] : []);
    const body = JSON.parse(options.body);
    if (method === 'POST') {
      assert.equal(body.user_id, id);
      assert.equal(url.searchParams.get('on_conflict'), 'user_id');
      assert.equal(headers.get('Prefer'), 'resolution=ignore-duplicates,return=representation');
      if (this.rows.has(id)) return json([]);
      this.rows.set(id, structuredClone(body));
      return json([body], 201);
    }
    assert.equal(method, 'PATCH');
    assert.equal(body.user_id, undefined);
    assert.equal(headers.get('Prefer'), 'return=representation');
    if (this.beforePatch) await this.beforePatch(id, body);
    const row = this.rows.get(id);
    const version = url.searchParams.get('version');
    assert.match(version, /^eq\.\d+$/);
    if (!row || `eq.${row.version}` !== version) return json([]);
    assert.equal(body.version, row.version + 1);
    const next = { ...row, ...structuredClone(body) };
    this.rows.set(id, next);
    return json([next]);
  };
}
function app(provider = new Provider(), extra = {}) {
  return { provider, handle: createHandler(CONFIG, { fetcher: provider.fetch, now: () => NOW, getMarket: market, ...extra }) };
}

test('verified identities own separate accounts and service access stays UUID scoped', async () => {
  const { handle, provider } = app();
  const bought = await handle(request('/api/trades', { method: 'POST', body: order() }));
  const saved = await bought.json();
  assert.equal(bought.status, 200);
  assert.equal(saved.user.id, `supabase:wqczekzebhukjayyhuln:${ALICE}`);
  assert.equal(saved.user.displayName, 'Alice');
  assert.equal(saved.account.cash.USD, 9799.5);
  assert.equal(saved.account.transactions[0].price, 100.25);
  assert.equal(saved.account.transactions[0].id, REQUEST_ID);
  assert.equal(saved.version, 1);
  const bob = await (await handle(request('/api/account', { token: 'bob-token' }))).json();
  assert.equal(bob.account.cash.USD, 10000);
  assert.equal(bob.account.transactions.length, 0);
  assert.equal(provider.rows.size, 2);
  assert.ok(!JSON.stringify(saved).includes(CONFIG.serviceRoleKey));
  assert.equal(bought.headers.get('Cache-Control'), 'no-store');
  assert.equal(bought.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(provider.calls.filter(call => call.url.pathname === '/auth/v1/user').length, 2);
});

test('forged JWTs, anonymous/unconfirmed identities and spoofed account JSON fail closed', async () => {
  const { handle, provider } = app();
  assert.equal((await handle(request('/api/account', { token: null }))).status, 401);
  const forged = Buffer.from(JSON.stringify({ sub: ALICE, role: 'service_role' })).toString('base64url');
  assert.equal((await handle(request('/api/account', { token: `header.${forged}.fake` }))).status, 401);
  assert.equal(provider.rows.size, 0);
  provider.authUser = { id: ALICE, email: 'alice@example.test', email_confirmed_at: new Date(NOW).toISOString(), is_anonymous: true };
  assert.equal((await handle(request())).status, 401);
  provider.authUser = { id: ALICE, email: 'alice@example.test' };
  assert.equal((await handle(request())).status, 401);
  provider.authUser = null;
  for (const extra of [{ price: 0.01 }, { userId: BOB }, { state: {} }, { balance: 100000000 }]) {
    assert.equal((await handle(request('/api/trades', { method: 'POST', body: order(extra) }))).status, 400);
  }
  assert.equal(provider.rows.get(ALICE).version, 0);
});

test('authorization provider failures preserve a distinct safe 503 response', async () => {
  const { handle, provider } = app();
  provider.authStatus = 503;
  const response = await handle(request());
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.ok(!text.includes('provider-private-error'));
  assert.ok(!text.includes(CONFIG.serviceRoleKey));
  assert.equal(provider.rows.size, 0);
  for (const failedFetch of [
    async () => new Response('truncated-provider-data', { status: 200 }),
    async () => { throw new Error('upstream-private-network-error'); },
    async () => ({ ok: true, status: 200, json: async () => { throw new DOMException('Timed out', 'AbortError'); } }),
  ]) {
    const failed = createHandler(CONFIG, { fetcher: failedFetch, now: () => NOW });
    const result = await failed(request());
    assert.equal(result.status, 503);
    const body = await result.text();
    assert.ok(!body.includes('truncated-provider-data'));
    assert.ok(!body.includes('upstream-private-network-error'));
  }
});

test('trade retries are idempotent before version checks and reject reused ids', async () => {
  let marketCalls = 0;
  const { handle } = app(undefined, { getMarket: async symbol => { marketCalls++; return market(symbol); } });
  assert.equal((await handle(request('/api/trades', { method: 'POST', body: order() }))).status, 200);
  const retry = await handle(request('/api/trades', { method: 'POST', body: order() }));
  const saved = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(saved.version, 1);
  assert.equal(saved.account.transactions.length, 1);
  assert.equal(marketCalls, 1);
  const reused = await handle(request('/api/trades', { method: 'POST', body: order({ quantity: 3 }) }));
  assert.equal(reused.status, 409);
  assert.equal((await reused.json()).code, 'REQUEST_ID_REUSED');
});

test('concurrent identical orders apply once and return the committed account', async () => {
  const { handle, provider } = app();
  await handle(request());
  const replies = await Promise.all([handle(request('/api/trades', { method: 'POST', body: order() })), handle(request('/api/trades', { method: 'POST', body: order() }))]);
  assert.deepEqual(replies.map(reply => reply.status), [200, 200]);
  for (const reply of replies) assert.equal((await reply.json()).account.transactions.length, 1);
  assert.equal(provider.rows.get(ALICE).version, 1);
});

test('optimistic updates detect races and stale versions without overwriting state', async () => {
  const { handle, provider } = app();
  await handle(request());
  provider.beforePatch = async id => { const row = provider.rows.get(id); provider.rows.set(id, { ...row, version: row.version + 1 }); provider.beforePatch = null; };
  const raced = await handle(request('/api/trades', { method: 'POST', body: order() }));
  assert.equal(raced.status, 409);
  assert.equal((await raced.json()).code, 'VERSION_CONFLICT');
  assert.equal(provider.rows.get(ALICE).state_json.transactions.length, 0);
  assert.equal((await handle(request('/api/watchlist', { method: 'PATCH', body: { expectedVersion: 0, symbols: ['NVDA'] } }))).status, 409);
});

test('watchlists and reset increment versions while reset preserves the watchlist', async () => {
  const { handle } = app();
  const watched = await handle(request('/api/watchlist', { method: 'PATCH', body: { expectedVersion: 0, symbols: ['NVDA', 'AAPL', 'NVDA'] } }));
  assert.equal(watched.status, 200);
  assert.deepEqual((await watched.json()).watchlist, ['NVDA', 'AAPL']);
  assert.equal((await handle(request('/api/trades', { method: 'POST', body: order({ expectedVersion: 1 }) }))).status, 200);
  const reset = await (await handle(request('/api/account/reset', { method: 'POST', body: { expectedVersion: 2 } }))).json();
  assert.equal(reset.version, 3);
  assert.deepEqual(reset.watchlist, ['NVDA', 'AAPL']);
  assert.equal(reset.account.cash.USD, 10000);
  assert.deepEqual(reset.account.transactions, []);
});

test('CORS, payload limits, unsupported fields and public health enforce the boundary', async () => {
  const { handle, provider } = app();
  const forbidden = await handle(request('/api/account', { origin: 'https://evil.example' }));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.has('Access-Control-Allow-Origin'), false);
  assert.equal(provider.calls.length, 0);
  const preflight = await handle(request('/api/trades', { method: 'OPTIONS', token: null, headers: { 'Access-Control-Request-Headers': 'authorization,apikey,x-client-info,content-type' } }));
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /apikey/);
  assert.equal((await handle(request('/api/trades', { method: 'POST', origin: null, body: order() }))).status, 403);
  assert.equal((await handle(request('/api/trades', { method: 'POST', body: JSON.stringify({ huge: 'x'.repeat(17000) }) }))).status, 413);
  const health = await handle(request('/health', { token: null, origin: null }));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', version: 'supabase-accounts-v1', databaseReady: true });
  provider.storageStatus = 500;
  const down = await handle(request('/health', { token: null }));
  assert.equal(down.status, 503);
  assert.ok(!(await down.text()).includes(CONFIG.serviceRoleKey));
  const missing = createHandler({}, { fetcher: provider.fetch });
  assert.equal((await missing(request('/health', { token: null }))).status, 503);
});

test('public stock catalog requires no login and HEAD never returns a body', async () => {
  const { handle, provider } = app();
  const stocks = await handle(request('/api/stocks', { token: null }));
  assert.equal(stocks.status, 200);
  assert.ok((await stocks.json()).some(stock => stock.symbol === '285A.T'));
  assert.equal(stocks.headers.get('Cache-Control'), 'no-store');
  assert.equal(provider.calls.length, 0);
  const head = await handle(request('/api/account', { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});
