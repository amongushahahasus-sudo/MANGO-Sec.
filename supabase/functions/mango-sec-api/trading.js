/** Browser-local, long-only paper trading. Money is settled to two decimal places. */
export const ACCOUNT_VERSION = 1;
export const INITIAL_CASH = Object.freeze({ JPY: 10_000_000, USD: 10_000 });
const CURRENCIES = ['JPY', 'USD'];
const FETCH_TTL_MS = 5 * 60_000;
const QUOTE_TTL_MS = 7 * 24 * 60 * 60_000;
const FUTURE_SKEW_MS = 30_000;
const MAX_QUANTITY = 1_000_000;
// Decimal strings retain the provider's quoted number while integer arithmetic avoids
// cases such as 10.075 * 100 becoming 1007.4999999999999 in binary floats.
function settledCents(value, multiplier = 1) {
  if (!Number.isFinite(value) || !Number.isSafeInteger(multiplier)) return NaN;
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return NaN;
  const [, sign, integer, fraction = '', exponent = '0'] = match;
  let amount = BigInt(integer + fraction) * BigInt(multiplier);
  const shift = Number(exponent) + 2 - fraction.length;
  if (shift >= 0) amount *= 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    amount = (amount + divisor / 2n) / divisor;
  }
  return Number(sign ? -amount : amount);
}
const cents = value => settledCents(value);
const money = value => cents(value) / 100;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCurrency = value => CURRENCIES.includes(value);
const isAmount = value => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(cents(value));
const isSignedAmount = value => Number.isFinite(value) && Number.isSafeInteger(cents(value));
const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isSymbol = value => typeof value === 'string' && /^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(value);

export function createAccount(now = Date.now()) {
  return {
    version: ACCOUNT_VERSION,
    createdAt: new Date(now).toISOString(),
    cash: { ...INITIAL_CASH },
    positions: [],
    transactions: [],
    realizedPnL: { JPY: 0, USD: 0 },
  };
}

/** Reject damaged or incompatible localStorage without trusting its shape. */
export function validateAccount(account) {
  if (!isRecord(account) || account.version !== ACCOUNT_VERSION || !isDate(account.createdAt)) return false;
  if (!isRecord(account.cash) || !isRecord(account.realizedPnL)) return false;
  if (!CURRENCIES.every(currency => isAmount(account.cash[currency]) && isSignedAmount(account.realizedPnL[currency]))) return false;
  if (!Array.isArray(account.positions) || !Array.isArray(account.transactions)) return false;
  const symbols = new Set();
  for (const position of account.positions) {
    if (!isRecord(position) || !isSymbol(position.symbol) || symbols.has(position.symbol)) return false;
    if (typeof position.name !== 'string' || !isCurrency(position.currency)) return false;
    if (!Number.isSafeInteger(position.quantity) || position.quantity <= 0) return false;
    if (!isAmount(position.costBasis) || !Number.isFinite(position.averageCost) || position.averageCost < 0) return false;
    if (Math.abs(position.averageCost * position.quantity - position.costBasis) > 0.011) return false;
    symbols.add(position.symbol);
  }
  for (const transaction of account.transactions) {
    if (!isRecord(transaction) || typeof transaction.id !== 'string' || !isSymbol(transaction.symbol)) return false;
    if (!isCurrency(transaction.currency) || !['buy', 'sell'].includes(transaction.side)) return false;
    if (!Number.isSafeInteger(transaction.quantity) || transaction.quantity < 1 || transaction.quantity > MAX_QUANTITY) return false;
    if (!isAmount(transaction.price) || transaction.price <= 0 || !isAmount(transaction.total)) return false;
    if (!isSignedAmount(transaction.realizedPnL) || !isDate(transaction.priceAsOf) || !isDate(transaction.executionAt)) return false;
    if (typeof transaction.source !== 'string' || !transaction.source) return false;
  }
  return true;
}

/**
 * Create a new account state; this function never mutates the supplied account.
 * quote is the provider quote object, fetchedAt/source come from /api/market.
 */
