/** Native Sites sign-in with a one-time PKCE handoff to the GitHub Pages UI. */
const AUTH_DEFAULT_ORIGIN = 'https://amongushahahasus-sudo.github.io';
const AUTH_DEFAULT_APP_URL = 'https://amongushahahasus-sudo.github.io/MANGO-Sec./';
const AUTH_CODE_TTL = 5 * 60_000;
const AUTH_SESSION_TTL = 7 * 24 * 60 * 60_000;
const AUTH_OPAQUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const AUTH_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const AUTH_JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer' };

function authJson(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...AUTH_JSON_HEADERS, ...headers } });
}
function authRedirect(location) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
function authConfig(env = {}) {
  const origin = new URL(env.PUBLIC_APP_ORIGIN || AUTH_DEFAULT_ORIGIN).origin;
  const appUrl = new URL(env.PUBLIC_APP_URL || AUTH_DEFAULT_APP_URL);
  if (appUrl.origin !== origin || appUrl.protocol !== 'https:' || appUrl.username || appUrl.password) throw new Error('Invalid public app configuration');
  return { origin, appUrl };
}
function authBase64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function authRandomToken() { return authBase64url(crypto.getRandomValues(new Uint8Array(32))); }
async function authHash(value) {
  return authBase64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
function authNativeIdentity(request) {
  // These headers are inserted and sanitized by the hosted Sites dispatcher.
  // A local adapter must remove caller-supplied headers before using this module.
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId || userId.length > 256 || /[\x00-\x1f\x7f]/.test(userId)) return null;
  const rawEmail = request.headers.get('oai-authenticated-user-email') || '';
  const email = rawEmail.length <= 320 && !/[\x00-\x1f\x7f]/.test(rawEmail) ? rawEmail : '';
  const encodedName = request.headers.get('oai-authenticated-user-full-name');
  let fullName = '';
  if (encodedName) {
    try {
      fullName = request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8'
        ? decodeURIComponent(encodedName) : encodedName;
    } catch { fullName = ''; }
  }
  if (fullName.length > 200 || /[\x00-\x1f\x7f]/.test(fullName)) fullName = '';
  return { userId, displayName: fullName.trim() || email || 'MANGOユーザー', email };
}
function authPublicUser(identity) { return { displayName: identity.displayName, email: identity.email }; }
function authBearer(request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/i);
  return match?.[1] || '';
}
function authHasDatabase(env) { return typeof env?.DB?.prepare === 'function'; }
function authMutationOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  const { origin: appOrigin } = authConfig(env);
  return origin === appOrigin || origin === new URL(request.url).origin;
}
async function authReadJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(type)) throw new Error('JSON形式で送信してください。');
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > 16_384) throw new Error('送信内容が大きすぎます。');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('送信内容を確認してください。');
  let total = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 16_384) { await reader.cancel(); throw new Error('送信内容が大きすぎます。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(buffer)); }
  catch { throw new Error('送信内容を確認してください。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('送信内容を確認してください。');
  return body;
}

/** Resolve only server-verified identity. Bearer tokens never contain a claimed user ID. */
export async function resolveIdentity(request, env = {}, now = Date.now()) {
  const token = authBearer(request);
  if (token !== null) {
    if (!token || !authHasDatabase(env)) return null;
    const row = await env.DB.prepare('SELECT user_id, display_name, email, expires_at FROM mango_sessions WHERE token_hash = ? AND expires_at > ?').bind(await authHash(token), now).first();
    return row ? { userId: row.user_id, displayName: row.display_name, email: row.email } : null;
  }
  return authNativeIdentity(request);
}

/** Return null for all non-auth routes, including dispatcher-owned SIWC paths. */
export async function handleAuthRoutes(request, env = {}, dependencies = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const paths = ['/auth/start', '/auth/signout', '/auth/return', '/api/auth/exchange', '/api/auth/logout', '/api/session'];
  if (!paths.includes(path)) return null;
  const now = dependencies.now ? dependencies.now() : Date.now();
  try {
    const expectedMethod = path === '/api/auth/exchange' || path === '/api/auth/logout' ? 'POST' : 'GET';
    if (request.method !== expectedMethod) return authJson({ error: 'この操作は利用できません。' }, 405, { Allow: expectedMethod });
    if (expectedMethod === 'POST' && !authMutationOriginAllowed(request, env)) return authJson({ error: '許可されていない送信元です。' }, 403);
    const config = authConfig(env);
    if (path === '/auth/return') return authRedirect(config.appUrl.href);
    if (path === '/auth/signout') return authRedirect('/signout-with-chatgpt?return_to=' + encodeURIComponent('/auth/return'));
    if (path === '/api/session') {
      const identity = await resolveIdentity(request, env, now);
      return authJson(identity ? { authenticated: true, user: authPublicUser(identity) } : { authenticated: false, user: null });
    }
    if (path === '/auth/start') {
      const challenge = url.searchParams.get('challenge') || '';
      const state = url.searchParams.get('state') || '';
      if (!AUTH_OPAQUE_PATTERN.test(challenge) || !AUTH_STATE_PATTERN.test(state)) return authJson({ error: 'ログイン情報が不正です。アプリからやり直してください。' }, 400);
      const identity = authNativeIdentity(request);
      if (!identity) return authRedirect('/signin-with-chatgpt?return_to=' + encodeURIComponent(path + url.search));
      if (!authHasDatabase(env)) return authJson({ error: '口座の保存先を準備しています。しばらくしてからログインしてください。' }, 503);
      const code = authRandomToken();
      await env.DB.prepare('INSERT INTO mango_login_codes (code_hash, user_id, display_name, email, challenge, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(await authHash(code), identity.userId, identity.displayName, identity.email, challenge, state, now + AUTH_CODE_TTL).run();
      const target = new URL(config.appUrl);
      target.hash = new URLSearchParams({ auth_code: code, state }).toString();
      return authRedirect(target.href);
    }
    if (!authHasDatabase(env)) return authJson({ error: '口座の保存先を準備しています。しばらくしてから再試行してください。' }, 503);
    if (path === '/api/auth/exchange') {
      let body;
      try { body = await authReadJson(request); } catch (error) { return authJson({ error: error.message }, 400); }
      const { code, verifier } = body;
      if (typeof code !== 'string' || !AUTH_OPAQUE_PATTERN.test(code) || typeof verifier !== 'string' || !AUTH_VERIFIER_PATTERN.test(verifier)) return authJson({ error: 'ログイン情報が不正です。アプリからやり直してください。' }, 400);
      // The single DELETE verifies PKCE, expiry, and one-time consumption atomically.
      const row = await env.DB.prepare('DELETE FROM mango_login_codes WHERE code_hash = ? AND challenge = ? AND expires_at > ? RETURNING user_id, display_name, email')
        .bind(await authHash(code), await authHash(verifier), now).first();
      if (!row) return authJson({ error: 'ログインの確認期限が切れたか、確認情報が一致しません。もう一度ログインしてください。' }, 401);
      const token = authRandomToken();
      const expires = now + AUTH_SESSION_TTL;
      await env.DB.prepare('INSERT INTO mango_sessions (token_hash, user_id, display_name, email, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(await authHash(token), row.user_id, row.display_name, row.email, expires).run();
      return authJson({ token, expiresAt: new Date(expires).toISOString(), user: { displayName: row.display_name, email: row.email } });
    }
    if (path === '/api/auth/logout') {
      const token = authBearer(request);
      if (token) await env.DB.prepare('DELETE FROM mango_sessions WHERE token_hash = ?').bind(await authHash(token)).run();
      return authJson({ success: true });
    }
    return null;
  } catch {
    return authJson({ error: 'ログイン情報を確認できませんでした。時間をおいて再試行してください。' }, 503);
  }
}
