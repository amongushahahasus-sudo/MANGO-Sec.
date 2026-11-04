import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAccountApi } from '../src/accounts.js';

const now = Date.parse('2026-11-04T08:00:00Z');
const alice = { userId: 'alice-user', displayName: 'Alice', email: 'alice@example.test' };
const bob = { userId: 'bob-user', displayName: 'Bob', email: 'bob@example.test' };
const orderIds = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
const order = (overrides = {}) => ({ symbol: 'NVDA', side: 'buy', quantity: 2, expectedVersion: 0, requestId: orderIds[0], ...overrides });
const request = (path = '/api/account', method = 'GET', body) => new Request('https://api.example.test' + path, {
  method,
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});
const market = async symbol => ({
  quote: { price: 100.25, currency: symbol.endsWith('.T') ? 'JPY' : 'USD', asOf: new Date(now - 60_000).toISOString() },
  fetchedAt: new Date(now).toISOString(),
  source: 'Yahoo Finance',
});
const dependencies = { now: () => now, getMarket: market };

/** In-memory D1 contract: bound statements, conditional updates and row snapshots. */
class MemoryD1 {
  rows = new Map();
  prepare(sql) {
    const db = this;
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() {
        assert.match(sql, /^SELECT .+ FROM mango_accounts WHERE user_id = \?$/);
        const row = db.rows.get(this.values[0]);
        return row ? structuredClone(row) : null;
      },
      async run() {
        const values = this.values;
        if (sql.startsWith('INSERT OR IGNORE INTO mango_accounts')) {
          const [userId, state, createdAt, updatedAt] = values;
          if (db.rows.has(userId)) return { meta: { changes: 0 } };
          db.rows.set(userId, { user_id: userId, state_json: state, version: 0, watchlist_json: '[]', created_at: createdAt, updated_at: updatedAt });
          return { meta: { changes: 1 } };
        }
        assert.match(sql, /^UPDATE mango_accounts SET (state_json|watchlist_json) = \?, version = version \+ 1, updated_at = \? WHERE user_id = \? AND version = \?$/);
        const [value, updatedAt, userId, version] = values;
        const row = db.rows.get(userId);
        if (!row || row.version !== version) return { meta: { changes: 0 } };
        const column = sql.includes('SET state_json') ? 'state_json' : 'watchlist_json';
        db.rows.set(userId, { ...row, [column]: value, updated_at: updatedAt, version: version + 1 });
        return { meta: { changes: 1 } };
      },
    };
  }
}

test('account reads require a verified identity and a provisioned database', async () => {
  const unauthenticated = await handleAccountApi(request(), { DB: new MemoryD1() }, null, dependencies);
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).code, 'AUTH_REQUIRED');
  const missingDatabase = await handleAccountApi(request(), {}, alice, dependencies);
  assert.equal(missingDatabase.status, 503);
  const db = new MemoryD1();
  const response = await handleAccountApi(request(), { DB: db }, alice, dependencies);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.version, 0);
  assert.deepEqual(body.account.cash, { JPY: 10_000_000, USD: 10_000 });
  assert.deepEqual(body.user, { id: 'alice-user', displayName: 'Alice', email: 'alice@example.test' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(db.rows.size, 1);
});

