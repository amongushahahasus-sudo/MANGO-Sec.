import { createAccount, executeTrade, validateAccount } from './trading.js';
import { STOCKS, getMarket, handleApi } from './market.js';
import { createRepository, providerJson } from './repository.js';

const MAX_BODY_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stockSymbols = new Set(STOCKS.map(stock => stock.symbol));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validVersion = value => Number.isSafeInteger(value) && value >= 0;
const PAGES_ORIGIN = 'https://amongushahahasus-sudo.github.io';

class AccountApiError extends Error {
  constructor(message, status = 400, code) { super(message); this.status = status; this.code = code; }
}
const unavailable = () => new AccountApiError('口座サービスに接続できませんでした。時間をおいてからお試しください。', 503, 'SERVICE_UNAVAILABLE');
const unauthorized = () => new AccountApiError('口座を利用するにはログインしてください。', 401, 'AUTH_REQUIRED');
const conflict = () => new AccountApiError('別の画面で口座が更新されました。口座を再読み込みしてから操作してください。', 409, 'VERSION_CONFLICT');

async function readJson(request, allowedFields) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new AccountApiError('JSON形式で送信してください。', 415);
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new AccountApiError('送信データが大きすぎます。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AccountApiError('送信内容を確認してください。');
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new AccountApiError('送信データが大きすぎます。', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new AccountApiError('送信内容を読み込めませんでした。'); }
  if (!isRecord(body) || Object.keys(body).some(key => !allowedFields.includes(key))) throw new AccountApiError('送信内容を確認してください。');
  return body;
}

function decodeAccount(row) {
  if (!row || !validateAccount(row.state_json) || !validVersion(row.version) || !Array.isArray(row.watchlist_json) || row.watchlist_json.length > STOCKS.length || row.watchlist_json.some(symbol => !stockSymbols.has(symbol))) {
    throw new AccountApiError('保存された口座を読み込めませんでした。', 500, 'ACCOUNT_DATA_INVALID');
  }
  return { account: row.state_json, version: row.version, watchlist: [...new Set(row.watchlist_json)] };
}
const responseBody = (saved, identity) => ({ ...saved, user: { id: identity.userId, displayName: identity.displayName, email: identity.email } });
function hasExistingOrder(saved, order) {
  const existing = saved.account.transactions.find(transaction => transaction.id === order.requestId);
  if (!existing) return false;
  if (existing.symbol !== order.symbol || existing.side !== order.side || existing.quantity !== order.quantity) throw new AccountApiError('同じ注文番号が別の注文で使用されています。注文をやり直してください。', 409, 'REQUEST_ID_REUSED');
  return true;
}

