import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, validateAccount, executeTrade, calculatePortfolio } from '../public/trading.js';

const now = Date.parse('2026-11-04T06:00:00Z');
const stock = { symbol: 'NVDA', name: 'NVIDIA', currency: 'USD' };
const jpStock = { symbol: '285A.T', name: 'キオクシア', currency: 'JPY' };
const order = (overrides = {}) => ({ stock, side: 'buy', quantity: 10, quote: { price: 100.25, currency: 'USD', asOf: new Date(now - 60_000).toISOString() }, fetchedAt: new Date(now).toISOString(), source: 'Yahoo Finance', ...overrides });

test('initial account keeps currencies separate and validates', () => {
  const account = createAccount(now);
  assert.deepEqual(account.cash, { JPY: 10_000_000, USD: 10_000 });
  assert.equal(validateAccount(account), true);
  assert.equal(calculatePortfolio(account).currencies.JPY.equity, 10_000_000);
  assert.equal(calculatePortfolio(account).currencies.USD.equity, 10_000);
});

test('buy is immutable and settles the correct currency; weighted average cost survives add-on buys', () => {
  const original = createAccount(now);
  const originalCopy = structuredClone(original);
  const first = executeTrade(original, order(), now);
  const second = executeTrade(first, order({ quantity: 5, quote: { ...order().quote, price: 200.5 } }), now);
  assert.deepEqual(original, originalCopy);
  assert.equal(first.cash.USD, 8997.5);
  assert.equal(first.cash.JPY, 10_000_000);
  assert.equal(second.positions[0].quantity, 15);
  assert.equal(second.positions[0].costBasis, 2005);
  assert.equal(second.positions[0].averageCost, 2005 / 15);
  assert.equal(validateAccount(second), true);
});

test('partial sales preserve basis and final sale realizes the entire remaining basis', () => {
  const bought = executeTrade(createAccount(now), order({ quantity: 3, quote: { ...order().quote, price: 10 / 3 } }), now);
  assert.equal(bought.positions[0].costBasis, 10);
  const partial = executeTrade(bought, order({ side: 'sell', quantity: 1, quote: { ...order().quote, price: 5 } }), now);
  assert.equal(partial.positions[0].costBasis, 6.67);
  assert.equal(partial.realizedPnL.USD, 1.67);
  const closed = executeTrade(partial, order({ side: 'sell', quantity: 2, quote: { ...order().quote, price: 4 } }), now);
  assert.equal(closed.positions.length, 0);
  assert.equal(closed.realizedPnL.USD, 3);
  assert.equal(closed.cash.USD, 10003);
  assert.equal(validateAccount(closed), true);
});

test('losses and one-share Japanese orders use independent funds', () => {
  const bought = executeTrade(createAccount(now), order({ stock: jpStock, quantity: 1, quote: { price: 1000.5, currency: 'JPY', asOf: order().quote.asOf } }), now);
  const sold = executeTrade(bought, order({ stock: jpStock, quantity: 1, side: 'sell', quote: { price: 900.25, currency: 'JPY', asOf: order().quote.asOf } }), now);
  assert.equal(sold.cash.JPY, 9999899.75);
  assert.equal(sold.cash.USD, 10000);
  assert.equal(sold.realizedPnL.JPY, -100.25);
});

test('overspending, overselling, fractional quantities, and mismatched currency are rejected without mutation', () => {
  const account = createAccount(now);
  for (const changes of [
    { quantity: 1000 },
    { side: 'sell', quantity: 1 },
    { quantity: 1.5 },
    { quantity: 0 },
    { quantity: NaN },
    { quantity: 1_000_001 },
    { side: 'short' },
    { quote: { ...order().quote, currency: 'JPY' } },
    { quote: { ...order().quote, price: Infinity } },
    { quote: { ...order().quote, price: -1 } },
  ]) assert.throws(() => executeTrade(account, order(changes), now));
  assert.deepEqual(account, createAccount(now));
});

test('fresh fetch is mandatory while a recent closed-market quote remains usable', () => {
  assert.throws(() => executeTrade(createAccount(now), order({ fetchedAt: new Date(now - 300_001).toISOString() }), now), /5分/);
  assert.throws(() => executeTrade(createAccount(now), order({ fetchedAt: new Date(now + 60_000).toISOString() }), now));
  assert.throws(() => executeTrade(createAccount(now), order({ quote: { ...order().quote, asOf: new Date(now - 8 * 86400000).toISOString() } }), now), /古い/);
  assert.throws(() => executeTrade(createAccount(now), order({ source: '' }), now));
  const weekendQuote = { ...order().quote, asOf: new Date(now - 4 * 86400000).toISOString() };
  assert.equal(executeTrade(createAccount(now), order({ quote: weekendQuote }), now).positions[0].quantity, 10);
});

test('portfolio omits values when a price is missing and values currencies separately', () => {
  let account = executeTrade(createAccount(now), order(), now);
  account = executeTrade(account, order({ stock: jpStock, quantity: 2, quote: { price: 1000, currency: 'JPY', asOf: order().quote.asOf } }), now);
  const partial = calculatePortfolio(account, { NVDA: { quote: { price: 110, currency: 'USD', asOf: order().quote.asOf } } });
  assert.equal(partial.complete, false);
  assert.equal(partial.currencies.JPY.equity, null);
  assert.equal(partial.currencies.JPY.marketValue, null);
  assert.equal(partial.currencies.JPY.costBasis, 2000);
  assert.equal(partial.currencies.USD.marketValue, 1100);
  assert.equal(partial.currencies.USD.unrealizedPnL, 97.5);
  assert.equal(partial.currencies.USD.equity, 10097.5);
  const full = calculatePortfolio(account, { NVDA: { price: 110, currency: 'USD' }, '285A.T': { price: 900, currency: 'JPY' } });
  assert.equal(full.complete, true);
  assert.equal(full.currencies.JPY.unrealizedPnL, -200);
  assert.equal(full.currencies.JPY.equity, 9999800);
});

test('corrupt persisted account shapes and inconsistent positions fail validation', () => {
  for (const value of [null, [], {}, { ...createAccount(now), version: 2 }, { ...createAccount(now), cash: { JPY: -1, USD: 0 } }, { ...createAccount(now), transactions: [null] }]) {
    assert.equal(validateAccount(value), false);
  }
  const account = executeTrade(createAccount(now), order(), now);
  account.positions[0].averageCost = 500;
  assert.equal(validateAccount(account), false);
});


test('fractional provider prices settle decimal half cents consistently without binary drift', () => {
  const bought = executeTrade(createAccount(now), order({ quantity: 1, quote: { ...order().quote, price: 10.075 } }), now);
  assert.equal(bought.transactions[0].total, 10.08);
  assert.equal(bought.cash.USD, 9989.92);
  const valuation = calculatePortfolio(bought, { NVDA: { price: 10.075, currency: 'USD' } });
  assert.equal(valuation.currencies.USD.marketValue, 10.08);
  const many = executeTrade(createAccount(now), order({ quantity: 100, quote: { ...order().quote, price: 0.10005 } }), now);
  assert.equal(many.transactions[0].total, 10.01);
});