export function executeTrade(account, order, now = Date.now()) {
  if (!validateAccount(account)) throw new Error('口座データを読み込めません。口座をリセットしてください。');
  if (!isRecord(order)) throw new Error('注文内容を確認してください。');
  const { stock, side, quantity, quote, fetchedAt, source } = order;
  if (!isRecord(stock) || !isSymbol(stock.symbol) || typeof stock.name !== 'string' || !isCurrency(stock.currency)) {
    throw new Error('銘柄情報を確認してください。');
  }
  if (!['buy', 'sell'].includes(side)) throw new Error('売買区分を選んでください。');
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new Error('株数は1〜1,000,000の整数で入力してください。');
  }
  if (!isRecord(quote) || !Number.isFinite(quote.price) || quote.price <= 0 || quote.currency !== stock.currency) {
    throw new Error('有効な株価がありません。株価を更新してください。');
  }
  const fetchedTime = Date.parse(fetchedAt);
  const quotedTime = Date.parse(quote.asOf);
  if (!Number.isFinite(now) || !isDate(fetchedAt) || now - fetchedTime > FETCH_TTL_MS || fetchedTime - now > FUTURE_SKEW_MS) {
    throw new Error('株価の取得から5分以上経過しています。株価を更新してください。');
  }
  if (!isDate(quote.asOf) || now - quotedTime > QUOTE_TTL_MS || quotedTime - now > FUTURE_SKEW_MS || quotedTime - fetchedTime > FUTURE_SKEW_MS) {
    throw new Error('価格時刻が古いか不正です。株価を更新してください。');
  }
  if (typeof source !== 'string' || !source.trim() || source.length > 200) {
    throw new Error('株価の取得元を確認できません。株価を更新してください。');
  }
  const totalCents = settledCents(quote.price, quantity);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error('注文金額を確認してください。');
  const currency = stock.currency;
  const balanceCents = cents(account.cash[currency]);
  const existing = account.positions.find(position => position.symbol === stock.symbol);
  if (existing && existing.currency !== currency) throw new Error('保有銘柄の通貨が一致しません。');
  if (side === 'buy' && totalCents > balanceCents) throw new Error('買付余力が不足しています。株数を減らしてください。');
  if (side === 'sell' && (!existing || quantity > existing.quantity)) throw new Error('売却できる保有株数が不足しています。');
  if (side === 'buy' && !Number.isSafeInteger((existing?.quantity || 0) + quantity)) throw new Error('保有株数が上限を超えています。');

  const next = {
    ...account,
    cash: { ...account.cash },
    realizedPnL: { ...account.realizedPnL },
    positions: account.positions.map(position => ({ ...position })),
    transactions: [...account.transactions],
  };
  let realizedCents = 0;
  if (side === 'buy') {
    next.cash[currency] = (balanceCents - totalCents) / 100;
    const owned = next.positions.find(position => position.symbol === stock.symbol);
    if (owned) {
      const newBasisCents = cents(owned.costBasis) + totalCents;
      if (!Number.isSafeInteger(newBasisCents)) throw new Error('取得金額が上限を超えています。');
      owned.quantity += quantity;
      owned.costBasis = newBasisCents / 100;
      owned.averageCost = owned.costBasis / owned.quantity;
    } else {
      next.positions.push({
        symbol: stock.symbol,
        name: stock.name,
        currency,
        quantity,
        averageCost: totalCents / 100 / quantity,
        costBasis: totalCents / 100,
      });
    }
  } else {
    const owned = next.positions.find(position => position.symbol === stock.symbol);
    const allocatedCents = quantity === owned.quantity ? cents(owned.costBasis) : Number((BigInt(cents(owned.costBasis)) * BigInt(quantity) + BigInt(owned.quantity) / 2n) / BigInt(owned.quantity));
    realizedCents = totalCents - allocatedCents;
    const nextBalance = balanceCents + totalCents;
    const nextRealized = cents(next.realizedPnL[currency]) + realizedCents;
    if (!Number.isSafeInteger(nextBalance) || !Number.isSafeInteger(nextRealized)) throw new Error('口座金額が上限を超えています。');
    next.cash[currency] = nextBalance / 100;
    next.realizedPnL[currency] = nextRealized / 100;
    owned.quantity -= quantity;
    owned.costBasis = (cents(owned.costBasis) - allocatedCents) / 100;
    if (owned.quantity === 0) next.positions = next.positions.filter(position => position.symbol !== stock.symbol);
    else owned.averageCost = owned.costBasis / owned.quantity;
  }
  const executionAt = new Date(now).toISOString();
  const id = globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`;
  next.transactions.unshift({
    id,
    symbol: stock.symbol,
    name: stock.name,
    currency,
    side,
    quantity,
    price: quote.price,
    total: totalCents / 100,
    source: source.trim(),
    priceAsOf: quote.asOf,
    executionAt,
    realizedPnL: realizedCents / 100,
  });
  return next;
}

/** Value currencies independently. Unknown prices are never replaced with invented values. */
export function calculatePortfolio(account, quotes = {}) {
  if (!validateAccount(account)) throw new Error('口座データを読み込めません。');
  const positions = account.positions.map(position => {
    const data = quotes instanceof Map ? quotes.get(position.symbol) : quotes?.[position.symbol];
    const quote = data?.quote || data;
    const complete = !!quote && Number.isFinite(quote.price) && quote.price > 0 && quote.currency === position.currency;
    const marketValue = complete ? settledCents(quote.price, position.quantity) / 100 : null;
    const unrealizedPnL = complete ? money(marketValue - position.costBasis) : null;
    return {
      ...position,
      price: complete ? quote.price : null,
      priceAsOf: complete ? quote.asOf || null : null,
      marketValue,
      unrealizedPnL,
      unrealizedPercent: complete && position.costBasis > 0 ? unrealizedPnL / position.costBasis * 100 : null,
      complete,
    };
  });
  const currencies = {};
  for (const currency of CURRENCIES) {
    const owned = positions.filter(position => position.currency === currency);
    const complete = owned.every(position => position.complete);
    const costBasis = money(owned.reduce((sum, position) => sum + position.costBasis, 0));
    const marketValue = complete ? money(owned.reduce((sum, position) => sum + position.marketValue, 0)) : null;
    currencies[currency] = {
      cash: account.cash[currency],
      costBasis,
      marketValue,
      equity: complete ? money(account.cash[currency] + marketValue) : null,
      unrealizedPnL: complete ? money(marketValue - costBasis) : null,
      realizedPnL: account.realizedPnL[currency],
      complete,
    };
  }
  return { positions, currencies, complete: positions.every(position => position.complete) };
}
