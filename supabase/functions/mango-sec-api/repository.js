const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'user_id,state_json,watchlist_json,version';

/** All provider requests fail closed on redirects and share an eight-second budget. */
export async function providerJson(fetcher, url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url, {
      ...options,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store', ...options.headers },
      signal: controller.signal,
      redirect: 'manual',
      cache: 'no-store',
    });
    let data = null;
    try { data = await response.json(); }
    catch {
      // A truncated/timed-out success body is a provider failure, not an invalid session.
      if (response.ok) throw new Error('Provider response unavailable');
    }
    return { ok: response.ok, status: response.status, data };
  } finally { clearTimeout(timeout); }
}

/** Privileged REST access never accepts a user id from request JSON or JWT claims. */
export function createRepository({ supabaseUrl, serviceRoleKey }, fetcher = fetch) {
  const base = `${supabaseUrl}/rest/v1/mango_sec_accounts`;
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
  function scopedUrl(userId, version) {
    if (typeof userId !== 'string' || !UUID.test(userId)) throw new Error('Invalid verified user');
    const url = new URL(base);
    url.searchParams.set('user_id', `eq.${userId}`);
    url.searchParams.set('select', COLUMNS);
    if (version !== undefined) {
      if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid version');
      url.searchParams.set('version', `eq.${version}`);
    }
    return url;
  }
  async function rest(url, options = {}) {
    const result = await providerJson(fetcher, url.href, { ...options, headers: { ...headers, ...options.headers } });
    if (!result.ok || !Array.isArray(result.data)) throw new Error('Account storage unavailable');
    return result.data;
  }
  async function read(userId) {
    const rows = await rest(scopedUrl(userId));
    if (rows.length > 1 || (rows[0] && rows[0].user_id !== userId)) throw new Error('Invalid account scope');
    return rows[0] ?? null;
  }
  return {
    read,
    async ensure(userId, account, now) {
      const existing = await read(userId);
      if (existing) return existing;
      const url = scopedUrl(userId);
      url.searchParams.set('on_conflict', 'user_id');
      const timestamp = new Date(now).toISOString();
      await rest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ user_id: userId, state_json: account, watchlist_json: [], version: 0, created_at: timestamp, updated_at: timestamp }),
      });
      // A competing first request can insert the same account before this request.
      const row = await read(userId);
      if (!row) throw new Error('Account storage unavailable');
      return row;
    },
    async save(userId, version, account, watchlist, now) {
      const rows = await rest(scopedUrl(userId, version), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ state_json: account, watchlist_json: watchlist, version: version + 1, updated_at: new Date(now).toISOString() }),
      });
      if (rows.length > 1 || (rows[0] && rows[0].user_id !== userId)) throw new Error('Invalid account scope');
      return rows[0] ?? null;
    },
    async ready() {
      // This public health check reads zero rows and returns no account data.
      const url = new URL(base);
      url.searchParams.set('select', 'user_id');
      url.searchParams.set('limit', '0');
      await rest(url);
      return true;
    },
  };
}
