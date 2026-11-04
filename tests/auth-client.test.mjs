import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, ApiError } from '../public/auth-client.js';

test('unreadable successful API response leaves a mutation outcome uncertain', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not JSON', {status:200});
  try {
    await assert.rejects(apiRequest('/api/trades', {method:'POST', body:{}, auth:false}), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 200);
      assert.equal(error.uncertain, true);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('an unreadable explicit client rejection remains definitive', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('invalid request', {status:400});
  try {
    await assert.rejects(apiRequest('/api/trades', {method:'POST', body:{}, auth:false}), error => {
      assert.equal(error.status, 400);
      assert.equal(error.uncertain, false);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});
