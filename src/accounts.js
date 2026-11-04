import { createAccount, executeTrade, validateAccount } from '../public/trading.js';
import { STOCKS, getMarket } from './market.js';

const MAX_BODY_BYTES = 16 * 1024;
const stockSymbols = new Set(STOCKS.map(stock => stock.symbol));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validVersion = value => Number.isSafeInteger(value) && value >= 0;

class AccountApiError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function accountJson(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function conflict() {
  return new AccountApiError('別の画面で口座が更新されました。口座を再読み込みしてから操作してください。', 409, 'VERSION_CONFLICT');
}

async function readJson(request, allowedFields) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw new AccountApiError('JSON形式で送信してください。', 415);
  }
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new AccountApiError('送信データが大きすぎます。', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AccountApiError('送信内容を確認してください。');
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new AccountApiError('送信データが大きすぎます。', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new AccountApiError('送信内容を読み込めませんでした。'); }
  if (!isRecord(body) || Object.keys(body).some(key => !allowedFields.includes(key))) {
    throw new AccountApiError('送信内容を確認してください。');
  }
  return body;
}

function decodeAccount(row) {
  let account, watchlist;
  try {
    account = JSON.parse(row.state_json);
    watchlist = JSON.parse(row.watchlist_json);
  } catch {
    throw new AccountApiError('保存された口座を読み込めませんでした。', 500, 'ACCOUNT_DATA_INVALID');
  }
  if (!validateAccount(account) || !validVersion(row.version) || !Array.isArray(watchlist) || watchlist.some(symbol => !stockSymbols.has(symbol))) {
    throw new AccountApiError('保存された口座を読み込めませんでした。', 500, 'ACCOUNT_DATA_INVALID');
  }
  return { account, version: row.version, watchlist: [...new Set(watchlist)] };
}

async function readAccount(db, userId) {
  const row = await db.prepare('SELECT state_json, version, watchlist_json FROM mango_accounts WHERE user_id = ?').bind(userId).first();
  if (!row) throw new AccountApiError('口座を読み込めませんでした。もう一度お試しください。', 503);
  return decodeAccount(row);
}

async function ensureAccount(db, userId, now) {
  const timestamp = new Date(now).toISOString();
  await db.prepare("INSERT OR IGNORE INTO mango_accounts (user_id, state_json, version, watchlist_json, created_at, updated_at) VALUES (?, ?, 0, '[]', ?, ?)")
    .bind(userId, JSON.stringify(createAccount(now)), timestamp, timestamp).run();
  return readAccount(db, userId);
}

function responseBody(saved, identity) {
  return {
    ...saved,
    user: {
      id: identity.userId,
      displayName: typeof identity.displayName === 'string' ? identity.displayName.slice(0, 200) : '',
      email: typeof identity.email === 'string' ? identity.email.slice(0, 254) : '',
    },
  };
}

function hasExistingOrder(saved, order) {
  const existing = saved.account.transactions.find(transaction => transaction.id === order.requestId);
  if (!existing) return false;
  if (existing.symbol !== order.symbol || existing.side !== order.side || existing.quantity !== order.quantity) {
    throw new AccountApiError('同じ注文番号が別の注文で使用されています。注文をやり直してください。', 409, 'REQUEST_ID_REUSED');
  }
  return true;
}

async function saveState(db, userId, version, account, now) {
  const result = await db.prepare('UPDATE mango_accounts SET state_json = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?')
    .bind(JSON.stringify(account), new Date(now).toISOString(), userId, version).run();
  return result.meta?.changes === 1;
}

