import test from 'node:test';
import assert from 'node:assert/strict';
import { STOCKS, parseChart, getMarket, handleApi } from '../src/market.js';

const fixture = (meta = {}, closes = [100, null, 105]) => ({ chart: { result: [{ meta: { currency: 'JPY', regularMarketPrice: 105, regularMarketTime: 1730703600, chartPreviousClose: 100, ...meta }, timestamp: [1730696400, 1730700000, 1730703600], indicators: { quote: [{ close: closes, open: [99, 101, 103], high: [102, 104, 106], low: [98, 100, 102], volume: [100, 200, 300] }] } }], error: null } });
const respond = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('required Japanese and US stocks are available with currency and Google Finance links', () => {
  for (const symbol of ['285A.T', '9020.T', '7974.T', 'NVDA', 'QCOM', 'AAPL', 'MSFT']) {
    const stock = STOCKS.find(item => item.symbol === symbol);
    assert.ok(stock);
    assert.match(stock.googleFinanceUrl, /^https:\/\/www\.google\.com\/finance\/quote\//);
    assert.equal(stock.currency, symbol.endsWith('.T') ? 'JPY' : 'USD');
  }
});

test('chart skips null/invalid closes and retains actual provider timestamps', () => {
  const result = parseChart(fixture());
  assert.deepEqual(result.history.map(point => point.close), [100, 105]);
  assert.deepEqual(result.history.map(point => point.time), [1730696400, 1730703600]);
  assert.equal(result.history[1].volume, 300);
  assert.throws(() => parseChart({ chart: { error: { code: 'Not Found' } } }), /株価データ/);
});

test('long period chart uses a separate day quote for daily change', async () => {
  const calls = [];
  const fetcher = async url => { calls.push(url); return respond(fixture({ chartPreviousClose: url.includes('range=1d&') ? 100 : 50 })); };
  const result = await getMarket('285A.T', '1y', fetcher);
  assert.equal(result.quote.price, 105);
  assert.equal(result.quote.previousClose, 100);
  assert.equal(result.quote.change, 5);
  assert.equal(result.quote.changePercent, 5);
  assert.equal(result.quote.asOf, '2024-11-04T07:00:00.000Z');
  assert.equal(result.source, 'Yahoo Finance');
  assert.equal(calls.length, 2);
  assert.ok(calls.some(url => url.includes('range=1y&interval=1d')));
});

test('simultaneous identical requests deduplicate and cache valid actual data', async () => {
  let count = 0;
  const fetcher = async () => { count++; await new Promise(resolve => setTimeout(resolve, 5)); return respond(fixture()); };
  const [first, second] = await Promise.all([getMarket('285A.T', '1d', fetcher), getMarket('285A.T', '1d', fetcher)]);
  assert.equal(count, 1);
  assert.equal(first, second);
  assert.equal(await getMarket('285A.T', '1d', fetcher), first);
  assert.equal(count, 1);
});

test('upstream failure returns an error without invented prices and can recover', async () => {
  let fail = true;
  const fetcher = async () => fail ? new Response('', { status: 429 }) : respond(fixture());
  await assert.rejects(getMarket('285A.T', '1d', fetcher), /接続できません/);
  fail = false;
  assert.equal((await getMarket('285A.T', '1d', fetcher)).quote.price, 105);
});

test('invalid symbol and period are rejected before any remote request', async () => {
  const fetcher = () => { throw new Error('must not fetch'); };
  await assert.rejects(getMarket('https://example.com', '1d', fetcher), /対応していない銘柄/);
  await assert.rejects(getMarket('AAPL', '__proto__', fetcher), /期間/);
  const response = await handleApi(new Request('http://localhost/api/market?symbol=bad'), fetcher);
  assert.equal(response.status, 400);
  assert.ok((await response.json()).error);
});

test('missing previous close is unknown; mismatched currency and absent quote fail', async () => {
  const unknown = await getMarket('285A.T', '1d', async () => respond(fixture({ chartPreviousClose: null })));
  assert.equal(unknown.quote.change, null);
  assert.equal(unknown.quote.changePercent, null);
  await assert.rejects(getMarket('AAPL', '1d', async () => respond(fixture())), /通貨/);
  await assert.rejects(getMarket('285A.T', '1d', async () => respond(fixture({ regularMarketPrice: null, regularMarketTime: null }, [null, null, null]))), /有効な株価/);
});

test('API limits methods and routes, responds safely on provider errors', async () => {
  assert.equal((await handleApi(new Request('http://localhost/api/stocks', { method: 'POST' }))).status, 405);
  assert.equal((await handleApi(new Request('http://localhost/api/unknown'))).status, 404);
  const stocks = await handleApi(new Request('http://localhost/api/stocks'));
  assert.equal(stocks.status, 200);
  assert.equal((await stocks.json()).length, STOCKS.length);
  const response = await handleApi(new Request('http://localhost/api/market'), async () => { throw new Error('secret internal error'); });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('secret'));
});


test('day open, high, and low use actual metadata with intraday fallback', async () => {
  const result = await getMarket('285A.T', '1d', async () => respond(fixture({ regularMarketOpen: 98, regularMarketDayHigh: 110, regularMarketDayLow: 95 })));
  assert.equal(result.quote.open, 98);
  assert.equal(result.quote.dayHigh, 110);
  assert.equal(result.quote.dayLow, 95);
  const fallback = await getMarket('285A.T', '1d', async () => respond(fixture()));
  assert.equal(fallback.quote.open, 99);
  assert.equal(fallback.quote.dayHigh, 106);
  assert.equal(fallback.quote.dayLow, 98);
  const noHistory = await getMarket('285A.T', '1d', async () => respond(fixture({}, [null, null, null])));
  assert.equal(noHistory.quote.open, null);
  assert.equal(noHistory.quote.dayHigh, null);
  assert.equal(noHistory.quote.dayLow, null);
});