async function verifyIdentity(request, config, fetcher) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.length > MAX_BODY_BYTES || !/^Bearer [^\s]+$/i.test(auth)) throw unauthorized();
  let result;
  try {
    result = await providerJson(fetcher, `${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.publicKey, Authorization: auth },
    });
  } catch { throw unavailable(); }
  if ([400, 401, 403].includes(result.status)) throw unauthorized();
  if (!result.ok) throw unavailable();
  const user = result.data;
  if (!isRecord(user) || typeof user.id !== 'string' || !UUID.test(user.id) || user.is_anonymous === true || typeof user.email !== 'string' || !user.email || !user.email_confirmed_at) throw unauthorized();
  const metadata = isRecord(user.user_metadata) ? user.user_metadata : {};
  const displayName = [metadata.full_name, metadata.name, metadata.display_name].find(value => typeof value === 'string') || user.email.split('@')[0];
  const id = user.id.toLowerCase();
  return { uuid: id, userId: `supabase:${config.projectRef}:${id}`, displayName: displayName.slice(0, 200), email: user.email.slice(0, 254) };
}

/** Factory supports deterministic tests; secrets stay entirely in the edge runtime. */
export function createHandler(settings, dependencies = {}) {
  let config = null;
  try {
    const url = new URL(settings?.supabaseUrl);
    if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || typeof settings.publicKey !== 'string' || !settings.publicKey || typeof settings.serviceRoleKey !== 'string' || !settings.serviceRoleKey) throw new Error('Configuration unavailable');
    config = { ...settings, supabaseUrl: url.origin, projectRef: url.hostname.split('.')[0] };
  } catch { /* A missing server configuration produces a safe 503. */ }
  const fetcher = dependencies.fetcher || fetch;
  const marketFetcher = (url, options = {}) => fetcher(url, { ...options, headers: { ...options.headers, 'Cache-Control': 'no-store' }, cache: 'no-store', redirect: 'manual' });
  const now = typeof dependencies.now === 'function' ? dependencies.now : Date.now;
  const market = dependencies.getMarket || ((symbol, range) => getMarket(symbol, range, marketFetcher));
  const repository = config ? createRepository(config, fetcher) : null;
  const origins = new Set([PAGES_ORIGIN, ...(config ? [config.supabaseUrl] : [])]);

  return async request => {
    const origin = request.headers.get('Origin');
    const cors = origin && origins.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const json = (body, status = 200, extraHeaders = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors, ...extraHeaders },
    });
    try {
      if (origin && !origins.has(origin)) throw new AccountApiError('このアクセス元は許可されていません。', 403, 'ORIGIN_NOT_ALLOWED');
      if (request.method === 'OPTIONS') {
        if (!origin) throw new AccountApiError('アクセス元を確認してください。', 403);
        const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
        if (requestedHeaders.some(header => !['authorization', 'apikey', 'x-client-info', 'content-type'].includes(header))) throw new AccountApiError('このヘッダーは利用できません。', 403);
        return new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'no-store', 'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, apikey, x-client-info, Content-Type', 'Access-Control-Max-Age': '600' } });
      }
      if (!config) throw unavailable();
      const rawPath = new URL(request.url).pathname;
      const path = rawPath.replace(/^\/functions\/v1\/mango-sec-api(?=\/|$)/, '').replace(/^\/mango-sec-api(?=\/|$)/, '') || '/';
      if (path === '/health' && ['GET', 'HEAD'].includes(request.method)) {
        await repository.ready();
        return json({ status: 'ok', version: 'supabase-accounts-v1', databaseReady: true });
      }
      if (path === '/api/stocks' || path === '/api/market') {
        const publicUrl = new URL(request.url);
        publicUrl.pathname = path;
        const response = await handleApi(new Request(publicUrl, request), marketFetcher);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(cors)) headers.set(name, value);
        headers.set('Cache-Control', 'no-store');
        return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
      }
      const identity = await verifyIdentity(request, config, fetcher);
      const methods = { '/api/session': ['GET', 'HEAD'], '/api/account': ['GET', 'HEAD'], '/api/trades': ['POST'], '/api/account/reset': ['POST'], '/api/watchlist': ['PATCH'] };
      if (!Object.hasOwn(methods, path)) return json({ error: 'APIが見つかりません。' }, 404);
      if (!methods[path].includes(request.method)) return json({ error: 'この操作は利用できません。' }, 405, { Allow: methods[path].join(', ') });
      if (!['GET', 'HEAD'].includes(request.method) && !origin) throw new AccountApiError('アクセス元を確認してください。', 403);
      if (path === '/api/session') return json({ authenticated: true, user: responseBody({}, identity).user });
      let saved = decodeAccount(await repository.ensure(identity.uuid, createAccount(now()), now()));
      if (path === '/api/account') return json(responseBody(saved, identity));

      if (path === '/api/trades') {
        const order = await readJson(request, ['symbol', 'side', 'quantity', 'expectedVersion', 'requestId']);
        if (!stockSymbols.has(order.symbol) || !['buy', 'sell'].includes(order.side) || !Number.isSafeInteger(order.quantity) || order.quantity < 1 || order.quantity > 1_000_000 || !validVersion(order.expectedVersion) || typeof order.requestId !== 'string' || !UUID.test(order.requestId)) throw new AccountApiError('銘柄・売買区分・株数・注文番号を確認してください。');
        if (hasExistingOrder(saved, order)) return json(responseBody(saved, identity));
        if (order.expectedVersion !== saved.version) throw conflict();
        let data;
        try { data = await market(order.symbol, '1d'); }
        catch { throw new AccountApiError('約定に使う株価を取得できませんでした。時間をおいてからお試しください。', 502, 'MARKET_UNAVAILABLE'); }
        const stock = STOCKS.find(item => item.symbol === order.symbol);
        let next;
        try { next = executeTrade(saved.account, { stock, side: order.side, quantity: order.quantity, quote: data?.quote, fetchedAt: data?.fetchedAt, source: data?.source }, now()); }
        catch (error) { throw new AccountApiError(error instanceof Error ? error.message : '注文内容を確認してください。'); }
        next.transactions[0].id = order.requestId;
        const updated = await repository.save(identity.uuid, saved.version, next, saved.watchlist, now());
        if (!updated) {
          saved = decodeAccount(await repository.read(identity.uuid));
          if (hasExistingOrder(saved, order)) return json(responseBody(saved, identity));
          throw conflict();
        }
        return json(responseBody(decodeAccount(updated), identity));
      }
      if (path === '/api/account/reset') {
        const body = await readJson(request, ['expectedVersion']);
        if (!validVersion(body.expectedVersion)) throw new AccountApiError('口座の更新番号を確認してください。');
        if (body.expectedVersion !== saved.version) throw conflict();
        const updated = await repository.save(identity.uuid, saved.version, createAccount(now()), saved.watchlist, now());
        if (!updated) throw conflict();
        return json(responseBody(decodeAccount(updated), identity));
      }
      const body = await readJson(request, ['symbols', 'expectedVersion']);
      if (!validVersion(body.expectedVersion) || !Array.isArray(body.symbols) || body.symbols.length > STOCKS.length || body.symbols.some(symbol => !stockSymbols.has(symbol))) throw new AccountApiError('ウォッチリストの銘柄を確認してください。');
      if (body.expectedVersion !== saved.version) throw conflict();
      const updated = await repository.save(identity.uuid, saved.version, saved.account, [...new Set(body.symbols)], now());
      if (!updated) throw conflict();
      return json(responseBody(decodeAccount(updated), identity));
    } catch (error) {
      if (error instanceof AccountApiError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
      return json({ error: '口座サービスに接続できませんでした。時間をおいてからお試しください。', code: 'SERVICE_UNAVAILABLE' }, 503);
    }
  };
}
