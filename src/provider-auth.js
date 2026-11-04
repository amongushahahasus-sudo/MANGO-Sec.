/** Validate a Google/email Supabase session against its trusted Auth server. */
const PROVIDER_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PROVIDER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_TIMEOUT_MS = 8_000;
const PROVIDER_MAX_TOKEN_LENGTH = 16_384;

export class ProviderAuthError extends Error {
  constructor(message = 'ログイン情報の確認先に接続できません。しばらくしてから再試行してください。', code = 'PROVIDER_UNAVAILABLE') {
    super(message);
    this.name = 'ProviderAuthError';
    this.code = code;
    this.status = 503;
  }
}

function providerConfiguration(env) {
  const urlValue = env.PUBLIC_SUPABASE_URL;
  const key = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (typeof urlValue !== 'string' || typeof key !== 'string' || !key || key.length > PROVIDER_MAX_TOKEN_LENGTH) {
    throw new ProviderAuthError('ログインの設定を確認できません。', 'PROVIDER_CONFIG');
  }
  let url;
  try { url = new URL(urlValue); } catch { throw new ProviderAuthError('ログインの設定を確認できません。', 'PROVIDER_CONFIG'); }
  const project = url.hostname.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.supabase\.co$/)?.[1];
  if (url.protocol !== 'https:' || !project || url.username || url.password || url.port || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new ProviderAuthError('ログインの設定を確認できません。', 'PROVIDER_CONFIG');
  }
  let allowedKey = /^sb_publishable_[A-Za-z0-9_-]{10,1024}$/.test(key);
  // Only the public legacy anon key is supported for compatibility. Decoding this
  // trusted configuration does not authorize a caller or determine user identity.
  if (!allowedKey && PROVIDER_JWT_PATTERN.test(key)) {
    try {
      const segment = key.split('.')[1];
      const payload = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/')));
      allowedKey = payload?.role === 'anon' && payload?.ref === project;
    } catch { allowedKey = false; }
  }
  if (!allowedKey) throw new ProviderAuthError('公開用のログイン設定を確認できません。', 'PROVIDER_CONFIG');
  return { origin: url.origin, project, key };
}

function providerDisplayName(user, email) {
  const metadata = user.user_metadata;
  for (const candidate of [metadata?.display_name, metadata?.full_name, email]) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
    if (value) return value;
  }
  return 'MANGOユーザー';
}

/**
 * Non-JWT credentials belong to the existing native sign-in adapter and return
 * null without a request. JWT claims are never decoded for authorization.
 */
export async function resolveProviderIdentity(request, env = {}, fetcher = fetch) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const match = authorization.match(/^Bearer ([A-Za-z0-9_.-]+)$/i);
  const token = match?.[1];
  if (!token || token.length > PROVIDER_MAX_TOKEN_LENGTH || !PROVIDER_JWT_PATTERN.test(token)) return null;
  const config = providerConfiguration(env);
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ProviderAuthError('ログイン情報の確認に時間がかかっています。もう一度お試しください。'));
    }, PROVIDER_TIMEOUT_MS);
  });
  try {
    const validation = (async () => {
      const response = await fetcher(config.origin + '/auth/v1/user', {
        method: 'GET',
        headers: { apikey: config.key, Authorization: 'Bearer ' + token, Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new ProviderAuthError();
      let user;
      try { user = await response.json(); } catch { throw new ProviderAuthError(); }
      if (!user || typeof user !== 'object' || Array.isArray(user)) throw new ProviderAuthError();
      if (typeof user.id !== 'string' || !PROVIDER_UUID_PATTERN.test(user.id) || user.is_anonymous === true) return null;
      const email = user.email;
      if (typeof email !== 'string' || !email || email.length > 320 || /[\s\u0000-\u001f\u007f]/.test(email) || !email.includes('@')) return null;
      if (typeof user.email_confirmed_at !== 'string' || !Number.isFinite(Date.parse(user.email_confirmed_at))) return null;
      return {
        userId: 'supabase:' + config.project + ':' + user.id.toLowerCase(),
        displayName: providerDisplayName(user, email),
        email,
      };
    })();
    return await Promise.race([validation, deadline]);
  } catch (error) {
    if (error instanceof ProviderAuthError) throw error;
    throw new ProviderAuthError();
  } finally { clearTimeout(timeout); }
}
