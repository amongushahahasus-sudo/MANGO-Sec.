export const STOCKS = Object.freeze([
  { symbol: '285A.T', name: 'キオクシアホールディングス', shortName: 'キオクシア', market: 'JP', currency: 'JPY', googleFinanceUrl: 'https://www.google.com/finance/quote/285A:TYO', color: '#b21f36', initials: 'K' },
  { symbol: '9020.T', name: '東日本旅客鉄道', shortName: 'JR東日本', market: 'JP', currency: 'JPY', googleFinanceUrl: 'https://www.google.com/finance/quote/9020:TYO', color: '#00874f', initials: 'JR' },
  { symbol: '7974.T', name: '任天堂', shortName: '任天堂', market: 'JP', currency: 'JPY', googleFinanceUrl: 'https://www.google.com/finance/quote/7974:TYO', color: '#e60012', initials: 'N' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', shortName: 'NVIDIA', market: 'US', currency: 'USD', googleFinanceUrl: 'https://www.google.com/finance/quote/NVDA:NASDAQ', color: '#76b900', initials: 'N' },
  { symbol: 'QCOM', name: 'QUALCOMM Incorporated', shortName: 'Qualcomm', market: 'US', currency: 'USD', googleFinanceUrl: 'https://www.google.com/finance/quote/QCOM:NASDAQ', color: '#3253dc', initials: 'Q' },
  { symbol: 'AAPL', name: 'Apple Inc.', shortName: 'Apple', market: 'US', currency: 'USD', googleFinanceUrl: 'https://www.google.com/finance/quote/AAPL:NASDAQ', color: '#434955', initials: 'A' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', shortName: 'Microsoft', market: 'US', currency: 'USD', googleFinanceUrl: 'https://www.google.com/finance/quote/MSFT:NASDAQ', color: '#00a4ef', initials: 'M' },
  { symbol: '7203.T', name: 'トヨタ自動車', shortName: 'トヨタ自動車', market: 'JP', currency: 'JPY', googleFinanceUrl: 'https://www.google.com/finance/quote/7203:TYO', color: '#cc1426', initials: 'T' },
  { symbol: '6758.T', name: 'ソニーグループ', shortName: 'ソニー', market: 'JP', currency: 'JPY', googleFinanceUrl: 'https://www.google.com/finance/quote/6758:TYO', color: '#282a36', initials: 'S' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', shortName: 'Amazon', market: 'US', currency: 'USD', googleFinanceUrl: 'https://www.google.com/finance/quote/AMZN:NASDAQ', color: '#ef940a', initials: 'a' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', shortName: 'Alphabet', market: 'US', currency: 'USD', googleFinanceUrl: 'https://www.google.com/finance/quote/GOOGL:NASDAQ', color: '#4285f4', initials: 'G' },
]);

const RANGES = Object.freeze({ '1d': '5m', '5d': '30m', '1mo': '1d', '3mo': '1d', '6mo': '1d', '1y': '1d', '5y': '1wk' });
const PROVIDERS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const CACHE_TTL = 60_000;
const fetcherCaches = new WeakMap();

export class MarketError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'MarketError'; this.status = status; }
}
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const numberOrNull = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

export function parseChart(data) {
  const chart = data?.chart;
  if (chart?.error || !chart?.result?.[0]) throw new MarketError('株価データを取得できませんでした。時間をおいて再取得してください。');
  const result = chart.result[0];
  const values = result.indicators?.quote?.[0];
  const history = (result.timestamp || []).flatMap((time, index) => {
    const close = values?.close?.[index];
    if (!Number.isFinite(time) || !positive(close)) return [];
    return [{ time, close, open: numberOrNull(values?.open?.[index]), high: numberOrNull(values?.high?.[index]), low: numberOrNull(values?.low?.[index]), volume: numberOrNull(values?.volume?.[index]) }];
  }).sort((a, b) => a.time - b.time);
  return { meta: result.meta || {}, history };
}

async function fetchChart(symbol, range, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    for (const host of PROVIDERS) {
      try {
        const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
        url.search = new URLSearchParams({ range, interval: RANGES[range], includePrePost: 'false', events: 'splits' }).toString();
        const response = await fetcher(url.href, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 MANGO-Sec/1.0' } });
        if (!response.ok) continue;
        return parseChart(await response.json());
      } catch (error) {
        if (controller.signal.aborted) break;
        if (error instanceof MarketError) throw error;
      }
    }
    throw new MarketError('株価の提供元に接続できません。しばらくしてから「更新」を押してください。');
  } finally { clearTimeout(timeout); }
}

async function loadMarket(stock, range, fetcher) {
  const [chart, daily] = range === '1d'
    ? await fetchChart(stock.symbol, '1d', fetcher).then(value => [value, value])
    : await Promise.all([fetchChart(stock.symbol, range, fetcher), fetchChart(stock.symbol, '1d', fetcher)]);
  const meta = daily.meta;
  if (meta.currency && meta.currency !== stock.currency) throw new MarketError('銘柄の通貨を確認できませんでした。');
  const last = daily.history.at(-1);
  const price = positive(meta.regularMarketPrice) ? meta.regularMarketPrice : last?.close;
  const timestamp = positive(meta.regularMarketTime) ? meta.regularMarketTime : last?.time;
  if (!positive(price) || !positive(timestamp)) throw new MarketError('有効な株価と価格時刻を取得できませんでした。');
  // A long-range chart's chartPreviousClose is the range baseline, not yesterday's close.
  // Read previousClose exclusively from the separate one-day response.
  const previousClose = positive(meta.previousClose) ? meta.previousClose : positive(meta.chartPreviousClose) ? meta.chartPreviousClose : null;
  const change = previousClose === null ? null : price - previousClose;
  const dailyOpen = daily.history.find(point => positive(point.open))?.open ?? null;
  const highs = daily.history.map(point => point.high).filter(positive);
  const lows = daily.history.map(point => point.low).filter(positive);
  const open = positive(meta.regularMarketOpen) ? meta.regularMarketOpen : dailyOpen;
  const dayHigh = positive(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh : highs.length ? Math.max(...highs) : null;
  const dayLow = positive(meta.regularMarketDayLow) ? meta.regularMarketDayLow : lows.length ? Math.min(...lows) : null;
  return {
    stock,
    quote: { price, previousClose, open, dayHigh, dayLow, change, changePercent: previousClose === null ? null : change / previousClose * 100, asOf: new Date(timestamp * 1000).toISOString(), currency: stock.currency, marketState: meta.marketState || null },
    history: chart.history,
    source: 'Yahoo Finance',
    fetchedAt: new Date().toISOString(),
    delayNotice: '価格は提供元の遅延を含む参考値です。休場中は直近の通常取引価格で練習します。',
  };
}

export async function getMarket(symbol, range = '1mo', fetcher = fetch) {
  const stock = STOCKS.find(item => item.symbol === symbol);
  if (!stock) throw new MarketError('対応していない銘柄です。銘柄一覧から選択してください。', 400);
  if (!Object.hasOwn(RANGES, range)) throw new MarketError('対応していないチャート期間です。', 400);
  let cache = fetcherCaches.get(fetcher);
  if (!cache) { cache = new Map(); fetcherCaches.set(fetcher, cache); }
  const key = `${symbol}:${range}`;
  const cached = cache.get(key);
  if (cached && (cached.pending || Date.now() - cached.created < CACHE_TTL)) return cached.promise;
  const entry = { pending: true, created: Date.now(), promise: null };
  entry.promise = loadMarket(stock, range, fetcher).then(value => {
    entry.pending = false;
    entry.created = Date.now();
    return value;
  }).catch(error => { cache.delete(key); throw error; });
  cache.set(key, entry);
  return entry.promise;
}

export const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
});
function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
export async function handleApi(request, fetcher = fetch) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'この操作は利用できません。' }, 405, { Allow: 'GET, HEAD' });
  if (url.pathname === '/api/stocks') return json(STOCKS, 200, { 'Cache-Control': 'public, max-age=3600' });
  if (url.pathname !== '/api/market') return json({ error: 'APIが見つかりません。' }, 404);
  try {
    return json(await getMarket(url.searchParams.get('symbol') || '285A.T', url.searchParams.get('range') || '1mo', fetcher));
  } catch (error) {
    return json({ error: error instanceof MarketError ? error.message : '株価データを取得できませんでした。再取得してください。' }, error instanceof MarketError ? error.status : 502);
  }
}