/** The caller supplies an identity verified by the hosting/auth boundary. */
export async function handleAccountApi(request, env, identity, dependencies = {}) {
  const path = new URL(request.url).pathname;
  const methods = {
    '/api/account': ['GET', 'HEAD'],
    '/api/trades': ['POST'],
    '/api/account/reset': ['POST'],
    '/api/watchlist': ['PATCH'],
  };
  if (!Object.hasOwn(methods, path)) return accountJson({ error: 'APIが見つかりません。' }, 404);
  if (!identity || typeof identity.userId !== 'string' || !identity.userId || identity.userId.length > 512) {
    return accountJson({ error: '口座を利用するにはログインしてください。', code: 'AUTH_REQUIRED' }, 401);
  }
  if (!methods[path].includes(request.method)) {
    return accountJson({ error: 'この操作は利用できません。' }, 405, { Allow: methods[path].join(', ') });
  }
  const db = env?.DB;
  if (!db || typeof db.prepare !== 'function') {
    return accountJson({ error: '口座保存サービスを準備中です。しばらくしてからお試しください。' }, 503);
  }
  const now = typeof dependencies.now === 'function' ? dependencies.now : Date.now;
  const market = dependencies.getMarket || getMarket;
  const userId = identity.userId;
  try {
    let saved = await ensureAccount(db, userId, now());
    if (path === '/api/account') return accountJson(responseBody(saved, identity));

    if (path === '/api/trades') {
      const order = await readJson(request, ['symbol', 'side', 'quantity', 'expectedVersion', 'requestId']);
      if (!stockSymbols.has(order.symbol) || !['buy', 'sell'].includes(order.side) || !Number.isSafeInteger(order.quantity) || order.quantity < 1 || order.quantity > 1_000_000 || !validVersion(order.expectedVersion) || typeof order.requestId !== 'string' || !uuid.test(order.requestId)) {
        throw new AccountApiError('銘柄・売買区分・株数・注文番号を確認してください。');
      }
      if (hasExistingOrder(saved, order)) return accountJson(responseBody(saved, identity));
      if (order.expectedVersion !== saved.version) throw conflict();
      let data;
      try { data = await market(order.symbol, '1d'); }
      catch { throw new AccountApiError('約定に使う株価を取得できませんでした。時間をおいてからお試しください。', 502, 'MARKET_UNAVAILABLE'); }
      const stock = STOCKS.find(item => item.symbol === order.symbol);
      let next;
      try {
        next = executeTrade(saved.account, { stock, side: order.side, quantity: order.quantity, quote: data?.quote, fetchedAt: data?.fetchedAt, source: data?.source }, now());
      } catch (error) {
        throw new AccountApiError(error instanceof Error ? error.message : '注文内容を確認してください。');
      }
      next.transactions[0].id = order.requestId;
      if (!await saveState(db, userId, saved.version, next, now())) {
        saved = await readAccount(db, userId);
        if (hasExistingOrder(saved, order)) return accountJson(responseBody(saved, identity));
        throw conflict();
      }
      return accountJson(responseBody(await readAccount(db, userId), identity));
    }

    if (path === '/api/account/reset') {
      const body = await readJson(request, ['expectedVersion']);
      if (!validVersion(body.expectedVersion)) throw new AccountApiError('口座の更新番号を確認してください。');
      if (body.expectedVersion !== saved.version) throw conflict();
      if (!await saveState(db, userId, saved.version, createAccount(now()), now())) throw conflict();
      return accountJson(responseBody(await readAccount(db, userId), identity));
    }

    const body = await readJson(request, ['symbols', 'expectedVersion']);
    if (!validVersion(body.expectedVersion) || !Array.isArray(body.symbols) || body.symbols.length > STOCKS.length || body.symbols.some(symbol => !stockSymbols.has(symbol))) {
      throw new AccountApiError('ウォッチリストの銘柄を確認してください。');
    }
    if (body.expectedVersion !== saved.version) throw conflict();
    const symbols = [...new Set(body.symbols)];
    const result = await db.prepare('UPDATE mango_accounts SET watchlist_json = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?')
      .bind(JSON.stringify(symbols), new Date(now()).toISOString(), userId, saved.version).run();
    if (result.meta?.changes !== 1) throw conflict();
    return accountJson(responseBody(await readAccount(db, userId), identity));
  } catch (error) {
    if (error instanceof AccountApiError) return accountJson({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
    return accountJson({ error: '口座サービスに接続できませんでした。時間をおいてからお試しください。' }, 503);
  }
}