test('balances and histories belong to the authenticated user and prices come from the server', async () => {
  const db = new MemoryD1();
  const calls = [];
  const deps = { ...dependencies, getMarket: async (...args) => { calls.push(args); return market(args[0]); } };
  const bought = await handleAccountApi(request('/api/trades', 'POST', order()), { DB: db }, alice, deps);
  const saved = await bought.json();
  assert.equal(bought.status, 200);
  assert.equal(saved.version, 1);
  assert.equal(saved.account.cash.USD, 9799.5);
  assert.equal(saved.account.cash.JPY, 10_000_000);
  assert.equal(saved.account.transactions[0].price, 100.25);
  assert.equal(saved.account.transactions[0].id, orderIds[0]);
  assert.deepEqual(calls, [['NVDA', '1d']]);
  const otherUser = await handleAccountApi(request(), { DB: db }, bob, deps);
  const other = await otherUser.json();
  assert.equal(other.version, 0);
  assert.equal(other.account.cash.USD, 10_000);
  assert.equal(other.account.transactions.length, 0);
  assert.equal(other.account.positions.length, 0);
  assert.equal(db.rows.size, 2);
  for (const forged of [{ user_id: bob.userId }, { price: 0.01 }, { account: { cash: { USD: 1e9 } } }]) {
    const response = await handleAccountApi(request('/api/trades', 'POST', order({ ...forged, expectedVersion: 1, requestId: orderIds[1] })), { DB: db }, alice, deps);
    assert.equal(response.status, 400);
  }
  assert.equal(JSON.parse(db.rows.get(bob.userId).state_json).cash.USD, 10_000);
  assert.equal(JSON.parse(db.rows.get(alice.userId).state_json).transactions.length, 1);
});

test('trade retries are idempotent while reusing an order ID for different details is rejected', async () => {
  const db = new MemoryD1();
  let fetched = 0;
  const deps = { ...dependencies, getMarket: async symbol => { fetched++; return market(symbol); } };
  const first = await handleAccountApi(request('/api/trades', 'POST', order()), { DB: db }, alice, deps);
  assert.equal(first.status, 200);
  const retry = await handleAccountApi(request('/api/trades', 'POST', order()), { DB: db }, alice, deps);
  const body = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(body.version, 1);
  assert.equal(body.account.transactions.length, 1);
  assert.equal(fetched, 1);
  const reused = await handleAccountApi(request('/api/trades', 'POST', order({ quantity: 3 })), { DB: db }, alice, deps);
  assert.equal(reused.status, 409);
  assert.equal((await reused.json()).code, 'REQUEST_ID_REUSED');
});

test('simultaneous distinct orders cannot overwrite each other or spend the same account version', async () => {
  const db = new MemoryD1();
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let fetches = 0;
  const deps = { ...dependencies, getMarket: async symbol => { if (++fetches === 2) release(); await barrier; return market(symbol); } };
  const responses = await Promise.all(orderIds.map(requestId => handleAccountApi(request('/api/trades', 'POST', order({ requestId })), { DB: db }, alice, deps)));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const row = db.rows.get(alice.userId);
  assert.equal(row.version, 1);
  const account = JSON.parse(row.state_json);
  assert.equal(account.transactions.length, 1);
  assert.equal(account.cash.USD, 9799.5);
});

test('concurrent retries with the same order ID complete once and both return the saved result', async () => {
  const db = new MemoryD1();
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let fetches = 0;
  const deps = { ...dependencies, getMarket: async symbol => { if (++fetches === 2) release(); await barrier; return market(symbol); } };
  const responses = await Promise.all([1, 2].map(() => handleAccountApi(request('/api/trades', 'POST', order()), { DB: db }, alice, deps)));
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(db.rows.get(alice.userId).version, 1);
  assert.equal(JSON.parse(db.rows.get(alice.userId).state_json).transactions.length, 1);
});

