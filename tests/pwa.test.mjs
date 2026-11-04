import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scope = 'https://amongushahahasus-sudo.github.io/MANGO-Sec./';
const workerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const keyFor = request => typeof request === 'string' ? request : request.url;

function workerHarness() {
  const listeners = new Map();
  const saved = new Map();
  const buckets = new Map();
  const calls = [];
  let claimed = false;
  let fetcher = async request => {
    const url = new URL(keyFor(request));
    const mime = url.pathname.endsWith('.js') ? 'text/javascript'
      : url.pathname.endsWith('.css') ? 'text/css'
        : url.pathname.endsWith('.webmanifest') ? 'application/manifest+json'
          : url.pathname.endsWith('.png') ? 'image/png'
            : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    return new Response('public shell', { headers: { 'Content-Type': mime } });
  };
  const caches = {
    async open(name) {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const bucket = buckets.get(name);
      return {
        async match(request) { return bucket.get(keyFor(request))?.clone(); },
        async put(request, response) {
          bucket.set(keyFor(request), response.clone());
          saved.set(keyFor(request), response.clone());
        },
      };
    },
    async keys() { return [...buckets.keys()]; },
    async delete(name) { return buckets.delete(name); },
  };
  const context = vm.createContext({
    URL, Request, Response, Set, Promise, caches,
    fetch: async request => { calls.push(keyFor(request)); return fetcher(request); },
    self: {
      registration: { scope },
      clients: { async claim() { claimed = true; } },
      addEventListener(type, listener) { listeners.set(type, listener); },
      skipWaiting() {},
    },
  });
  vm.runInContext(workerSource, context, { filename: 'sw.js' });
  return {
    saved, buckets, calls, caches,
    get claimed() { return claimed; },
    set fetcher(value) { fetcher = value; },
    async dispatch(type, request) {
      const tasks = [];
      let response;
      listeners.get(type)({
        request,
        waitUntil(task) { tasks.push(task); },
        respondWith(task) { response = Promise.resolve(task); },
      });
      const resolved = response ? await response : undefined;
      await Promise.all(tasks);
      return resolved;
    },
  };
}

const navigation = (url = scope) => ({ url, method: 'GET', mode: 'navigate' });

