const DEFAULT_API_BASE = 'https://mango-sec-trading.azumaishow781.chatgpt.site';
const SESSION_KEY = 'mango-sec:session:v2';
const LOGIN_KEY = 'mango-sec:login:v2';
const LOGIN_TTL_MS = 10 * 60_000;
const browser = typeof window !== 'undefined' && typeof document !== 'undefined';

function configuredBase() {
  const configured = browser ? document.querySelector('meta[name="mango-api-base"]')?.content : null;
  try {
    const url = new URL(configured || DEFAULT_API_BASE);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return DEFAULT_API_BASE;
    // Authentication tokens belong only to the API origin selected for this app.
    if (url.origin !== DEFAULT_API_BASE) return DEFAULT_API_BASE;
    return url.origin;
  } catch { return DEFAULT_API_BASE; }
}
export const API_BASE = configuredBase();

export class ApiError extends Error {
  constructor(message, status = 0, code = null, uncertain = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.uncertain = uncertain;
  }
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function expiryTime(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  return typeof value === 'string' ? Date.parse(value) : NaN;
}
function validSession(value) {
  return isRecord(value) && typeof value.token === 'string' && /^[A-Za-z0-9_-]{20,512}$/.test(value.token)
    && Number.isFinite(expiryTime(value.expiresAt)) && expiryTime(value.expiresAt) > Date.now();
}
function readSession() {
  if (!browser) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return validSession(saved) ? saved : null;
  } catch { return null; }
}
let currentSession = readSession();
function announceAuth() {
  if (browser) window.dispatchEvent(new CustomEvent('mango:authchange', {detail:{authenticated:hasSession()}}));
}
export function clearAuth() {
  currentSession = null;
  if (browser) {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* In-memory state is still cleared. */ }
  }
}
export function hasSession() {
  if (validSession(currentSession)) return true;
  if (currentSession) clearAuth();
  return false;
}
export function getSessionUser() {
  return hasSession() && isRecord(currentSession.user) ? {...currentSession.user} : null;
}

/** API callers may pass only a same-backend API path, never an arbitrary URL. */
export function apiUrl(path) {
  if (typeof path !== 'string' || !/^\/api(?:\/|\?|$)/.test(path) || path.includes('\\')) throw new TypeError('APIパスが不正です。');
  const url = new URL(path, API_BASE);
  if (url.origin !== API_BASE || !/^\/api(?:\/|$)/.test(url.pathname)) throw new TypeError('APIパスが不正です。');
  return url.href;
}

export async function apiRequest(path, {method = 'GET', body, auth = true, signal} = {}) {
  const headers = {'Accept':'application/json'};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && hasSession()) headers.Authorization = `Bearer ${currentSession.token}`;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once:true});
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(apiUrl(path), {method, headers, body:body === undefined ? undefined : JSON.stringify(body), credentials:'omit', cache:'no-store', signal:controller.signal});
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError('サーバーの応答を読み取れませんでした。処理結果を確認してください。', response.status, null, response.ok); }
    if (!response.ok) {
      if (response.status === 401 && auth) { clearAuth(); announceAuth(); }
      const message = typeof data?.error === 'string' ? data.error : typeof data?.error?.message === 'string' ? data.error.message : '処理を完了できませんでした。再度お試しください。';
      throw new ApiError(message, response.status, typeof data?.code === 'string' ? data.code : null);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError || error instanceof TypeError && error.message === 'APIパスが不正です。') throw error;
    if (error?.name === 'AbortError') throw new ApiError('通信に時間がかかっています。処理結果を確認してから再試行してください。');
    throw new ApiError('サーバーに接続できませんでした。通信環境を確認してください。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function randomString(bytes) { return base64url(crypto.getRandomValues(new Uint8Array(bytes))); }
function navigateTop(url) {
  if (!browser) throw new Error('ブラウザーからログインしてください。');
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_top';
  anchor.rel = 'noreferrer';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export async function beginSignIn() {
  if (!browser || !globalThis.crypto?.subtle) throw new Error('このブラウザーではログインを利用できません。HTTPSで開いてください。');
  const verifier = randomString(32);
  const state = randomString(24);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const pending = {verifier,state,createdAt:Date.now()};
  try {
    sessionStorage.setItem(LOGIN_KEY, JSON.stringify(pending));
    if (!sessionStorage.getItem(LOGIN_KEY)) throw new Error('blocked');
  } catch { throw new Error('ログインには、このタブでのセッション保存を許可してください。'); }
  const url = new URL('/auth/start', API_BASE);
  url.searchParams.set('challenge', challenge);
  url.searchParams.set('state', state);
  navigateTop(url.href);
}

/** Complete a native sign-in callback before loading the user's server account. */
export async function completeSignIn() {
  if (!browser) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.has('auth_code')) return null;
  const code = params.get('auth_code');
  const state = params.get('state');
  // The one-time code should not remain in history or be copied with a shared link.
  history.replaceState(null, '', `${location.pathname}${location.search}#market`);
  let pending;
  try {
    pending = JSON.parse(sessionStorage.getItem(LOGIN_KEY) || 'null');
    sessionStorage.removeItem(LOGIN_KEY);
  } catch { throw new Error('ログイン情報を確認できません。もう一度ログインしてください。'); }
  if (!isRecord(pending) || pending.state !== state || typeof pending.verifier !== 'string' || !Number.isFinite(pending.createdAt)
    || Date.now() - pending.createdAt > LOGIN_TTL_MS || pending.createdAt - Date.now() > 30_000 || !/^[A-Za-z0-9_-]{20,512}$/.test(code || '')) {
    throw new Error('ログインの確認情報が無効か期限切れです。もう一度ログインしてください。');
  }
  const data = await apiRequest('/api/auth/exchange', {method:'POST', body:{code,verifier:pending.verifier}, auth:false});
  const session = {token:data?.token,expiresAt:data?.expiresAt,user:isRecord(data?.user) ? data.user : null};
  if (!validSession(session)) throw new Error('ログインの応答を確認できません。もう一度ログインしてください。');
  currentSession = session;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  catch { /* The signed-in session remains available until this page closes. */ }
  announceAuth();
  return {completed:true,user:getSessionUser()};
}

export async function signOut() {
  try {
    if (hasSession()) await apiRequest('/api/auth/logout', {method:'POST',body:{}});
  } catch { /* Local sign-out always clears the active account view. */ }
  finally { clearAuth(); announceAuth(); }
  navigateTop(new URL('/auth/signout', API_BASE).href);
}