test('watchlists and confirmed resets are versioned, isolated, and preserve saved watchlist entries', async () => {
  const db = new MemoryD1();
  const env = { DB: db };
  const watch = await handleAccountApi(request('/api/watchlist', 'PATCH', { symbols: ['NVDA', 'AAPL', 'NVDA'], expectedVersion: 0 }), env, alice, dependencies);
  const watched = await watch.json();
  assert.equal(watch.status, 200);
  assert.deepEqual(watched.watchlist, ['NVDA', 'AAPL']);
  assert.equal(watched.version, 1);
  const trade = await handleAccountApi(request('/api/trades', 'POST', order({ expectedVersion: 1 })), env, alice, dependencies);
  assert.equal(trade.status, 200);
  const reset = await handleAccountApi(request('/api/account/reset', 'POST', { expectedVersion: 2 }), env, alice, dependencies);
  const resetBody = await reset.json();
  assert.equal(reset.status, 200);
  assert.equal(resetBody.version, 3);
  assert.deepEqual(resetBody.watchlist, ['NVDA', 'AAPL']);
  assert.equal(resetBody.account.transactions.length, 0);
  assert.equal(resetBody.account.cash.USD, 10_000);
  const staleReset = await handleAccountApi(request('/api/account/reset', 'POST', { expectedVersion: 2 }), env, alice, dependencies);
  assert.equal(staleReset.status, 409);
  const invalidWatch = await handleAccountApi(request('/api/watchlist', 'PATCH', { symbols: ['INVALID'], expectedVersion: 3 }), env, alice, dependencies);
  assert.equal(invalidWatch.status, 400);
  const other = await handleAccountApi(request(), env, bob, dependencies);
  assert.deepEqual((await other.json()).watchlist, []);
});

test('invalid requests and unavailable market data do not execute trades or expose internal errors', async () => {
  const db = new MemoryD1();
  const env = { DB: db };
  for (const overrides of [{ quantity: 1.5 }, { quantity: 0 }, { symbol: 'http://example.test' }, { side: 'short' }, { expectedVersion: -1 }, { requestId: 'not-a-uuid' }]) {
    const result = await handleAccountApi(request('/api/trades', 'POST', order(overrides)), env, alice, dependencies);
    assert.equal(result.status, 400);
  }
  const unavailable = await handleAccountApi(request('/api/trades', 'POST', order()), env, alice, { ...dependencies, getMarket: async () => { throw new Error('private provider response'); } });
  assert.equal(unavailable.status, 502);
  assert.ok(!(await unavailable.text()).includes('private provider response'));
  assert.equal(db.rows.get(alice.userId).version, 0);
  assert.equal(JSON.parse(db.rows.get(alice.userId).state_json).transactions.length, 0);
  const expensive = await handleAccountApi(request('/api/trades', 'POST', order({ quantity: 1_000_000 })), env, alice, dependencies);
  assert.equal(expensive.status, 400);
  assert.equal(db.rows.get(alice.userId).version, 0);
});

test('JSON payloads are bounded and route methods are restricted', async () => {
  const env = { DB: new MemoryD1() };
  const plain = new Request('https://api.example.test/api/trades', { method: 'POST', body: '{}' });
  assert.equal((await handleAccountApi(plain, env, alice, dependencies)).status, 415);
  const malformed = new Request('https://api.example.test/api/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await handleAccountApi(malformed, env, alice, dependencies)).status, 400);
  const oversized = request('/api/trades', 'POST', { extra: 'a'.repeat(17_000) });
  assert.equal((await handleAccountApi(oversized, env, alice, dependencies)).status, 413);
  assert.equal((await handleAccountApi(request('/api/account', 'POST', {}), env, alice, dependencies)).status, 405);
  assert.equal((await handleAccountApi(request('/api/missing'), env, alice, dependencies)).status, 404);
});

test('corrupt stored accounts and database faults fail safely without replacing saved data', async () => {
  const db = new MemoryD1();
  await handleAccountApi(request(), { DB: db }, alice, dependencies);
  db.rows.get(alice.userId).state_json = '{broken';
  const corrupted = await handleAccountApi(request(), { DB: db }, alice, dependencies);
  assert.equal(corrupted.status, 500);
  assert.equal((await corrupted.json()).code, 'ACCOUNT_DATA_INVALID');
  assert.equal(db.rows.get(alice.userId).state_json, '{broken');
  const unavailableDb = { prepare() { throw new Error('private SQL failure'); } };
  const unavailable = await handleAccountApi(request(), { DB: unavailableDb }, alice, dependencies);
  assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes('private SQL failure'));
});