test('manifest installs within the GitHub Pages project path using genuine PNG app icons', async () => {
  const manifestUrl = new URL('../public/manifest.webmanifest', import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  assert.equal(manifest.name, 'MANGO Sec.');
  assert.equal(manifest.lang, 'ja');
  assert.equal(manifest.display, 'standalone');
  for (const field of ['id', 'start_url', 'scope']) {
    assert.equal(manifest[field], './');
    assert.equal(new URL(manifest[field], scope).href, scope);
  }
  assert.equal(manifest.background_color, '#f7f8fa');
  assert.equal(manifest.theme_color, '#f7f8fa');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose.includes('maskable')));
  for (const icon of [...manifest.icons, { src: './icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const png = await readFile(new URL(icon.src, manifestUrl));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.ok(png.length > 1000);
  }
});

test('precache stores only public assets and rejects optional missing files and HTML masquerading as JavaScript', async () => {
  const worker = workerHarness();
  worker.fetcher = async request => {
    const path = new URL(keyFor(request)).pathname;
    if (path.endsWith('onboarding.js')) return new Response('Not found', { status: 404 });
    if (path.endsWith('account-ui.js')) return new Response('Login page', { headers: { 'Content-Type': 'text/html' } });
    const mime = path.endsWith('.js') ? 'text/javascript'
      : path.endsWith('.css') ? 'text/css'
        : path.endsWith('.png') ? 'image/png'
          : path.endsWith('.svg') ? 'image/svg+xml'
            : path.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html';
    return new Response('shell', { headers: { 'Content-Type': mime } });
  };
  await worker.dispatch('install');
  assert.ok(worker.saved.has(scope));
  assert.ok(worker.saved.has(`${scope}pwa.js`));
  assert.ok(worker.saved.has(`${scope}icons/icon-512.png`));
  assert.equal(worker.saved.has(`${scope}onboarding.js`), false);
  assert.equal(worker.saved.has(`${scope}account-ui.js`), false);
  for (const url of worker.saved.keys()) {
    assert.ok(url.startsWith(scope));
    assert.equal(new URL(url).search, '');
  }
});

test('API calls, account changes, auth callbacks, query strings, external sites and unknown paths bypass the worker', async () => {
  const worker = workerHarness();
  const requests = [
    new Request(`${scope}api/account`),
    new Request(`${scope}api/orders`, { method: 'POST' }),
    new Request(`${scope}auth/callback?code=secret`),
    navigation(`${scope}?code=secret&state=private`),
    navigation(`${scope}index.html?session=private`),
    new Request(`${scope}app.js?access_token=private`),
    new Request(`${scope}unknown.js`),
    new Request('https://mango-sec-trading.azumaishow781.chatgpt.site/api/account'),
    new Request('https://project.supabase.co/auth/v1/token'),
    new Request('https://amongushahahasus-sudo.github.io/another-app/app.js'),
  ];
  for (const request of requests) assert.equal(await worker.dispatch('fetch', request), undefined, request.url);
  assert.equal(worker.calls.length, 0);
  assert.equal(worker.saved.size, 0);
});

test('clean app navigations use fresh HTML online and the cached shell offline', async () => {
  const worker = workerHarness();
  worker.fetcher = async () => new Response('<html>latest app</html>', { headers: { 'Content-Type': 'text/html' } });
  assert.equal(await (await worker.dispatch('fetch', navigation())).text(), '<html>latest app</html>');
  worker.fetcher = async () => { throw new TypeError('offline'); };
  assert.equal(await (await worker.dispatch('fetch', navigation(`${scope}index.html`))).text(), '<html>latest app</html>');
  assert.equal(worker.saved.size, 1);
});

test('offline without a saved shell gives an explicit connection-required view', async () => {
  const worker = workerHarness();
  worker.fetcher = async () => { throw new TypeError('offline'); };
  const response = await worker.dispatch('fetch', navigation());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const page = await response.text();
  assert.match(page, /現在オフライン/);
  assert.match(page, /売買・ログインには接続が必要/);
  assert.equal(worker.saved.size, 0);
});

test('static assets remain available offline and refresh in the background when connected', async () => {
  const worker = workerHarness();
  const request = new Request(`${scope}app.js`);
  worker.fetcher = async () => new Response('first version', { headers: { 'Content-Type': 'text/javascript' } });
  assert.equal(await (await worker.dispatch('fetch', request)).text(), 'first version');
  worker.fetcher = async () => new Response('updated version', { headers: { 'Content-Type': 'text/javascript' } });
  assert.equal(await (await worker.dispatch('fetch', request)).text(), 'first version');
  worker.fetcher = async () => { throw new TypeError('offline'); };
  assert.equal(await (await worker.dispatch('fetch', request)).text(), 'updated version');
});

test('an HTTP error or redirect never replaces a usable static cache entry', async () => {
  const worker = workerHarness();
  const request = new Request(`${scope}styles.css`);
  worker.fetcher = async () => new Response('good style', { headers: { 'Content-Type': 'text/css' } });
  await worker.dispatch('fetch', request);
  for (const response of [new Response('not found', { status: 404 }), Response.redirect(`${scope}auth/callback`)]) {
    worker.fetcher = async () => response;
    assert.equal(await (await worker.dispatch('fetch', request)).text(), 'good style');
    assert.equal(await worker.saved.get(request.url).clone().text(), 'good style');
  }
});

test('activation removes older MANGO caches while keeping other applications untouched', async () => {
  const worker = workerHarness();
  await worker.caches.open('mango-sec-v2');
  await worker.caches.open('unrelated-project');
  await worker.dispatch('install');
  await worker.dispatch('activate');
  const names = await worker.caches.keys();
  assert.equal(names.includes('mango-sec-v2'), false);
  assert.equal(names.includes('unrelated-project'), true);
  assert.ok(names.some(name => name.startsWith('mango-sec-v3')));
  assert.equal(worker.claimed, true);
});
