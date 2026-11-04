import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderAuthError, resolveProviderIdentity } from '../src/provider-auth.js';

const project = 'wqczekzebhukjayyhuln';
const env = {
  PUBLIC_SUPABASE_URL: 'https://' + project + '.supabase.co',
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public_test_key_1234567890',
};
const uuid = '6e4c41ac-b65e-4c92-9adc-e36df7494718';
const jwt = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = jwt({ alg: 'HS256' }) + '.' + jwt({ sub: 'forged-user', iss: 'https://evil.example/auth/v1', user_metadata: { role: 'owner' } }) + '.unverified_signature';
const request = (value = token, url = 'https://api.example/api/account?user_id=forged') => new Request(url, { headers: value ? { Authorization: 'Bearer ' + value } : {} });
const user = overrides => ({ id: uuid, email: 'mango@example.com', email_confirmed_at: '2026-11-04T10:00:00Z', is_anonymous: false, user_metadata: { display_name: 'Mango User', user_id: 'forged-user', role: 'owner' }, ...overrides });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('identity comes from trusted getUser response with fixed URL, public apikey and caller bearer', async () => {
  const calls = [];
  const identity = await resolveProviderIdentity(request(), env, async (url, init) => { calls.push({ url, init }); return response(user()); });
  assert.deepEqual(identity, { userId: 'supabase:' + project + ':' + uuid, displayName: 'Mango User', email: 'mango@example.com' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, env.PUBLIC_SUPABASE_URL + '/auth/v1/user');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.apikey, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + token);
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('forged claims and a token from another project cannot establish identity without provider validation', async () => {
  for (const status of [401, 403]) {
    assert.equal(await resolveProviderIdentity(request(), env, async url => {
      assert.equal(url, env.PUBLIC_SUPABASE_URL + '/auth/v1/user');
      return response({ sub: uuid, user_metadata: { role: 'owner' } }, status);
    }), null);
  }
  assert.equal(await resolveProviderIdentity(request(), env, async () => response({ user_metadata: { id: uuid, email: 'forged@example.com', email_confirmed_at: '2026-11-04' } })), null);
});

test('non-provider, malformed and oversized bearer values return null without remote calls or configuration lookup', async () => {
  const fail = () => { throw new Error('must not request'); };
  for (const value of [null, 'A'.repeat(43), 'a.b', 'a..b', 'a.b.c.d', 'a.b.c=', 'a.' + 'b'.repeat(16384) + '.c']) {
    assert.equal(await resolveProviderIdentity(request(value), {}, fail), null);
  }
  assert.equal(await resolveProviderIdentity(new Request('https://api.example', { headers: { Authorization: 'Basic a.b.c' } }), env, fail), null);
});

test('configuration accepts only HTTPS project origins and public keys, never request-controlled hosts or privileged keys', async () => {
  const fail = () => { throw new Error('must not request'); };
  const badUrls = ['http://' + project + '.supabase.co', 'https://evil.example', 'https://' + project + '.supabase.co.evil.example', 'https://user:pass@' + project + '.supabase.co', env.PUBLIC_SUPABASE_URL + ':444', env.PUBLIC_SUPABASE_URL + '/auth/v1', env.PUBLIC_SUPABASE_URL + '?token=abc', env.PUBLIC_SUPABASE_URL + '#hash'];
  for (const PUBLIC_SUPABASE_URL of badUrls) await assert.rejects(resolveProviderIdentity(request(), { ...env, PUBLIC_SUPABASE_URL }, fail), error => error instanceof ProviderAuthError && error.code === 'PROVIDER_CONFIG');
  const privilegedJwt = jwt({ alg: 'HS256' }) + '.' + jwt({ role: 'service_role', ref: project }) + '.signature';
  const wrongAnonProject = jwt({ alg: 'HS256' }) + '.' + jwt({ role: 'anon', ref: 'anotherproject' }) + '.signature';
  for (const key of ['', 'sb_secret_privatekey_123456789', privilegedJwt, wrongAnonProject, 'eyJmalformed']) {
    await assert.rejects(resolveProviderIdentity(request(), { ...env, PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }, fail), error => error instanceof ProviderAuthError && error.code === 'PROVIDER_CONFIG');
  }
  await assert.rejects(resolveProviderIdentity(request(), {}, fail), error => error instanceof ProviderAuthError && error.status === 503);
  const anonKey = jwt({ alg: 'HS256' }) + '.' + jwt({ role: 'anon', ref: project }) + '.signature';
  assert.equal((await resolveProviderIdentity(request(), { ...env, PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey }, async () => response(user()))).userId, 'supabase:' + project + ':' + uuid);
});

test('canonical account IDs include project and verified UUID, remain stable across display/email changes', async () => {
  const first = await resolveProviderIdentity(request(), env, async () => response(user()));
  const renamed = await resolveProviderIdentity(request(), env, async () => response(user({ id: uuid.toUpperCase(), email: 'new@example.com', user_metadata: { full_name: 'New Name', user_id: 'arbitrary' } })));
  assert.equal(renamed.userId, first.userId);
  assert.equal(renamed.email, 'new@example.com');
  assert.equal(renamed.displayName, 'New Name');
  const otherEnv = { ...env, PUBLIC_SUPABASE_URL: 'https://otherprojectref123456.supabase.co' };
  const other = await resolveProviderIdentity(request(), otherEnv, async () => response(user()));
  assert.notEqual(other.userId, first.userId);
  assert.equal(other.userId, 'supabase:otherprojectref123456:' + uuid);
});

test('anonymous, unconfirmed, missing-email and invalid-ID users are rejected after verification', async () => {
  for (const changes of [
    { is_anonymous: true }, { email_confirmed_at: null }, { email_confirmed_at: '' }, { email_confirmed_at: 'bad date' },
    { email: null }, { email: '' }, { email: 'unsafe\n@example.com' }, { id: 'not-a-uuid' }, { id: null },
  ]) assert.equal(await resolveProviderIdentity(request(), env, async () => response(user(changes))), null);
  const bounded = await resolveProviderIdentity(request(), env, async () => response(user({ user_metadata: { display_name: '\u0000' + '名'.repeat(500) } })));
  assert.equal(bounded.displayName.length, 200);
  assert.ok(!bounded.displayName.includes('\u0000'));
  const fallback = await resolveProviderIdentity(request(), env, async () => response(user({ user_metadata: { display_name: {}, full_name: '' } })));
  assert.equal(fallback.displayName, 'mango@example.com');
});

test('upstream network, server, redirect and malformed-response failures raise 503 without exposing internal details', async () => {
  for (const fetcher of [
    async () => { throw new Error('internal credentials private'); },
    async () => response({ error: 'unavailable' }, 500),
    async () => response({ error: 'rate limited' }, 429),
    async () => response({ error: 'moved' }, 302),
    async () => new Response('not json'),
    async () => response([]),
  ]) await assert.rejects(resolveProviderIdentity(request(), env, fetcher), error => error instanceof ProviderAuthError && error.status === 503 && !error.message.includes('private'));
});

test('eight-second deadline aborts and rejects even when the fetch adapter ignores cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = resolveProviderIdentity(request(), env, async (url, init) => { signal = init.signal; return new Promise(() => {}); });
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(8000);
  await assert.rejects(pending, error => error instanceof ProviderAuthError && error.status === 503);
  assert.equal(signal.aborted, true);
});

test('successful validations are not cached between requests', async () => {
  let calls = 0;
  const fetcher = async () => ++calls === 1 ? response(user()) : response({ error: 'revoked session' }, 401);
  assert.ok(await resolveProviderIdentity(request(), env, fetcher));
  assert.equal(await resolveProviderIdentity(request(), env, fetcher), null);
  assert.equal(calls, 2);
});
